import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop, WorldMap } from './map';
import { hash2, rng } from '../core/random';
import { heightAt } from './terrain';
import { addWind, canvasTexture, makeCanvas, standard, tint, uniforms, wobble } from './shared';

/*
 * Trees are built entirely from leaf clusters (alpha cards) — no solid canopy.
 * Cards fill each foliage volume, denser and brighter toward the outside,
 * darker inside, so the tree reads as a full, airy crown with branches
 * peeking through.
 */

type Geo = THREE.BufferGeometry;
const SUN = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
const tmp = new THREE.Vector3();
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ species

interface Blob { r: number; x: number; y: number; z: number }
interface Species {
  trunkH: number;
  trunk: string;
  blobs: Blob[];
  dark: string; mid: string; light: string;
  cards: number;
  cardSize: number;
}

const BROADLEAF: Blob[] = [
  { r: 0.95, x: 0, y: 1.95, z: 0 },
  { r: 0.7, x: 0.6, y: 1.6, z: 0.2 },
  { r: 0.66, x: -0.55, y: 1.72, z: -0.12 },
  { r: 0.64, x: 0.06, y: 2.6, z: -0.05 },
  { r: 0.55, x: -0.24, y: 1.5, z: 0.55 },
  { r: 0.52, x: 0.34, y: 2.25, z: -0.5 },
];

const SPECIES: Species[] = [
  { trunkH: 1.5, trunk: '#6e4a2c', blobs: BROADLEAF, dark: '#1b4a22', mid: '#3d8c38', light: '#a2dc6a', cards: 230, cardSize: 0.88 },
  { trunkH: 1.5, trunk: '#7a5232', blobs: BROADLEAF.map((b) => ({ ...b, r: b.r * 1.05 })), dark: '#2e5e1c', mid: '#5fa63a', light: '#c8ea7e', cards: 240, cardSize: 0.88 },
  // pine: tiers instead of blobs (r = radius, y = tier centre, x = tier height)
  { trunkH: 2.9, trunk: '#5e3d24', blobs: [
    { r: 1.3, x: 1.25, y: 1.15, z: 0 }, { r: 1.05, x: 1.1, y: 1.75, z: 0 },
    { r: 0.8, x: 1.0, y: 2.3, z: 0 }, { r: 0.5, x: 0.85, y: 2.8, z: 0 },
  ], dark: '#1a4a34', mid: '#3a8a5c', light: '#9ad8a4', cards: 230, cardSize: 0.72 },
  { trunkH: 1.45, trunk: '#6a4630', blobs: BROADLEAF.map((b) => ({ ...b, r: b.r * 0.95 })), dark: '#a8466f', mid: '#ee8ab4', light: '#ffe2ef', cards: 250, cardSize: 0.78 },
];

/** Colour a leaf: dark inside/underneath → mid → sunlit top. */
function shade(sp: Species, n: THREE.Vector3, h: number, depth: number, jitter: number, out: THREE.Color) {
  const dark = new THREE.Color(sp.dark), mid = new THREE.Color(sp.mid), light = new THREE.Color(sp.light);
  const ndl = Math.max(0, n.dot(SUN));
  out.copy(dark).lerp(mid, Math.min(1, smooth(0, 0.65, h) * 0.6 + ndl * 0.35 + depth * 0.25));
  out.lerp(light, Math.pow(ndl, 2) * (0.3 + h * 0.45) * depth);
  // self-shadowing: leaves deep inside the crown are darker
  out.multiplyScalar((0.72 + depth * 0.3) * (0.9 + jitter * 0.2));
  return out;
}

function crownCenter(blobs: Blob[]) {
  const c = new THREE.Vector3();
  let w = 0;
  for (const b of blobs) { c.add(tmp.set(b.x, b.y, b.z).multiplyScalar(b.r)); w += b.r; }
  return c.divideScalar(w);
}

