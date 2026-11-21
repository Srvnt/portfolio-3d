/**
 * Small storytelling details: ivy on walls, mushrooms under trees, pebbles
 * along paths. Everything is generated, merged and instanced to stay cheap.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Building, Tile, WALL_H, WorldMap } from './map';
import { hash2, rng } from '../core/random';
import { leafTexture } from './nature';
import { uniforms } from './shared';

const PLINTH = 0.3;

// ------------------------------------------------------------------ ivy

let ivyMat: THREE.MeshStandardMaterial | null = null;
/** Two-sided leaf material with a gentle flutter (non-instanced meshes). */
function ivyMaterial() {
  if (ivyMat) return ivyMat;
  const m = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8 });
  m.customProgramCacheKey = () => 'ivy';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += objectNormal * sin(uTime * 4.0 + position.x * 11.0 + position.y * 7.0) * 0.012;`);
    shader.fragmentShader = shader.fragmentShader.replace(
      'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
  ivyMat = m;
  return m;
}

function leafCard(pos: THREE.Vector3, face: THREE.Vector3, size: number, color: THREE.Color, roll: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  const m = new THREE.Matrix4().lookAt(face, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  m.multiply(new THREE.Matrix4().makeRotationZ(roll));
  m.setPosition(pos);
  g.applyMatrix4(m);
  const n = new Float32Array(12), c = new Float32Array(12);
  for (let v = 0; v < 4; v++) { n.set([face.x, face.y, face.z], v * 3); c.set([color.r, color.g, color.b], v * 3); }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * Ivy climbing a building's walls, in the building's local frame.
 * Grows up from the plinth at the corners and side walls, avoiding the door.
 */
export function createIvy(b: Building, seed: number): THREE.Group {
  const r = rng(seed);
  const { w, d } = b;
  const g = new THREE.Group();
  const top = PLINTH + WALL_H - 0.12;
  type Spot = { base: THREE.Vector3; along: THREE.Vector3; normal: THREE.Vector3 };
  const spots: Spot[] = [
    { base: new THREE.Vector3(-w / 2 + 0.3, 0, d / 2 + 0.06), along: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1) },
    { base: new THREE.Vector3(w / 2 - 0.3, 0, d / 2 + 0.06), along: new THREE.Vector3(-1, 0, 0), normal: new THREE.Vector3(0, 0, 1) },
    { base: new THREE.Vector3(w / 2 + 0.06, 0, d / 2 - 0.35), along: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(1, 0, 0) },
    { base: new THREE.Vector3(-w / 2 - 0.06, 0, -d / 2 + 0.4), along: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(-1, 0, 0) },
    { base: new THREE.Vector3(-w / 2 - 0.06, 0, d / 2 - 0.35), along: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(-1, 0, 0) },
  ];
  // each building gets 2–3 of the possible spots
  const chosen = spots.filter(() => r() < 0.55).slice(0, 3);
  if (!chosen.length) chosen.push(spots[0]);

  const stems: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const flowers: THREE.Vector3[] = [];
  const dark = new THREE.Color('#1f5226'), light = new THREE.Color('#79b84a');
  const c = new THREE.Color();

  const grow = (start: THREE.Vector3, sp: Spot, height: number, lean: number) => {
    const pts: THREE.Vector3[] = [start.clone()];
    let u = 0;
    for (let y = start.y + 0.25; y < height; y += 0.25) {
      u += lean * 0.1 + (r() - 0.5) * 0.16;
      pts.push(sp.base.clone().addScaledVector(sp.along, u + start.clone().sub(sp.base).dot(sp.along)).setY(y));
    }
    if (pts.length < 3) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, pts.length * 4, 0.016, 4);
    tube.deleteAttribute('uv');
    const col = new Float32Array(tube.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([0.33, 0.27, 0.16], i);
    tube.setAttribute('color', new THREE.BufferAttribute(col, 3));
    stems.push(tube);
    const len = curve.getLength();
    for (let s = 0; s < len; s += 0.07) {
      const t = s / len;
      const p = curve.getPointAt(t);
      const fullness = 1 - t * 0.55; // bushier near the bottom
      for (let k = 0; k < 2; k++) {
        if (r() > fullness + 0.2) continue;
        const side = (r() - 0.5) * 0.36 * fullness;
        const pos = p.clone().addScaledVector(sp.along, side).addScaledVector(sp.normal, 0.02 + r() * 0.05);
        const face = sp.normal.clone().add(new THREE.Vector3((r() - 0.5) * 0.8, 0.3 + r() * 0.4, (r() - 0.5) * 0.8)).normalize();
        c.copy(dark).lerp(light, Math.min(1, p.y / top * 0.6 + r() * 0.4));
        leaves.push(leafCard(pos, face, 0.22 + r() * 0.16, c, r() * Math.PI * 2));
        if (r() < 0.04) flowers.push(pos.clone().addScaledVector(sp.normal, 0.05));
      }
    }
    return curve;
  };

  for (const sp of chosen) {
    const height = PLINTH + 0.9 + r() * (top - PLINTH - 0.9);
    const main = grow(sp.base.clone().setY(0.05), sp, height, 0);
    if (!main) continue;
    // a couple of side branches leaning away from the main stem
    for (let k = 0; k < 2; k++) {
      const from = main.getPointAt(0.25 + r() * 0.4);
      grow(from, sp, Math.min(top, from.y + 0.6 + r() * 0.8), k === 0 ? 1 : -1);
    }
  }

  if (stems.length) {
    const stemMesh = new THREE.Mesh(mergeGeometries(stems)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    stemMesh.castShadow = true;
    g.add(stemMesh);
  }
  if (leaves.length) {
    const leafMesh = new THREE.Mesh(mergeGeometries(leaves)!, ivyMaterial());
    leafMesh.castShadow = leafMesh.receiveShadow = true;
    g.add(leafMesh);
  }
  if (flowers.length) {
    const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#2a1a3a' }), flowers.length);
    const cols = ['#c9a2f2', '#ffffff', '#f7c6e0'].map((x) => new THREE.Color(x));
    flowers.forEach((p, i) => {
      fm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      fm.setColorAt(i, cols[i % cols.length]);
    });
    g.add(fm);
  }
  return g;
}

// ------------------------------------------------------------------ ground

/** Mushroom rings at tree roots and pebbles along path edges. */
export function createGroundDetails(map: WorldMap): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // mushrooms
  const shrooms: { x: number; z: number; s: number; c: number }[] = [];
  for (const p of map.props) {
    if (!p.inside || p.kind !== 'tree') continue;
    const hx = Math.floor(p.x * 7), hz = Math.floor(p.z * 7);
    if (hash2(hx, hz, 60) > 0.4) continue;
    const n = 2 + Math.floor(hash2(hx, hz, 61) * 4);
    const base = hash2(hx, hz, 62) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = base + k * 0.5 + hash2(hx, k, 63) * 0.3;
      const rad = 0.3 + hash2(hx, k, 64) * 0.25;
      shrooms.push({ x: p.x + Math.cos(a) * rad, z: p.z + Math.sin(a) * rad, s: 0.7 + hash2(hz, k, 65) * 0.7, c: Math.floor(hash2(hx, hz, 66) * 3) });
    }
  }
  const stemGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.12, 6);
  stemGeo.translate(0, 0.06, 0);
  const capGeo = new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.scale(1, 0.7, 1);
  capGeo.translate(0, 0.11, 0);
  const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ color: '#f2ead8', roughness: 0.8 }), shrooms.length);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), shrooms.length);
  const capColors = ['#d8473a', '#b8803f', '#e8913a'].map((x) => new THREE.Color(x));
  shrooms.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(Math.cos(i), 0, Math.sin(i)), (hash2(i, 1, 67) - 0.5) * 0.4);
    m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
    stems.setMatrixAt(i, m);
    caps.setMatrixAt(i, m);
    caps.setColorAt(i, capColors[s.c]);
  });
  stems.castShadow = caps.castShadow = true;
  g.add(stems, caps);

  // pebbles along path edges
  const pebbles: THREE.Matrix4[] = [];
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (map.tile(x, z) !== Tile.Path) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (map.tile(x + dx, z + dz) !== Tile.Grass) continue;
        for (let k = 0; k < 2; k++) {
          if (hash2(x * 4 + dx, z * 4 + dz, 70 + k) < 0.45) continue;
          const along = hash2(x, z * 3 + k, 71 + dx) - 0.5;
          const px = x + 0.5 + dx * 0.62 + (dz ? along : 0);
          const pz = z + 0.5 + dz * 0.62 + (dx ? along : 0);
          const s = 0.06 + hash2(x, z, 72 + k) * 0.08;
          q.setFromAxisAngle(up, hash2(x, z, 73 + k) * 6.28);
          pebbles.push(new THREE.Matrix4().compose(new THREE.Vector3(px, s * 0.3, pz), q, new THREE.Vector3(s, s * 0.6, s * 0.85)));
        }
      }
    }
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
  const pebbleMesh = new THREE.InstancedMesh(pebbleGeo, new THREE.MeshStandardMaterial({ color: '#b7b0a2', roughness: 0.9, flatShading: true }), pebbles.length);
  const pc = new THREE.Color();
  pebbles.forEach((mm, i) => {
    pebbleMesh.setMatrixAt(i, mm);
    pebbleMesh.setColorAt(i, pc.setHSL(0.09, 0.1, 0.55 + hash2(i, 2, 74) * 0.25));
  });
  pebbleMesh.castShadow = pebbleMesh.receiveShadow = true;
  g.add(pebbleMesh);
  return g;
}
