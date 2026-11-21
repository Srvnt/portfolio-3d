import * as THREE from 'three';
import { Occ, Tile, WorldMap } from './map';
import { hash2 } from '../core/random';
import { uniforms } from './shared';

const BLADE_H = 0.32;

/**
 * Thousands of instanced grass blades that sway in the wind and bend away
 * from the hero as they walk through.
 */
export function createGrass(map: WorldMap, density: number): THREE.InstancedMesh {
  // one tapered blade: 5 verts
  const w = 0.045;
  const geo = new THREE.BufferGeometry();
  const pos = [-w, 0, 0, w, 0, 0, -w * 0.6, BLADE_H * 0.5, 0, w * 0.6, BLADE_H * 0.5, 0, 0, BLADE_H, 0];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(15).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const base = new THREE.Color('#3f7c2a');
  const mid = new THREE.Color('#6aaa3c');
  const tip = new THREE.Color('#b8e070');
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
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      const i = map.i(x, z);
      if (map.tiles[i] !== Tile.Grass || map.occ[i] === Occ.Building || map.occ[i] === Occ.Fixture) continue;
      if (x >= 18 && x <= 25 && z >= 14 && z <= 21) continue; // plaza
      for (let k = 0; k < density; k++) {
        const px = x + hash2(x * 31 + k, z, 1);
        const pz = z + hash2(x, z * 31 + k, 2);
        if (nearNonGrass(x, z, px, pz)) continue;
        spots.push(px, pz);
      }
    }

  const count = spots.length / 2;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uHero = uniforms.uHero;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uHero;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        mvPosition = instanceMatrix * mvPosition;
        float hk = position.y / ${BLADE_H.toFixed(2)}; hk *= hk;
        vec2 ip = instanceMatrix[3].xz;
        vec2 wind = vec2(
          sin(uTime * 1.8 + ip.x * 0.35 + ip.y * 0.22) + sin(uTime * 3.1 + ip.x * 1.7) * 0.3,
          cos(uTime * 1.4 + ip.y * 0.3) * 0.5) * 0.09;
        vec2 away = ip - uHero;
        float dist = length(away);
        float push = smoothstep(1.0, 0.15, dist);
        mvPosition.xz += (wind + normalize(away + 1e-4) * push * 0.38) * hk;
        mvPosition.y -= push * 0.22 * hk;
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
    const sc = 0.65 + hash2(i, 7, 4) * 0.75;
    s.set(1, sc, 1);
    p.set(x, 0, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    const v1 = hash2(i, 1, 1);
    const v2 = hash2(i, 2, 2);
    col.setRGB(0.82 + v1 * 0.3, 0.88 + v2 * 0.2, 0.8 + v1 * 0.15);
    mesh.setColorAt(i, col);
  }
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