/** One leaf card at `pos`, facing `dir`, coloured and lit as part of the crown. */
function card(pos: THREE.Vector3, dir: THREE.Vector3, size: number, normal: THREE.Vector3, color: THREE.Color, roll: number): Geo {
  const g = new THREE.PlaneGeometry(size, size);
  const m = new THREE.Matrix4();
  m.lookAt(dir, new THREE.Vector3(), Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.multiply(new THREE.Matrix4().makeRotationZ(roll));
  m.setPosition(pos);
  g.applyMatrix4(m);
  const nArr = new Float32Array(12);
  const cArr = new Float32Array(12);
  for (let v = 0; v < 4; v++) { nArr.set([normal.x, normal.y, normal.z], v * 3); cArr.set([color.r, color.g, color.b], v * 3); }
  g.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
  return g;
}

/** Broadleaf/bush crown: cards filling each blob, biased toward the surface. */
function crownCards(sp: Species, count: number, seed: number): Geo {
  const r = rng(seed);
  const center = crownCenter(sp.blobs);
  const bottom = Math.min(...sp.blobs.map((b) => b.y - b.r));
  const top = Math.max(...sp.blobs.map((b) => b.y + b.r));
  const weights = sp.blobs.map((b) => b.r * b.r);
  const total = weights.reduce((a, b) => a + b, 0);
  const c = new THREE.Color();
  const cards: Geo[] = [];
  for (let k = 0; k < count; k++) {
    let pick = r() * total;
    let b = sp.blobs[0];
    for (let i = 0; i < sp.blobs.length; i++) { pick -= weights[i]; if (pick <= 0) { b = sp.blobs[i]; break; } }
    const y = r() * 1.75 - 0.75;
    const th = r() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    const dir = new THREE.Vector3(ring * Math.cos(th), y, ring * Math.sin(th));
    // depth 1 = outer surface, lower = inside the crown
    const depth = 1 - Math.pow(r(), 2.2) * 0.6;
    const pos = new THREE.Vector3(b.x, b.y, b.z).addScaledVector(dir, b.r * depth);
    const n = dir.clone().multiplyScalar(0.45).add(pos.clone().sub(center).normalize().multiplyScalar(0.55)).normalize();
    shade(sp, n, (pos.y - bottom) / (top - bottom), depth, r(), c);
    // tilt cards a little off the normal so the crown looks ruffled
    const face = dir.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.9)).normalize();
    cards.push(card(pos, face, sp.cardSize * (0.7 + r() * 0.6) * (0.75 + depth * 0.35), n, c, r() * Math.PI * 2));
  }
  return mergeGeometries(cards)!;
}

/** Pine: cards on drooping cone tiers, pointing outward and down like boughs. */
function pineCards(sp: Species, count: number, seed: number): Geo {
  const r = rng(seed);
  const c = new THREE.Color();
  const cards: Geo[] = [];
  const tiers = sp.blobs;
  const weights = tiers.map((t) => t.r * t.r);
  const total = weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < count; k++) {
    let pick = r() * total;
    let t = tiers[0];
    for (let i = 0; i < tiers.length; i++) { pick -= weights[i]; if (pick <= 0) { t = tiers[i]; break; } }
    const h = t.x;
    const f = Math.pow(r(), 0.7); // more cards near the wide bottom of each tier
    const a = r() * Math.PI * 2;
    const depth = 1 - Math.pow(r(), 2) * 0.5;
    const rad = t.r * (1 - (1 - f) * 0.85) * depth;
    const y = t.y + h / 2 - f * h - (f > 0.8 ? (f - 0.8) * 0.5 : 0);
    const pos = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad);
    const out = new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize();
    const face = out.clone().add(new THREE.Vector3(0, -0.6, 0)).normalize();
    shade(sp, out, (y - 0.4) / 2.8, depth, r(), c);
    cards.push(card(pos, face, sp.cardSize * (0.7 + r() * 0.5) * (0.8 + f * 0.5), out, c, r() * 0.6 - 0.3 + Math.PI));
  }
  // a little tuft on the very top
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const out = new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3).normalize();
    shade(sp, out, 1, 1, r(), c);
    cards.push(card(new THREE.Vector3(Math.cos(a) * 0.08, 3.15, Math.sin(a) * 0.08), out, sp.cardSize * 0.55, out, c, Math.PI));
  }
  return mergeGeometries(cards)!;
}

