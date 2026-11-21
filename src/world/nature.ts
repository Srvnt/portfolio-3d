import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Prop, WorldMap } from './map';
import { hash2, rng } from '../core/random';
import { heightAt } from './terrain';
import { addWind, canvasTexture, makeCanvas, standard, tint, uniforms, wobble } from './shared';

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
  { r: 0.9, x: 0, y: 1.95, z: 0 },
  { r: 0.66, x: 0.58, y: 1.62, z: 0.18 },
  { r: 0.62, x: -0.52, y: 1.72, z: -0.12 },
  { r: 0.6, x: 0.06, y: 2.55, z: -0.05 },
  { r: 0.52, x: -0.22, y: 1.5, z: 0.52 },
  { r: 0.5, x: 0.32, y: 2.2, z: -0.48 },
];

const SPECIES: Species[] = [
  { trunkH: 1.45, trunk: '#6e4a2c', blobs: BROADLEAF, dark: '#1f4f26', mid: '#3d8c38', light: '#9cd866', cards: 46, cardSize: 0.62 },
  { trunkH: 1.45, trunk: '#7a5232', blobs: BROADLEAF.map((b) => ({ ...b, r: b.r * 1.05 })), dark: '#33641e', mid: '#5fa63a', light: '#c4e67a', cards: 46, cardSize: 0.62 },
  // index 2 = conifer (built separately)
  { trunkH: 0.8, trunk: '#5e3d24', blobs: [], dark: '#173f2e', mid: '#2e7450', light: '#7cc08a', cards: 0, cardSize: 0 },
  { trunkH: 1.35, trunk: '#6a4630', blobs: BROADLEAF.map((b) => ({ ...b, r: b.r * 0.95 })), dark: '#b04c78', mid: '#ee8ab4', light: '#ffe0ee', cards: 52, cardSize: 0.55 },
];

/** Colour a surface point: dark underside → mid → sunlit top. */
function shade(sp: Species, n: THREE.Vector3, h: number, jitter: number, out: THREE.Color) {
  const dark = new THREE.Color(sp.dark), mid = new THREE.Color(sp.mid), light = new THREE.Color(sp.light);
  const ndl = Math.max(0, n.dot(SUN));
  out.copy(dark).lerp(mid, Math.min(1, smooth(0, 0.65, h) * 0.75 + ndl * 0.35));
  out.lerp(light, Math.pow(ndl, 2.2) * (0.35 + h * 0.5));
  out.multiplyScalar(0.92 + jitter * 0.16);
  return out;
}

function canopyCenter(blobs: Blob[]) {
  const c = new THREE.Vector3();
  let w = 0;
  for (const b of blobs) { c.add(tmp.set(b.x, b.y, b.z).multiplyScalar(b.r)); w += b.r; }
  return c.divideScalar(w);
}

