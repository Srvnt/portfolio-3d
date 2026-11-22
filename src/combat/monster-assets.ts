import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EnemyKind } from '../world/map';

export interface MonsterModel {
  scene: THREE.Object3D;
  clips: Record<string, THREE.AnimationClip>;
  scale: number;
}

export type MonsterAssets = Record<EnemyKind, MonsterModel[]>;

const base = `${import.meta.env.BASE_URL}models/monsters/`;

const MODELS: Record<EnemyKind, [string, number][]> = {
  jelly: [['GreenBlob', 0.8], ['PinkBlob', 0.8], ['GreenSpikyBlob', 0.95], ['Mushnub', 0.8], ['Mushnub_Evolved', 0.95], ['Cactoro', 0.85], ['Ghost', 1.05], ['Goleling', 0.9], ['Goleling_Evolved', 1.05]],
  beetle: [['Dino', 1.25], ['Frog', 1.1], ['Monkroose', 1.3], ['CactoroBig', 1.3]],
  brute: [['MushroomKing', 1.95], ['Yeti', 2.0], ['Orc', 1.9]],
};

const ALIAS: Record<string, string> = { Idle: 'Flying_Idle', Walk: 'Fast_Flying', Run: 'Fast_Flying', Bite_Front: 'Headbutt', HitRecieve: 'HitReact' };

export async function loadMonsterAssets(): Promise<MonsterAssets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const out = {} as MonsterAssets;
  await Promise.all((Object.keys(MODELS) as EnemyKind[]).map(async (kind) => {
    out[kind] = await Promise.all(MODELS[kind].map(async ([file, height]) => {
      const gltf = await loader.loadAsync(`${base}${file}.glb`);
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      const clips: Record<string, THREE.AnimationClip> = {};
      for (const c of gltf.animations) clips[c.name] = c;
      for (const [want, have] of Object.entries(ALIAS)) if (!clips[want] && clips[have]) clips[want] = clips[have];
      return { scene: gltf.scene, clips, scale: height / Math.max(0.01, box.max.y - box.min.y) };
    }));
  }));
  return out;
}

export function instantiate(model: MonsterModel) {
  const root = clone(model.scene);
  const mats: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    m.roughness = 0.62;
    m.envMapIntensity = 0.6;
    mesh.material = m;
    mats.push(m);
  });
  root.scale.setScalar(model.scale);
  return { root, mats };
}