/** A tapered cylinder from a to b. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 6): Geo {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  g.deleteAttribute('uv');
  return g;
}

/** Bent trunk with root flare and a branch reaching into each foliage clump. */
function trunkGeometry(sp: Species, pine: boolean): Geo {
  const h = sp.trunkH;
  const main = new THREE.CylinderGeometry(pine ? 0.05 : 0.08, pine ? 0.16 : 0.18, h, 9, 5);
  main.translate(0, h / 2, 0);
  main.deleteAttribute('uv');
  const p = main.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin((y / h) * Math.PI) * (pine ? 0.02 : 0.07));
    if (y < 0.12) { p.setX(i, p.getX(i) * 1.4); p.setZ(i, p.getZ(i) * 1.4); }
  }
  main.computeVertexNormals();
  const parts: Geo[] = [main];
  if (!pine) {
    for (const b of sp.blobs) {
      if (b.x === 0 && b.z === 0) continue;
      const from = new THREE.Vector3(Math.sin((Math.min(b.y - 0.3, h * 0.9) / h) * Math.PI) * 0.07, Math.min(b.y - 0.35, h * 0.88), 0);
      const to = new THREE.Vector3(b.x * 0.85, b.y + 0.05, b.z * 0.85);
      parts.push(limb(from, to, 0.06, 0.025));
      // a small twig off each branch
      const mid = from.clone().lerp(to, 0.55);
      parts.push(limb(mid, mid.clone().add(new THREE.Vector3(-b.z * 0.4, 0.35, b.x * 0.4)), 0.025, 0.01, 4));
    }
  }
  const g = mergeGeometries(parts)!;
  const col = new THREE.Color(sp.trunk);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.65 + Math.min(1, pos.getY(i) / h) * 0.4;
    colors.set([col.r * k, col.g * k, col.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// ------------------------------------------------------------------ textures

/** A clump of rounded leaves, white so vertex colours tint it. */
function leafTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  const r = rng(7);
  for (let i = 0; i < 34; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 80;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + (r() - 0.5) * 0.8);
    const len = 22 + r() * 12;
    const g = ctx.createLinearGradient(0, -len, 0, len);
    const v = 215 + Math.floor(r() * 40);
    g.addColorStop(0, `rgb(${v},${v},${v})`);
    g.addColorStop(1, `rgb(${v - 45},${v - 45},${v - 45})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.quadraticCurveTo(len * 0.62, 0, 0, len);
    ctx.quadraticCurveTo(-len * 0.62, 0, 0, -len);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,110,110,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -len * 0.85); ctx.lineTo(0, len * 0.9); ctx.stroke();
    ctx.restore();
  }
  return canvasTexture(canvas);
}

/** Fan of pine needles. */
function needleTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  const r = rng(11);
  ctx.lineCap = 'round';
  for (let s = 0; s < 5; s++) {
    // a sprig: centre stem with needles both sides
    const sx = 50 + s * 38 + (r() - 0.5) * 20;
    const bend = (r() - 0.5) * 30;
    for (let k = 0; k < 26; k++) {
      const t = k / 26;
      const x = sx + bend * t;
      const y = 20 + t * 215;
      const len = 26 * (1 - t * 0.5) + r() * 6;
      const v = 200 + Math.floor(r() * 55);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + side * len, y + len * 0.55);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgb(170,170,170)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx, 20); ctx.lineTo(sx + bend, 235); ctx.stroke();
  }
  return canvasTexture(canvas);
}

// ------------------------------------------------------------------ materials

/** Sway with the wind; optional per-vertex flutter for leaves; optional two-sided lighting. */
function foliageMaterial(opts: { map?: THREE.Texture; amp: number; minY: number; flutter: number; twoSided: boolean }) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.8, map: opts.map ?? null,
    alphaTest: opts.map ? 0.45 : 0, side: opts.twoSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.customProgramCacheKey = () => `foliage-${opts.amp}-${opts.minY}-${opts.flutter}-${opts.twoSided}-${!!opts.map}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 ip = instanceMatrix[3].xz;
        float hgt = max(position.y - ${opts.minY.toFixed(2)}, 0.0);
        float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.08);
        transformed.x += sin(uTime * 1.3 + ip.x * 0.5 + ip.y * 0.3) * ${opts.amp.toFixed(3)} * hgt * gust;
        transformed.z += cos(uTime * 1.1 + ip.x * 0.3) * ${(opts.amp * 0.6).toFixed(3)} * hgt * gust;
        transformed += objectNormal * sin(uTime * 6.5 + position.x * 9.0 + position.z * 7.0 + position.y * 5.0 + ip.x) * ${opts.flutter.toFixed(3)} * hgt;`,
      );
    if (opts.twoSided)
      shader.fragmentShader = shader.fragmentShader.replace(
        'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
        'float faceDirection = 1.0;',
      );
  };
  return m;
}

// ------------------------------------------------------------------ placement

function placeAll(geos: [Geo, THREE.Material][], list: Prop[], map: WorldMap, scale: [number, number]) {
  const out: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const matrices = list.map((p) => {
    const hx = Math.floor(p.x * 10), hz = Math.floor(p.z * 10);
    const s = scale[0] + hash2(hx, hz, 3) * (scale[1] - scale[0]);
    q.setFromAxisAngle(up, hash2(hx, hz, 4) * Math.PI * 2);
    return m.compose(new THREE.Vector3(p.x, heightAt(map, p.x, p.z) - 0.05, p.z), q, new THREE.Vector3(s, s * (0.92 + hash2(hx, hz, 5) * 0.2), s)).clone();
  });
  for (const [geo, mat] of geos) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

function rockGeometry(): Geo {
  const g = wobble(new THREE.DodecahedronGeometry(0.42, 0), 0.08, 21);
  g.scale(1, 0.65, 0.9);
  g.translate(0, 0.18, 0);
  return tint(g, '#9aa0a6', 0.1);
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
    const s = 1.5 + hash2(i, 1, 1) * 0.7; // tall enough to peek over the grass
    m.makeScale(s, s, s).setPosition(p.x, 0, p.z);
    stems.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, colors[p.c]);
  });
  const g = new THREE.Group();
  g.add(stems, heads);
  return g;
}

export function createNature(map: WorldMap, lowEnd = false): THREE.Group {
  const group = new THREE.Group();
  const leafTex = leafTexture();
  const needleTex = needleTexture();
  const woodMat = foliageMaterial({ amp: 0.03, minY: 1.0, flutter: 0, twoSided: false });
  const leafMat = foliageMaterial({ map: leafTex, amp: 0.05, minY: 1.0, flutter: 0.035, twoSided: true });
  const needleMat = foliageMaterial({ map: needleTex, amp: 0.035, minY: 0.8, flutter: 0.015, twoSided: true });

  // blossom trees are rarer: about half of them become plain broadleaves
  const species = (p: Prop) => (p.v === 3 && hash2(Math.floor(p.x * 3), Math.floor(p.z * 3), 12) < 0.55 ? 0 : p.v);
  for (let v = 0; v < 4; v++) {
    const sp = SPECIES[v];
    const pine = v === 2;
    for (const near of [true, false]) {
      // village trees get full leaf density; the hillside forest is lighter
      const list = map.props.filter((p) => p.kind === 'tree' && p.inside === near && species(p) === v);
      if (!list.length) continue;
      const density = near ? (lowEnd ? 0.55 : 1) : (lowEnd ? 0.3 : 0.45);
      const count = Math.round(sp.cards * density);
      const leaves = pine ? pineCards(sp, count, v * 13 + 5) : crownCards(sp, count, v * 13 + 5);
      group.add(...placeAll([
        [trunkGeometry(sp, pine), woodMat],
        [leaves, pine ? needleMat : leafMat],
      ], list, map, [0.85, 1.25]));
    }
  }

  // bushes: a low leafy crown, no trunk
  const bush: Species = {
    trunkH: 0, trunk: '#000', dark: '#2a6a2c', mid: '#5cb24a', light: '#c4ec84', cards: 120, cardSize: 0.6,
    blobs: [{ r: 0.58, x: 0, y: 0.58, z: 0 }, { r: 0.45, x: 0.46, y: 0.42, z: 0.12 }, { r: 0.42, x: -0.44, y: 0.4, z: 0.06 }],
  };
  const bushMat = foliageMaterial({ map: leafTex, amp: 0.06, minY: 0.12, flutter: 0.025, twoSided: true });
  group.add(...placeAll(
    [[crownCards(bush, lowEnd ? 64 : bush.cards, 33), bushMat]],
    map.props.filter((p) => p.kind === 'bush'), map, [0.95, 1.3],
  ));

  group.add(...placeAll([[rockGeometry(), standard({ vertexColors: true })]], map.props.filter((p) => p.kind === 'rock'), map, [0.7, 1.2]));
  group.add(createFlowers(map));
  return group;
}