/** Soft, lumpy canopy: smooth spheres with cloud-like bumps and blended normals. */
function canopyGeometry(sp: Species, detail: number, seed: number): Geo {
  const center = canopyCenter(sp.blobs);
  const bottom = Math.min(...sp.blobs.map((b) => b.y - b.r));
  const top = Math.max(...sp.blobs.map((b) => b.y + b.r));
  const parts = sp.blobs.map((b, i) => {
    let g: Geo = new THREE.IcosahedronGeometry(b.r, detail);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position;
    const normals = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k));
      const n = v.clone().normalize();
      const bump = (Math.sin(v.x * 5 + seed + i) + Math.sin(v.y * 6 - seed) + Math.sin(v.z * 5.5 + i * 2)) / 3;
      v.addScaledVector(n, bump * b.r * 0.13);
      p.setXYZ(k, v.x + b.x, v.y + b.y, v.z + b.z);
      normals.set([n.x, n.y, n.z], k * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return g;
  });
  const g = mergeGeometries(parts)!;
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < p.count; k++) {
    const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k));
    // blend per-blob normal with whole-canopy normal: soft "cotton" shading that keeps clumps readable
    const n = new THREE.Vector3(nrm.getX(k), nrm.getY(k), nrm.getZ(k)).multiplyScalar(0.45)
      .add(v.clone().sub(center).normalize().multiplyScalar(0.55)).normalize();
    nrm.setXYZ(k, n.x, n.y, n.z);
    shade(sp, n, (v.y - bottom) / (top - bottom), hash2(k, seed, 3), c);
    colors.set([c.r, c.g, c.b], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Leaf clusters (alpha cards) scattered over the canopy surface, facing outward. */
function cardGeometry(sp: Species, count: number, seed: number): Geo {
  const r = rng(seed);
  const center = canopyCenter(sp.blobs);
  const bottom = Math.min(...sp.blobs.map((b) => b.y - b.r));
  const top = Math.max(...sp.blobs.map((b) => b.y + b.r));
  const weights = sp.blobs.map((b) => b.r * b.r);
  const total = weights.reduce((a, b) => a + b, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const roll = new THREE.Matrix4();
  const c = new THREE.Color();
  const cards: Geo[] = [];
  for (let k = 0; k < count; k++) {
    let pick = r() * total;
    let b = sp.blobs[0];
    for (let i = 0; i < sp.blobs.length; i++) { pick -= weights[i]; if (pick <= 0) { b = sp.blobs[i]; break; } }
    const y = r() * 1.6 - 0.6;
    const th = r() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    const dir = new THREE.Vector3(ring * Math.cos(th), y, ring * Math.sin(th));
    const pos = new THREE.Vector3(b.x, b.y, b.z).addScaledVector(dir, b.r * (0.88 + r() * 0.22));
    const s = sp.cardSize * (0.75 + r() * 0.5);
    const g = new THREE.PlaneGeometry(s, s);
    m.lookAt(dir, new THREE.Vector3(), Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up);
    m.multiply(roll.makeRotationZ(r() * Math.PI * 2));
    m.setPosition(pos);
    g.applyMatrix4(m);
    const n = dir.clone().multiplyScalar(0.4).add(pos.clone().sub(center).normalize().multiplyScalar(0.6)).normalize();
    const nArr = new Float32Array(12);
    const cArr = new Float32Array(12);
    shade(sp, n, (pos.y - bottom) / (top - bottom), r(), c);
    c.multiplyScalar(1.08);
    for (let v = 0; v < 4; v++) { nArr.set([n.x, n.y, n.z], v * 3); cArr.set([c.r, c.g, c.b], v * 3); }
    g.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
    cards.push(g);
  }
  return mergeGeometries(cards)!;
}

/** Slightly bent trunk with two branches reaching into the canopy. */
function trunkGeometry(sp: Species): Geo {
  const h = sp.trunkH;
  const parts: Geo[] = [];
  const main = new THREE.CylinderGeometry(0.09, 0.18, h, 9, 4);
  main.translate(0, h / 2, 0);
  const p = main.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin((y / h) * Math.PI) * 0.07);
    if (y < 0.12) { p.setX(i, p.getX(i) * 1.35); p.setZ(i, p.getZ(i) * 1.35); } // root flare
  }
  main.computeVertexNormals();
  parts.push(main);
  for (const [rz, ry] of [[0.75, 0.4], [-0.7, 2.6]]) {
    const br = new THREE.CylinderGeometry(0.035, 0.07, 0.75, 6);
    br.translate(0, 0.37, 0);
    br.rotateZ(rz);
    br.rotateY(ry);
    br.translate(0, h * 0.78, 0);
    parts.push(br);
  }
  const g = mergeGeometries(parts.map((x) => { x.deleteAttribute('uv'); return x; }))!;
  const col = new THREE.Color(sp.trunk);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.7 + Math.min(1, pos.getY(i) / h) * 0.35;
    colors.set([col.r * k, col.g * k, col.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Layered pine with jagged, drooping skirts and smooth shading. */
function coniferGeometry(sp: Species): Geo {
  const tiers = [[1.0, 1.25, 1.2], [0.82, 1.1, 1.75], [0.62, 0.95, 2.25], [0.4, 0.8, 2.7]];
  const parts: Geo[] = [];
  tiers.forEach(([r, h, y], t) => {
    let g: Geo = new THREE.ConeGeometry(r, h, 14, 3, true);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      if (vy < -h / 2 + 0.01) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const jag = 1 + Math.sin(a * 7 + t) * 0.12;
        p.setX(i, p.getX(i) * jag);
        p.setZ(i, p.getZ(i) * jag);
        p.setY(i, vy - 0.12 - Math.sin(a * 7 + t) * 0.06);
      }
    }
    g.translate(0, y, 0);
    g.computeVertexNormals();
    parts.push(g);
  });
  const g = mergeGeometries(parts)!;
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    shade(sp, n, (p.getY(i) - 0.5) / 2.8, hash2(i, 5, 5), c);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return mergeGeometries([trunkGeometry(sp), g])!;
}

// ------------------------------------------------------------------ materials

function leafTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  const r = rng(7);
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 34;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + (r() - 0.5) * 0.6);
    const g = 200 + Math.floor(r() * 55);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8 + r() * 4, 17 + r() * 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,120,120,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
    ctx.restore();
  }
  return canvasTexture(canvas);
}

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

