import * as THREE from 'three';
import { Occ, Tile, WorldMap } from './map';
import { hash2, valueNoise } from '../core/random';
import { uniforms } from './shared';

const BLADE_H = 0.32;

/**
 * Thousands of instanced grass blades that sway in the wind and bend away
 * from the hero as they walk through.
 */
export function createGrass(map: WorldMap, density: number): THREE.InstancedMesh {
  // one tapered blade: 5 verts
  const w = 0.06;
  const geo = new THREE.BufferGeometry();
  // slight forward curve so blades read as soft tufts, not flat cards
  const pos = [-w, 0, 0, w, 0, 0, -w * 0.65, BLADE_H * 0.55, 0.02, w * 0.65, BLADE_H * 0.55, 0.02, 0, BLADE_H, 0.07];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(15).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const base = new THREE.Color('#2c6420');
  const mid = new THREE.Color('#5aa636');
  const tip = new THREE.Color('#c6ea78');
  geo.setAttribute('color', new THREE.Float32BufferAttribute([
    ...base.toArray(), ...base.toArray(), ...mid.toArray(), ...mid.toArray(), ...tip.toArray(),
  ], 3));

  // collect blade positions
  const spots: number[] = [];
  const nearNonGrass = (x: number, z: number, px: number, pz: number) => {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = map.tile(x + dx, z + dz);
        if (t !== Tile.Grass && Math.hypot(px - (x + dx + 0.5), pz - (z + dz + 0.5)) < (t === Tile.Path ? 0.82 : 1.15)) return true;
      }
    return false;
  };
  // trees keep a small clearing of bare earth (where mushrooms grow)
  const trunks = new Map<number, { x: number; z: number }>();
  for (const p of map.props) if (p.inside && p.kind === 'tree') trunks.set(map.i(Math.floor(p.x), Math.floor(p.z)), p);
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      const i = map.i(x, z);
      if (map.tiles[i] !== Tile.Grass || map.occ[i] === Occ.Building || map.occ[i] === Occ.Fixture) continue;
      if (x >= 18 && x <= 25 && z >= 14 && z <= 21) continue; // plaza
      const trunk = trunks.get(i);
      for (let k = 0; k < density; k++) {
        const px = x + hash2(x * 31 + k, z, 1);
        const pz = z + hash2(x, z * 31 + k, 2);
        if (nearNonGrass(x, z, px, pz)) continue;
        if (trunk && Math.hypot(px - trunk.x, pz - trunk.z) < 0.55) continue;
        spots.push(px, pz);
      }
    }

  const count = spots.length / 2;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uHero = uniforms.uHero;
    shader.uniforms.uHit = uniforms.uHit;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uHero; uniform vec3 uHit; uniform float uWind;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        mvPosition = instanceMatrix * mvPosition;
        float hk = position.y / ${BLADE_H.toFixed(2)}; hk *= hk;
        vec2 ip = instanceMatrix[3].xz;
        // gusts roll across the meadow; strong wind also leans everything one way
        float gustW = 0.5 + 0.5 * sin(uTime * (0.9 + uWind) - ip.x * 0.25 - ip.y * 0.1);
        vec2 wind = vec2(
          sin(uTime * (1.8 + uWind * 3.0) + ip.x * 0.35 + ip.y * 0.22) + sin(uTime * 3.1 + ip.x * 1.7) * 0.3,
          cos(uTime * (1.4 + uWind * 2.0) + ip.y * 0.3) * 0.5) * (0.09 + uWind * 0.12 * gustW)
          + vec2(0.85, 0.3) * uWind * (0.12 + 0.18 * gustW);
        vec2 away = ip - uHero;
        float dist = length(away);
        float push = smoothstep(1.0, 0.15, dist);
        // sword swipe: a wider ring of grass flattens outward, springing back as uHit.z decays
        vec2 fromHit = ip - uHit.xy;
        float slash = smoothstep(1.6, 0.2, length(fromHit)) * uHit.z;
        mvPosition.xz += (wind + normalize(away + 1e-4) * push * 0.38 + normalize(fromHit + 1e-4) * slash * 0.45) * hk;
        mvPosition.y -= (push * 0.22 + slash * 0.2) * hk;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    // keep both sides lit like the ground
    shader.fragmentShader = shader.fragmentShader.replace(
      'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
      'float faceDirection = 1.0;',
    );
  };

  const mesh = new THREE.InstancedMesh(geo, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const x = spots[i * 2], z = spots[i * 2 + 1];
    const h = hash2(Math.floor(x * 97), Math.floor(z * 97), 5);
    e.set((h - 0.5) * 0.3, h * Math.PI * 2, (hash2(i, 3, 9) - 0.5) * 0.3);
    q.setFromEuler(e);
    // tall lush clumps and shorter meadow, driven by soft noise
    const clump = valueNoise(x * 0.55, z * 0.55, 13);
    const sc = (0.6 + hash2(i, 7, 4) * 0.55) * (0.7 + clump * 1.0);
    const wide = 0.85 + hash2(i, 8, 4) * 0.5;
    s.set(wide, sc, wide);
    p.set(x, 0, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    // patches: deep green in clumps, sunnier yellow-green in open meadow
    const v = hash2(i, 1, 1);
    const sun = valueNoise(x * 0.3 + 40, z * 0.3, 14);
    const deep = clump * 0.25;
    col.setRGB(
      0.78 + v * 0.22 + sun * 0.18 - deep,
      0.9 + v * 0.15 + sun * 0.06 - deep * 0.4,
      0.72 + v * 0.12 - deep,
    );
    mesh.setColorAt(i, col);
  }
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
