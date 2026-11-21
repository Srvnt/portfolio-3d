import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop, WorldMap } from './map';
import { hash2 } from '../core/random';
import { heightAt } from './terrain';
import { addWind, standard, tint, wobble } from './shared';

type Part = THREE.BufferGeometry;
const at = (g: Part, x: number, y: number, z: number) => { g.translate(x, y, z); return g; };

function trunk(h = 1.3, color = '#7a5232'): Part {
  return at(tint(new THREE.CylinderGeometry(0.1, 0.18, h, 6), color, 0.08), 0, h / 2, 0);
}
function blob(r: number, x: number, y: number, z: number, color: string, seed: number): Part {
  const g = wobble(new THREE.IcosahedronGeometry(r, 1), r * 0.12, seed);
  return at(tint(g, color, 0.12, seed), x, y, z);
}

/** Four tree species: two round broadleaves, a conifer and a blossom tree. */
function treeGeometry(v: number): Part {
  if (v === 2) {
    const c = (r: number, h: number, y: number, col: string) =>
      at(tint(wobble(new THREE.ConeGeometry(r, h, 7, 1), 0.05, y * 10), col, 0.1), 0, y, 0);
    return mergeGeometries([
      trunk(0.8, '#6b4528'),
      c(0.95, 1.3, 1.25, '#2f6b4a'),
      c(0.75, 1.1, 1.85, '#37805a'),
      c(0.5, 0.9, 2.4, '#43966a'),
    ])!;
  }
  const palettes = [
    ['#3f8a3a', '#4fa444', '#5cb84c'],
    ['#5a9e30', '#6db63c', '#82c94a'],
    [],
    ['#f19ac0', '#f7b6d2', '#e483ae'],
  ];
  const p = palettes[v];
  return mergeGeometries([
    trunk(),
    blob(0.85, 0, 1.85, 0, p[0], 1 + v),
    blob(0.6, 0.5, 1.5, 0.2, p[1], 2 + v),
    blob(0.58, -0.45, 1.6, -0.1, p[1], 3 + v),
    blob(0.55, 0.05, 2.45, -0.05, p[2], 4 + v),
    blob(0.45, -0.2, 1.4, 0.45, p[2], 5 + v),
  ])!;
}

function bushGeometry(): Part {
  return mergeGeometries([
    blob(0.42, 0, 0.32, 0, '#3f8f3c', 11),
    blob(0.32, 0.35, 0.25, 0.1, '#4fa444', 12),
    blob(0.3, -0.33, 0.24, 0.05, '#5cb84c', 13),
  ])!;
}

function rockGeometry(): Part {
  const g = wobble(new THREE.DodecahedronGeometry(0.42, 0), 0.08, 21);
  g.scale(1, 0.65, 0.9);
  return at(tint(g, '#9aa0a6', 0.1), 0, 0.18, 0);
}

function instances(geo: Part, mat: THREE.Material, list: Prop[], map: WorldMap, scale: [number, number], shadow = true) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    const s = scale[0] + hash2(Math.floor(p.x * 10), Math.floor(p.z * 10), 3) * (scale[1] - scale[0]);
    q.setFromAxisAngle(up, hash2(Math.floor(p.x * 10), Math.floor(p.z * 10), 4) * Math.PI * 2);
    m.compose(new THREE.Vector3(p.x, heightAt(map, p.x, p.z) - 0.05, p.z), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

export function createNature(map: WorldMap): THREE.Group {
  const group = new THREE.Group();
  const leafMat = standard({ vertexColors: true });
  addWind(leafMat, 0.05, 1.0);

  // blossom trees are rarer: half of them become plain broadleaves
  const species = (p: Prop) => (p.v === 3 && hash2(Math.floor(p.x * 3), Math.floor(p.z * 3), 12) < 0.55 ? 0 : p.v);
  for (let v = 0; v < 4; v++) {
    const list = map.props.filter((p) => p.kind === 'tree' && species(p) === v);
    if (list.length) group.add(instances(treeGeometry(v), leafMat, list, map, [0.85, 1.25]));
  }
  const bushMat = standard({ vertexColors: true });
  addWind(bushMat, 0.06, 0.2);
  group.add(instances(bushGeometry(), bushMat, map.props.filter((p) => p.kind === 'bush'), map, [0.8, 1.15]));
  group.add(instances(rockGeometry(), standard({ vertexColors: true }), map.props.filter((p) => p.kind === 'rock'), map, [0.7, 1.2]));
  group.add(createFlowers(map));
  return group;
}

/** Little flowers: instanced stems + coloured heads. */
function createFlowers(map: WorldMap): THREE.Group {
  const pts: { x: number; z: number; c: number }[] = [];
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!map.flowers[map.i(x, z)]) continue;
      const n = 3 + Math.floor(hash2(x, z, 30) * 4);
      for (let k = 0; k < n; k++)
        pts.push({ x: x + 0.1 + hash2(x, z, 31 + k) * 0.8, z: z + 0.1 + hash2(x, z, 41 + k) * 0.8, c: Math.floor(hash2(x, z, 51 + k) * 5) });
    }
  const colors = ['#ffe066', '#ff7aa8', '#ffffff', '#8fd0ff', '#ff9a4a'].map((c) => new THREE.Color(c));
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 3);
  stemGeo.translate(0, 0.11, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.055, 0);
  headGeo.translate(0, 0.23, 0);
  const stemMat = standard({ color: '#4f9a3a' });
  const headMat = standard({ color: '#ffffff', emissive: '#222222' });
  addWind(stemMat, 0.25, 0.0);
  addWind(headMat, 0.25, 0.0);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, pts.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, pts.length);
  const m = new THREE.Matrix4();
  pts.forEach((p, i) => {
    const s = 0.8 + hash2(i, 1, 1) * 0.5;
    m.makeScale(s, s, s).setPosition(p.x, 0, p.z);
    stems.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, colors[p.c]);
  });
  const g = new THREE.Group();
  g.add(stems, heads);
  return g;
}
