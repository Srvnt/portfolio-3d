import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Occ, Tile, WorldMap } from './map';
import { hash2, valueNoise } from '../core/random';
import { uniforms } from './shared';

const base = `${import.meta.env.BASE_URL}models/nature/`;
const GREEN = { root: '#4c8c30', mid: '#7cbb48', tip: '#c2e27c' };
const GOLD = { root: '#8c8a34', mid: '#c4b452', tip: '#ecdc8c' };
const CHUNK = 12;

type Ramp = typeof GREEN;
const VARIANTS: { file: string; ramp?: Ramp }[] = [
  { file: 'Grass_Common_Short', ramp: GREEN },
  { file: 'Grass_Common_Tall', ramp: GREEN },
  { file: 'Grass_Wispy_Short', ramp: GREEN },
  { file: 'Grass_Wispy_Tall', ramp: GREEN },
  { file: 'Grass_Common_Short', ramp: GOLD },
  { file: 'Grass_Wispy_Short', ramp: GOLD },
  { file: 'Grass_Wispy_Tall', ramp: GOLD },
  { file: 'Clover_1' },
  { file: 'Clover_2' },
  { file: 'Fern_1' },
];
const V = { CS: 0, CT: 1, WS: 2, WT: 3, GOLD_CS: 4, GOLD_WS: 5, GOLD_WT: 6, CLOVER1: 7, CLOVER2: 8, FERN: 9 };
const GOLD_OF: Record<number, number> = { [V.CS]: V.GOLD_CS, [V.CT]: V.GOLD_WT, [V.WS]: V.GOLD_WS, [V.WT]: V.GOLD_WT };

interface Clump {
  geo: THREE.BufferGeometry;
  map: THREE.Texture | null;
  height: number;
}

interface Spot {
  x: number;
  z: number;
  sx: number;
  sy: number;
  yaw: number;
  lean: number;
  leanDir: number;
  r: number;
  g: number;
  b: number;
}

async function loadClump(loader: GLTFLoader, file: string, ramp?: Ramp): Promise<Clump> {
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
  if (ramp) {
    geo.computeBoundingBox();
    const knee = geo.boundingBox!.max.y * 0.62;
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      if (y > knee) pos.setY(i, knee + (y - knee) * 0.4);
    }
  }
  const up = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) up[i * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  geo.computeBoundingBox();
  const height = Math.max(0.01, geo.boundingBox!.max.y);
  if (!ramp) return { geo, map: (mesh.material as THREE.MeshStandardMaterial).map, height };
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
  return { geo, map: null, height };
}

const YELLOW = new THREE.Color(1.12, 1.05, 0.7);
const BLUE = new THREE.Color(0.82, 0.97, 0.94);

