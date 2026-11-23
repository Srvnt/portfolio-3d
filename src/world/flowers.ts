import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WorldMap } from './map';
import { hash2 } from '../core/random';
import { addSway } from './grass';

const base = `${import.meta.env.BASE_URL}models/nature/`;
const FILES = ['Flower_3_Single', 'Flower_4_Single', 'Flower_3_Group', 'Flower_4_Group'] as const;

interface Part {
  geo: THREE.BufferGeometry;
  map: THREE.Texture | null;
}

async function loadFlower(loader: GLTFLoader, file: string) {
  const gltf = await loader.loadAsync(`${base}${file}.gltf`);
  const parts: Part[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geo.deleteAttribute('color');
    const n = geo.attributes.position.count;
    const up = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) up[i * 3 + 1] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));
    parts.push({ geo, map: (mesh.material as THREE.MeshStandardMaterial).map });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox!);
  }
  return { parts, height: box.max.y };
}

export async function createFlowers(map: WorldMap): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const models = await Promise.all(FILES.map((f) => loadFlower(loader, f)));

  const spots: { x: number; z: number; s: number; r: number }[][] = FILES.map(() => []);
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!map.flowers[map.i(x, z)]) continue;
      const n = 2 + Math.floor(hash2(x, z, 30) * 3);
      for (let k = 0; k < n; k++) {
        const pick = hash2(x, z, 51 + k);
        const v = pick < 0.35 ? 0 : pick < 0.7 ? 1 : pick < 0.85 ? 2 : 3;
        spots[v].push({
          x: x + 0.1 + hash2(x, z, 31 + k) * 0.8,
          z: z + 0.1 + hash2(x, z, 41 + k) * 0.8,
          s: 0.26 + hash2(x, z, 61 + k) * 0.09,
          r: hash2(x, z, 71 + k) * Math.PI * 2,
        });
      }
    }

  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  models.forEach((model, vi) => {
    const list = spots[vi];
    if (!list.length) return;
    for (const part of model.parts) {
      const material = new THREE.MeshLambertMaterial({ map: part.map, alphaTest: 0.5, side: THREE.DoubleSide });
      addSway(material, model.height);
      const mesh = new THREE.InstancedMesh(part.geo, material, list.length);
      list.forEach((f, i) => {
        q.setFromAxisAngle(up, f.r);
        s.setScalar(f.s);
        p.set(f.x, 0, f.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += 1;
      group.add(mesh);
    }
  });
  return group;
}
