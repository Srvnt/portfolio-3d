import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Prop, WorldMap } from './map';
import { hash2 } from '../core/random';
import { heightAt } from './terrain';
import { uniforms } from './shared';
import { leafShade, treeSpecies } from './nature';

const base = `${import.meta.env.BASE_URL}models/nature/`;
const CHUNK = 12;

const MODELS: Record<number, string[]> = {
  0: ['CommonTree_1', 'CommonTree_2', 'CommonTree_5'],
  1: ['CommonTree_3', 'CommonTree_4'],
  2: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5'],
  3: ['CommonTree_1', 'CommonTree_2', 'CommonTree_5'],
};
const HEIGHT: Record<number, [number, number]> = { 0: [3.9, 5.0], 1: [4.1, 5.2], 2: [4.2, 5.4], 3: [3.7, 4.6] };

interface Model {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  barkMap: THREE.Texture | null;
  leafMap: THREE.Texture | null;
  height: number;
}

async function loadModel(loader: GLTFLoader, file: string): Promise<Model> {
  const gltf = await loader.loadAsync(`${base}${file}.gltf`);
  gltf.scene.updateMatrixWorld(true);
  let bark: THREE.Mesh | undefined, leaves: THREE.Mesh | undefined;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (/lea/i.test((mesh.material as THREE.Material).name)) leaves = mesh;
    else bark = mesh;
  });
  if (!bark || !leaves) throw new Error(`bad tree ${file}`);
  const take = (m: THREE.Mesh) => m.geometry.clone().applyMatrix4(m.matrixWorld);
  const barkGeo = take(bark), leafGeo = take(leaves);
  leafGeo.deleteAttribute('color');
  const box = new THREE.Box3().setFromBufferAttribute(barkGeo.attributes.position as THREE.BufferAttribute)
    .union(new THREE.Box3().setFromBufferAttribute(leafGeo.attributes.position as THREE.BufferAttribute));
  return {
    bark: barkGeo,
    leaves: leafGeo,
    barkMap: (bark.material as THREE.MeshStandardMaterial).map,
    leafMap: (leaves.material as THREE.MeshStandardMaterial).map,
    height: box.max.y,
  };
}

function paintLeaves(src: THREE.BufferGeometry, species: number): THREE.BufferGeometry {
  const geo = src.clone();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const center = bb.getCenter(new THREE.Vector3());
  center.y = bb.min.y + (bb.max.y - bb.min.y) * 0.45;
  const size = bb.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.z, size.y) * 0.5;
  const n = pos.count;
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const v = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    d.copy(v).sub(center);
    const depth = Math.min(1, d.length() / reach);
    d.y += reach * 0.25;
    d.normalize();
    d.toArray(normals, i * 3);
    const h = (v.y - bb.min.y) / Math.max(1e-3, size.y);
    const jitter = hash2(Math.floor(v.x * 3), Math.floor(v.z * 3 + v.y * 5), 17);
    leafShade(species, d, h, 0.65 + depth * 0.35, jitter, c).multiplyScalar(1.3).toArray(colors, i * 3);
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function treeMaterial(kind: 'bark' | 'leaves', map: THREE.Texture | null, height: number) {
  const leaves = kind === 'leaves';
  const m = new THREE.MeshLambertMaterial({
    map, vertexColors: true, side: leaves ? THREE.DoubleSide : THREE.FrontSide, alphaTest: leaves ? 0.5 : 0,
  });
  m.customProgramCacheKey = () => `packtree-${kind}-${height.toFixed(2)}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 ip = instanceMatrix[3].xz;
        float hk = clamp(position.y / ${height.toFixed(3)}, 0.0, 1.0); hk *= hk;
        float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.08);
        float wk = (1.0 + uWind * 2.6) * gust * hk * ${(height * 0.022).toFixed(4)};
        transformed.x += (sin(uTime * (1.3 + uWind * 1.8) + ip.x * 0.5 + ip.y * 0.3) + uWind * 1.1) * wk;
        transformed.z += cos(uTime * (1.1 + uWind * 1.8) + ip.x * 0.3) * 0.6 * wk;
        ${leaves ? `transformed += objectNormal * sin(uTime * 6.5 + position.x * 3.0 + position.z * 2.3 + position.y * 1.7 + ip.x) * ${(height * 0.004).toFixed(4)} * hk * (1.0 + uWind * 2.0);` : ''}`,
      );
    if (leaves)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif')
        .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
  return m;
}

export async function createTrees(map: WorldMap): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const files = [...new Set(Object.values(MODELS).flat())];
  const loaded = new Map<string, Model>();
  await Promise.all(files.map(async (f) => loaded.set(f, await loadModel(loader, f))));

  const cx = Math.ceil(map.W / CHUNK);
  const buckets = new Map<string, THREE.Matrix4[]>();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const trees = map.props.filter((p: Prop) => p.kind === 'tree' && p.inside);
  for (const p of trees) {
    const sp = treeSpecies(p);
    const hx = Math.floor(p.x * 10), hz = Math.floor(p.z * 10);
    const files = MODELS[sp];
    const file = files[Math.floor(hash2(hx, hz, 6) * files.length)];
    const model = loaded.get(file)!;
    const [lo, hi] = HEIGHT[sp];
    const s = (lo + hash2(hx, hz, 3) * (hi - lo)) / model.height;
    q.setFromAxisAngle(up, hash2(hx, hz, 4) * Math.PI * 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, heightAt(map, p.x, p.z) - 0.05, p.z), q,
      new THREE.Vector3(s, s * (0.94 + hash2(hx, hz, 5) * 0.12), s),
    );
    const key = `${file}|${sp}|${Math.floor(p.z / CHUNK) * cx + Math.floor(p.x / CHUNK)}`;
    const list = buckets.get(key) ?? [];
    list.push(m);
    buckets.set(key, list);
  }

  const group = new THREE.Group();
  const barkMats = new Map<string, THREE.Material>();
  const leafMats = new Map<string, THREE.Material>();
  const leafGeos = new Map<string, THREE.BufferGeometry>();
  for (const [key, list] of buckets) {
    const [file, spText] = key.split('|');
    const sp = Number(spText);
    const model = loaded.get(file)!;
    if (!barkMats.has(file)) barkMats.set(file, treeMaterial('bark', model.barkMap, model.height));
    if (!leafMats.has(file)) leafMats.set(file, treeMaterial('leaves', model.leafMap, model.height));
    const gk = `${file}|${sp}`;
    if (!leafGeos.has(gk)) leafGeos.set(gk, paintLeaves(model.leaves, sp));
    const parts: [THREE.BufferGeometry, THREE.Material, boolean][] = [
      [model.bark, barkMats.get(file)!, true],
      [leafGeos.get(gk)!, leafMats.get(file)!, false],
    ];
    for (const [geo, mat, receive] of parts) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += 1;
      mesh.castShadow = true;
      mesh.receiveShadow = receive;
      group.add(mesh);
    }
  }
  return group;
}
