import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface HeroAssets {
  body: GLTF;
  sword: GLTF;
  clips: THREE.AnimationClip[];
}

const base = `${import.meta.env.BASE_URL}models/hero/`;
const ANIMS = ['anim-general', 'anim-move', 'anim-melee', 'anim-fish'];

function inPlace(clip: THREE.AnimationClip) {
  for (const track of clip.tracks) {
    if (track.name !== 'root.position') continue;
    const v = track.values;
    for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
  return clip;
}

export async function loadHeroAssets(): Promise<HeroAssets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [body, sword, ...anims] = await Promise.all([
    loader.loadAsync(`${base}knight.glb`),
    loader.loadAsync(`${base}sword.glb`),
    ...ANIMS.map((n) => loader.loadAsync(`${base}${n}.glb`)),
  ]);
  return { body, sword, clips: anims.flatMap((a) => a.animations).map(inPlace) };
}