export async function createGrass(map: WorldMap, lowEnd: boolean): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const clumps = await Promise.all(VARIANTS.map((v) => loadClump(loader, v.file, v.ramp)));

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
  const grassAt = (px: number, pz: number) => {
    if (px < 0 || pz < 0 || px >= map.W || pz >= map.H) return false;
    const i = map.i(Math.floor(px), Math.floor(pz));
    return map.tiles[i] === Tile.Grass && map.occ[i] !== Occ.Building && map.occ[i] !== Occ.Fixture;
  };

  const cx = Math.ceil(map.W / CHUNK);
  const buckets: Spot[][][] = VARIANTS.map(() => Array.from({ length: cx * Math.ceil(map.H / CHUNK) }, () => []));
  const col = new THREE.Color();
  const put = (v: number, x: number, z: number, sx: number, sy: number, seed: number, tint = 1) => {
    const hueA = valueNoise(x * 0.21, z * 0.21, 51);
    const hueB = valueNoise(x * 0.33 + 9, z * 0.33, 52);
    const j = hash2(seed, 77, 53);
    col.setRGB(1, 1, 1).lerp(YELLOW, Math.max(0, hueA - 0.45) * 1.4 * tint).lerp(BLUE, Math.max(0, hueB - 0.5) * 1.3 * tint);
    col.multiplyScalar(0.86 + j * 0.24 + valueNoise(x * 0.3 + 40, z * 0.3, 14) * 0.1);
    const leanField = valueNoise(x * 0.16 + 70, z * 0.16, 54);
    buckets[v][Math.floor(z / CHUNK) * cx + Math.floor(x / CHUNK)].push({
      x, z, sx, sy,
      yaw: hash2(seed, 13, 55) * Math.PI * 2,
      lean: (0.05 + Math.max(0, leanField - 0.45) * 0.7) * (0.6 + hash2(seed, 14, 56) * 0.8),
      leanDir: valueNoise(x * 0.08, z * 0.08 + 30, 57) * Math.PI * 4 + (hash2(seed, 15, 58) - 0.5) * 0.9,
      r: col.r, g: col.g, b: col.b,
    });
  };

  const carpet = lowEnd ? 7 : 14;
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!grassAt(x + 0.5, z + 0.5)) continue;
      if (x >= 18 && x <= 25 && z >= 14 && z <= 21) continue;
      const nearPlaza = x >= 17 && x <= 26 && z >= 13 && z <= 22;
      for (let k = 0; k < carpet; k++) {
        const seed = (x * 73856093) ^ (z * 19349663) ^ (k * 83492791);
        const px = x + hash2(x * 31 + k, z, 1);
        const pz = z + hash2(x, z * 31 + k, 2);
        if (nearEdge(px, pz, 0) || nearTrunk(px, pz, 0.45)) continue;
        const meadow = valueNoise(px * 0.11, pz * 0.11, 41) * 0.65 + valueNoise(px * 0.37, pz * 0.37, 42) * 0.35;
        if (hash2(seed, 1, 59) < 0.3 * (1 - meadow)) continue;
        const trimmed = nearEdge(px, pz, 0.3) || nearPlaza;
        const roomy = !trimmed && !nearTrunk(px, pz, 0.7) && !nearThing(px, pz);
        const lush = roomy && meadow > 0.52;
        const dry = valueNoise(px * 0.12 + 50, pz * 0.12, 32) > 0.66 && hash2(seed, 2, 60) > 0.3;

        const clover = valueNoise(px * 0.28 + 20, pz * 0.28, 61);
        if (!lush && clover > 0.7 && hash2(seed, 3, 62) < 0.55) {
          const s = 0.2 + hash2(seed, 4, 63) * 0.08;
          put(hash2(seed, 5, 64) < 0.5 ? V.CLOVER1 : V.CLOVER2, px, pz, s * 1.3, s, seed, 0.5);
          continue;
        }

        const r = hash2(seed, 6, 65);
        let v: number;
        if (lush) v = r < 0.32 ? V.CS : r < 0.62 ? V.CT : r < 0.82 ? V.WS : V.WT;
        else if (roomy) v = r < 0.58 ? V.CS : r < 0.88 ? V.WS : V.CT;
        else v = r < 0.7 ? V.CS : V.WS;
        if (dry) v = GOLD_OF[v];

        const tall = v === V.CT || v === V.WT || v === V.GOLD_WT;
        let sy = (0.15 + meadow * 0.15) * (0.6 + hash2(seed, 7, 66) * 0.8);
        if (trimmed) sy *= 0.72;
        if (roomy && hash2(seed, 8, 67) < 0.04) sy *= 1.75;
        if (tall) sy *= 1.15;
        const sx = (tall ? 0.42 : 0.5) + hash2(seed, 9, 68) * 0.32;
        put(v, px, pz, sx, sy, seed);
      }
    }

  const fernMax = lowEnd ? 1 : 3;
  for (const t of trunks) {
    const n = Math.floor(hash2(Math.floor(t.x * 10), Math.floor(t.z * 10), 70) * (fernMax + 1));
    for (let k = 0; k < n; k++) {
      const seed = Math.floor(t.x * 1000) * 31 + Math.floor(t.z * 1000) + k * 7919;
      const a = hash2(seed, 1, 71) * Math.PI * 2;
      const d = 0.55 + hash2(seed, 2, 72) * 0.7;
      const px = t.x + Math.cos(a) * d, pz = t.z + Math.sin(a) * d;
      if (!grassAt(px, pz) || nearEdge(px, pz, 0) || nearThing(px, pz)) continue;
      const s = 0.07 + hash2(seed, 3, 73) * 0.05;
      put(V.FERN, px, pz, s, s * (0.9 + hash2(seed, 4, 74) * 0.5), seed, 0.6);
    }
  }

  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  clumps.forEach((c, vi) => {
    const material = new THREE.MeshLambertMaterial({
      vertexColors: !c.map, map: c.map, alphaTest: c.map ? 0.5 : 0, side: THREE.DoubleSide,
    });
    addSway(material, c.height);
    for (const list of buckets[vi]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(c.geo, material, list.length);
      list.forEach((g, i) => {
        q.setFromAxisAngle(up, g.yaw);
        axis.set(Math.cos(g.leanDir), 0, Math.sin(g.leanDir));
        qLean.setFromAxisAngle(axis, g.lean);
        q.premultiply(qLean);
        s.set(g.sx, g.sy, g.sx);
        p.set(g.x, 0, g.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setRGB(g.r, g.g, g.b));
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
