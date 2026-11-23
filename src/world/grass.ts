import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Occ, Tile, WorldMap } from './map';
import { hash2, valueNoise } from '../core/random';
import { uniforms } from './shared';

const base = `${import.meta.env.BASE_URL}models/nature/`;
const FILES = ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall'] as const;
const GREEN = { root: '#4c8c30', mid: '#7cbb48', tip: '#c2e27c' };
const GOLD = { root: '#8c8a34', mid: '#c4b452', tip: '#ecdc8c' };
const CHUNK = 12;

interface Clump {
  geo: THREE.BufferGeometry;
  height: number;
}

interface Spot {
  x: number;
  z: number;
  sx: number;
  sy: number;
  tint: number;
}

async function loadClump(loader: GLTFLoader, file: string, ramp: typeof GREEN): Promise<Clump> {
  const gltf = await loader.loadAsync(`${base}${file}.gltf`);
  let mesh: THREE.Mesh | undefined;
  gltf.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error(`no mesh in ${file}`);
  const geo = mesh.geometry.clone();
  geo.deleteAttribute('color');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  geo.computeBoundingBox();
  const knee = geo.boundingBox!.max.y * 0.62;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    if (y > knee) pos.setY(i, knee + (y - knee) * 0.4);
  }
  const up = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) up[i * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  geo.computeBoundingBox();
  const height = geo.boundingBox!.max.y;
  const root = new THREE.Color(ramp.root), mid = new THREE.Color(ramp.mid), tip = new THREE.Color(ramp.tip);
  const c = new THREE.Color();
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, pos.getY(i) / height);
    if (t < 0.5) c.copy(root).lerp(mid, t * 2);
    else c.copy(mid).lerp(tip, (t - 0.5) * 2);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return { geo, height };
}

export async function createGrass(map: WorldMap, lowEnd: boolean): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const clumps = await Promise.all(FILES.map((f) => loadClump(loader, f, f.includes('Wispy') ? GOLD : GREEN)));

  const nearEdge = (px: number, pz: number, pad: number) => {
    const x = Math.floor(px), z = Math.floor(pz);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = map.tile(x + dx, z + dz);
        if (t !== Tile.Grass && Math.hypot(px - (x + dx + 0.5), pz - (z + dz + 0.5)) < (t === Tile.Path ? 0.82 : 1.15) + pad) return true;
      }
    return false;
  };
  const trunks: { x: number; z: number }[] = [];
  for (const p of map.props) if (p.kind === 'tree') trunks.push(p);
  const nearTrunk = (px: number, pz: number, r: number) => trunks.some((t) => Math.abs(px - t.x) < r && Math.abs(pz - t.z) < r && Math.hypot(px - t.x, pz - t.z) < r);
  const nearThing = (px: number, pz: number) => map.interactables.some((it) => Math.hypot(px - it.x, pz - it.z) < 1.3);

  const cx = Math.ceil(map.W / CHUNK);
  const buckets: Spot[][][] = FILES.map(() => Array.from({ length: cx * Math.ceil(map.H / CHUNK) }, () => []));
  const put = (v: number, s: Spot) => buckets[v][Math.floor(s.z / CHUNK) * cx + Math.floor(s.x / CHUNK)].push(s);

  const carpet = lowEnd ? 7 : 14;
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      const i = map.i(x, z);
      if (map.tiles[i] !== Tile.Grass || map.occ[i] === Occ.Building || map.occ[i] === Occ.Fixture) continue;
      const plaza = x >= 18 && x <= 25 && z >= 14 && z <= 21;
      if (plaza) continue;
      const nearPlaza = x >= 17 && x <= 26 && z >= 13 && z <= 22;
      for (let k = 0; k < carpet; k++) {
        const px = x + hash2(x * 31 + k, z, 1);
        const pz = z + hash2(x, z * 31 + k, 2);
        if (nearEdge(px, pz, 0) || nearTrunk(px, pz, 0.5)) continue;
        const clump = valueNoise(px * 0.55, pz * 0.55, 13);
        const patch = valueNoise(px * 0.18, pz * 0.18, 31);
        const dry = valueNoise(px * 0.12 + 50, pz * 0.12, 32) > 0.68;
        const h = hash2(x * 7 + k, z * 3, 4);
        const tall = !nearPlaza && patch > 0.58 + hash2(x + k, z, 23) * 0.12 && k < (lowEnd ? 2 : 3)
          && !nearEdge(px, pz, 0.15) && !nearTrunk(px, pz, 0.65) && !nearThing(px, pz);
        if (tall) {
          const sc = 0.3 + h * 0.12 + (patch - 0.58) * 0.25;
          put(dry ? 3 : 1, { x: px, z: pz, sx: sc * (1.15 + clump * 0.3), sy: sc, tint: clump });
        } else {
          const sy = (0.22 + h * 0.08) * (0.8 + clump * 0.45);
          put(dry && h > 0.4 ? 2 : 0, { x: px, z: pz, sx: 0.6 + hash2(k, x * 13 + z, 8) * 0.18, sy, tint: clump });
        }
      }
    }

  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  clumps.forEach((c, vi) => {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    addSway(material, c.height);
    for (const list of buckets[vi]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(c.geo, material, list.length);
      list.forEach((g, i) => {
        const h = hash2(Math.floor(g.x * 97), Math.floor(g.z * 97), 5);
        e.set((h - 0.5) * 0.2, h * Math.PI * 2, (hash2(i, vi, 9) - 0.5) * 0.2);
        q.setFromEuler(e);
        s.set(g.sx, g.sy, g.sx);
        p.set(g.x, 0, g.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        const v = hash2(i, vi, 1);
        const sun = valueNoise(g.x * 0.3 + 40, g.z * 0.3, 14);
        const deep = g.tint * 0.12;
        col.setRGB(0.86 + v * 0.14 + sun * 0.14 - deep, 0.94 + v * 0.1 + sun * 0.05 - deep * 0.4, 0.82 + v * 0.1 - deep);
        mesh.setColorAt(i, col);
      });
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += 1;
      group.add(mesh);
    }
  });
  return group;
}

export function addSway(material: THREE.Material, height: number) {
  material.customProgramCacheKey = () => `sway-${height.toFixed(3)}`;
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
        float hk = position.y / ${height.toFixed(3)}; hk *= hk;
        vec2 ip = instanceMatrix[3].xz;
        float gustW = 0.5 + 0.5 * sin(uTime * (0.9 + uWind) - ip.x * 0.25 - ip.y * 0.1);
        vec2 wind = vec2(
          sin(uTime * (1.8 + uWind * 3.0) + ip.x * 0.35 + ip.y * 0.22) + sin(uTime * 3.1 + ip.x * 1.7) * 0.3,
          cos(uTime * (1.4 + uWind * 2.0) + ip.y * 0.3) * 0.5) * (0.09 + uWind * 0.12 * gustW)
          + vec2(0.85, 0.3) * uWind * (0.12 + 0.18 * gustW);
        vec2 away = ip - uHero;
        float dist = length(away);
        float push = smoothstep(1.0, 0.15, dist);
        vec2 fromHit = ip - uHit.xy;
        float slash = smoothstep(1.6, 0.2, length(fromHit)) * uHit.z;
        mvPosition.xz += (wind + normalize(away + 1e-4) * push * 0.38 + normalize(fromHit + 1e-4) * slash * 0.45) * hk;
        mvPosition.y -= (push * 0.22 + slash * 0.2) * hk;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
}