export function createNature(map: WorldMap, lowEnd = false): THREE.Group {
  const group = new THREE.Group();
  const leafTex = leafTexture();
  const canopyMat = foliageMaterial({ amp: 0.05, minY: 1.0, flutter: 0, twoSided: false });
  const cardMat = foliageMaterial({ map: leafTex, amp: 0.05, minY: 1.0, flutter: 0.03, twoSided: true });
  const pineMat = foliageMaterial({ amp: 0.035, minY: 0.9, flutter: 0, twoSided: false });

  // blossom trees are rarer: about half of them become plain broadleaves
  const species = (p: Prop) => (p.v === 3 && hash2(Math.floor(p.x * 3), Math.floor(p.z * 3), 12) < 0.55 ? 0 : p.v);
  for (let v = 0; v < 4; v++) {
    const sp = SPECIES[v];
    for (const near of [true, false]) {
      // village trees get full detail; the forest on the hills is lighter
      const list = map.props.filter((p) => p.kind === 'tree' && p.inside === near && species(p) === v);
      if (!list.length) continue;
      let geos: [Geo, THREE.Material][];
      if (v === 2) geos = [[coniferGeometry(sp), pineMat]];
      else {
        const detail = near && !lowEnd ? 2 : 1;
        const cards = Math.round(sp.cards * (near ? (lowEnd ? 0.5 : 1) : 0.3));
        geos = [
          [mergeGeometries([trunkGeometry(sp), canopyGeometry(sp, detail, v * 7 + 1)])!, canopyMat],
          [cardGeometry(sp, cards, v * 13 + 5), cardMat],
        ];
      }
      group.add(...placeAll(geos, list, map, [0.85, 1.25]));
    }
  }

  // bushes: same soft style, close to the ground
  const bush: Species = {
    trunkH: 0, trunk: '#000', dark: '#245a28', mid: '#46993f', light: '#a8dc6c', cards: 14, cardSize: 0.42,
    blobs: [{ r: 0.42, x: 0, y: 0.34, z: 0 }, { r: 0.33, x: 0.36, y: 0.26, z: 0.1 }, { r: 0.31, x: -0.34, y: 0.25, z: 0.05 }],
  };
  const bushMat = foliageMaterial({ amp: 0.06, minY: 0.15, flutter: 0, twoSided: false });
  const bushCards = foliageMaterial({ map: leafTex, amp: 0.06, minY: 0.15, flutter: 0.025, twoSided: true });
  group.add(...placeAll(
    [[canopyGeometry(bush, lowEnd ? 1 : 2, 31), bushMat], [cardGeometry(bush, bush.cards, 33), bushCards]],
    map.props.filter((p) => p.kind === 'bush'), map, [0.8, 1.15],
  ));

  const rocks = placeAll([[rockGeometry(), standard({ vertexColors: true })]], map.props.filter((p) => p.kind === 'rock'), map, [0.7, 1.2]);
  group.add(...rocks);
  group.add(createFlowers(map));
  return group;
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
