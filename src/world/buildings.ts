import * as THREE from 'three';
import { Building, ROOF_H, WALL_H } from './map';
import { canvasTexture, makeCanvas, standard } from './shared';
import { rng, valueNoise } from '../core/random';
import { createIvy } from './decals';

const PLINTH = 0.3;
const PLASTER = '#f3ead2';
const TIMBER = '#6b4428';

function weatheredPlaster(seed: number): THREE.CanvasTexture {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const r = rng(seed);
  ctx.fillStyle = PLASTER;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, r() < 0.5 ? 'rgba(220,205,175,0.35)' : 'rgba(255,250,235,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * S, len = 60 + r() * 180, wdt = 3 + r() * 8;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(120,110,85,0.28)');
    g.addColorStop(1, 'rgba(120,110,85,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, wdt, len);
  }
  const dirt = ctx.createLinearGradient(0, S, 0, S * 0.62);
  dirt.addColorStop(0, 'rgba(92,98,58,0.6)');
  dirt.addColorStop(0.45, 'rgba(120,110,80,0.25)');
  dirt.addColorStop(1, 'rgba(120,110,80,0)');
  ctx.fillStyle = dirt;
  ctx.fillRect(0, S * 0.62, S, S * 0.38);
  for (let i = 0; i < 3; i++) {
    const px = r() * (S - 120), py = 60 + r() * (S - 200), pw = 60 + r() * 60, ph = 40 + r() * 40;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, (r() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#8a6a55';
    ctx.fillRect(px, py, pw, ph);
    for (let by = py; by < py + ph; by += 12) {
      const off = ((by - py) / 12) % 2 ? 12 : 0;
      for (let bx = px - off; bx < px + pw; bx += 24) {
        ctx.fillStyle = r() < 0.5 ? '#b36b4c' : '#a35e42';
        ctx.fillRect(bx + 1, by + 1, 22, 10);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(160,145,115,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(90,80,60,0.45)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    let x = r() * S, y = r() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += 8 + r() * 18; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return canvasTexture(canvas);
}

function fbm(x: number, y: number, seed: number, oct = 4) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += valueNoise(x * f, y * f, seed + o * 17) * a; norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}

function mossTextures(seed: number, span: number, slope: number): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const height = new Float32Array(S * S);
  const deep = new THREE.Color('#557f2e'), mid = new THREE.Color('#86ad3e'), tip = new THREE.Color('#cfe06a');
  const rust = new THREE.Color('#a07a34'), lichen = new THREE.Color('#cfd2b4');
  const c = new THREE.Color();
  for (let y = 0; y < S; y++) {
    const v = 1 - y / S;
    const bias = 0.3 * (1 - Math.min(1, v / 0.3)) + 0.12 * Math.max(0, (v - 0.86) / 0.14);
    const wy = v * slope;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const wx = (x / (S / 2)) * span;
      const n = fbm(wx / 1.7, wy / 1.7, seed);
      const grain = valueNoise(wx / 0.03, wy / 0.03, seed + 5) - 0.5;
      const density = n + bias - 0.56 + grain * 0.06;
      let a = 0;
      if (density > 0) {
        const bumps = fbm(wx / 0.11, wy / 0.11, seed + 9, 3);
        const h = Math.min(1, density * 9) * (0.6 + bumps * 0.55);
        height[i] = h;
        const sp = fbm(wx / 0.45, wy / 0.45, seed + 21, 2);
        c.copy(deep).lerp(mid, Math.min(1, h * 1.4)).lerp(tip, Math.max(0, (bumps - 0.5) * 1.6) * h);
        if (sp > 0.68) c.lerp(rust, Math.min(1, (sp - 0.68) * 5) * 0.7);
        c.multiplyScalar(0.88 + grain * 0.25);
        a = Math.min(1, density * 14) * 255;
      } else {
        const l = valueNoise(wx / 0.11, wy / 0.11, seed + 31);
        if (l > 0.86 && valueNoise(wx / 0.9, wy / 0.9, seed + 33) > 0.45) {
          c.copy(lichen).multiplyScalar(0.9 + grain * 0.3);
          a = Math.min(1, (l - 0.86) * 18) * 200;
          height[i] = 0.1;
        }
      }
      const o = i * 4;
      img.data[o] = c.r * 255; img.data[o + 1] = c.g * 255; img.data[o + 2] = c.b * 255; img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);

  const { canvas: nc, ctx: nctx } = makeCanvas(S, S);
  const nimg = nctx.createImageData(S, S);
  const H = (x: number, y: number) => height[Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 3;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 3;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      nimg.data[o] = (-dx / len * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = (dy / len * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      nimg.data[o + 3] = 255;
    }
  nctx.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.colorSpace = THREE.NoColorSpace;
  return { map: canvasTexture(canvas), normalMap };
}

export function shingleTexture(color: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  const base = new THREE.Color(color);
  const shade = (k: number) => `#${base.clone().multiplyScalar(k).getHexString()}`;
  ctx.fillStyle = shade(1);
  ctx.fillRect(0, 0, 128, 128);
  const rows = 8;
  const rh = 128 / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 10;
    for (let x = -off; x < 128; x += 20) {
      const k = 0.9 + Math.random() * 0.2;
      const g = ctx.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
      g.addColorStop(0, shade(1.12 * k));
      g.addColorStop(1, shade(0.78 * k));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 1, r * rh, 18, rh - 1, [0, 0, 6, 6]);
      ctx.fill();
    }
  }
  const t = canvasTexture(canvas, true);
  return t;
}

export function roofGeometry(w: number, d: number, y0: number, hr: number, o: number): THREE.BufferGeometry {
  const x0 = -w / 2 - o, x1 = w / 2 + o;
  const zf = d / 2 + o, zb = -d / 2 - o;
  const ye = y0 - (o * hr) / (d / 2);
  const yr = y0 + hr;
  const L = Math.hypot(d / 2 + o, yr - ye);
  const span = x1 - x0;
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[], ua: number[], ub: number[], uc: number[], ue: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
    uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ue);
  };
  const u = span / 1.4, v = L / 1.4;
  quad([x0, ye, zf], [x1, ye, zf], [x1, yr, 0], [x0, yr, 0], [0, 0], [u, 0], [u, v], [0, v]);
  quad([x1, ye, zb], [x0, ye, zb], [x0, yr, 0], [x1, yr, 0], [0, 0], [u, 0], [u, v], [0, v]);
  const slopeVerts = pos.length / 3;
  pos.push(w / 2, y0, d / 2, w / 2, y0, -d / 2, w / 2, yr, 0);
  pos.push(-w / 2, y0, -d / 2, -w / 2, y0, d / 2, -w / 2, yr, 0);
  uv.push(0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, slopeVerts, 0);
  g.addGroup(slopeVerts, 6, 1);
  g.computeVertexNormals();
  return g;
}

export interface BuildingResult {
  group: THREE.Group;
  chimneyTop?: THREE.Vector3;
}

export function createBuilding(b: Building): BuildingResult {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const seed = b.x0 * 31 + b.z0 * 7;
  const plaster = standard({ map: weatheredPlaster(seed), flatShading: false, roughness: 0.95 });
  const timber = standard({ color: TIMBER });
  const stone = standard({ color: '#a9a397' });
  const accent = standard({ color: b.accent });
  const glass = new THREE.MeshStandardMaterial({ color: '#ffe3a0', emissive: '#ffbf5a', emissiveIntensity: 1.6, roughness: 0.3 });
  glass.name = 'window-glass';
  const { w, d } = b;
  const wallTop = PLINTH + WALL_H;

  add(new THREE.BoxGeometry(w + 0.25, PLINTH, d + 0.25), stone, 0, PLINTH / 2, 0);
  add(new THREE.BoxGeometry(w, WALL_H, d), plaster, 0, PLINTH + WALL_H / 2, 0);

  const post = new THREE.BoxGeometry(0.2, WALL_H, 0.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(post, timber, (sx * w) / 2, PLINTH + WALL_H / 2, (sz * d) / 2);
  const beamX = new THREE.BoxGeometry(w + 0.1, 0.16, 0.12);
  const beamZ = new THREE.BoxGeometry(0.12, 0.16, d + 0.1);
  for (const y of [PLINTH + 0.08, PLINTH + WALL_H * 0.55, wallTop - 0.08]) {
    add(beamX, timber, 0, y, d / 2 + 0.02);
    add(beamX, timber, 0, y, -d / 2 - 0.02);
    add(beamZ, timber, w / 2 + 0.02, y, 0);
    add(beamZ, timber, -w / 2 - 0.02, y, 0);
  }

  const doorH = 1.45;
  add(new THREE.BoxGeometry(1.05, doorH + 0.15, 0.1), timber, 0, PLINTH + (doorH + 0.15) / 2, d / 2 + 0.04);
  add(new THREE.BoxGeometry(0.82, doorH, 0.1), standard({ color: '#8a5a32' }), 0, PLINTH + doorH / 2, d / 2 + 0.08);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#f0c850', metalness: 0.8, roughness: 0.3 }));
  knob.position.set(0.25, PLINTH + doorH * 0.48, d / 2 + 0.15);
  g.add(knob);
  add(new THREE.BoxGeometry(1.3, 0.14, 0.45), stone, 0, 0.07, d / 2 + 0.3);
  const awning = add(new THREE.BoxGeometry(1.4, 0.08, 0.6), accent, 0, PLINTH + doorH + 0.32, d / 2 + 0.3);
  awning.rotation.x = 0.35;

  const win = (x: number, z: number, rotY: number) => {
    const wg = new THREE.Group();
    const y = PLINTH + WALL_H * 0.55 + 0.5;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.06), glass);
    pane.position.y = y;
    wg.add(pane);
    const frameGeoV = new THREE.BoxGeometry(0.07, 0.72, 0.1);
    const frameGeoH = new THREE.BoxGeometry(0.72, 0.07, 0.1);
    for (const fx of [-0.35, 0, 0.35]) { const f = new THREE.Mesh(frameGeoV, timber); f.position.set(fx, y, 0.02); wg.add(f); }
    for (const fy of [-0.35, 0, 0.35]) { const f = new THREE.Mesh(frameGeoH, timber); f.position.set(0, y + fy, 0.02); wg.add(f); }
    for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.05), accent);
      s.position.set(sx * 0.55, y, 0.03);
      s.castShadow = true;
      wg.add(s);
    }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.2), timber);
    box.position.set(0, y - 0.45, 0.1);
    wg.add(box);
    const cols = ['#ff7aa8', '#ffe066', '#ffffff', '#ff9a4a'];
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), standard({ color: i % 2 ? '#4f9a3a' : cols[i % 4] }));
      f.position.set(-0.3 + i * 0.12, y - 0.34, 0.12);
      wg.add(f);
    }
    wg.position.set(x, 0, z);
    wg.rotation.y = rotY;
    g.add(wg);
  };
  const slots = Math.max(1, Math.floor((w - 1.4) / 1.8));
  for (let i = 0; i < slots * 2 + 1; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / (slots * 2 + 1);
    if (Math.abs(x) < 0.9) continue;
    win(x, d / 2 + 0.03, 0);
  }
  win(w / 2 + 0.03, 0, Math.PI / 2);
  win(-w / 2 - 0.03, 0, -Math.PI / 2);

  const roofMat = standard({ map: shingleTexture(b.roof), flatShading: true });
  const roof = new THREE.Mesh(roofGeometry(w, d, wallTop, ROOF_H, 0.45), [roofMat, plaster]);
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);

  const slopes = roof.geometry.attributes.position.array.slice(0, 12 * 3) as Float32Array;
  const mossGeo = new THREE.BufferGeometry();
  mossGeo.setAttribute('position', new THREE.Float32BufferAttribute(slopes, 3));
  const src = roof.geometry.attributes.uv.array as Float32Array;
  let maxU = 0, maxV = 0;
  for (let i = 0; i < 12; i++) { maxU = Math.max(maxU, src[i * 2]); maxV = Math.max(maxV, src[i * 2 + 1]); }
  const mossUv = new Float32Array(24);
  for (let i = 0; i < 12; i++) {
    mossUv[i * 2] = (src[i * 2] / maxU) * 0.5 + (i >= 6 ? 0.5 : 0);
    mossUv[i * 2 + 1] = src[i * 2 + 1] / maxV;
  }
  mossGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mossUv, 2));
  mossGeo.computeVertexNormals();
  const mossTex = mossTextures(seed + 5, maxU * 1.4, maxV * 1.4);
  const moss = new THREE.Mesh(mossGeo, new THREE.MeshStandardMaterial({
    map: mossTex.map, normalMap: mossTex.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    transparent: true, alphaTest: 0.02, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
  }));
  moss.receiveShadow = true;
  g.add(moss);

  g.add(createIvy(b, seed + 9));
  const ridge = add(new THREE.CylinderGeometry(0.1, 0.1, w + 1.0, 6), standard({ color: new THREE.Color(b.roof).multiplyScalar(0.7) }), 0, wallTop + ROOF_H + 0.02, 0);
  ridge.rotation.z = Math.PI / 2;

  let chimneyTop: THREE.Vector3 | undefined;
  if (b.chimney) {
    const cx = w / 2 - 1, cz = -d / 4;
    add(new THREE.BoxGeometry(0.55, 1.5, 0.55), stone, cx, wallTop + ROOF_H - 0.2, cz);
    add(new THREE.BoxGeometry(0.68, 0.14, 0.68), stone, cx, wallTop + ROOF_H + 0.58, cz);
    chimneyTop = new THREE.Vector3(b.x0 + w / 2 + cx, wallTop + ROOF_H + 0.7, b.z0 + d / 2 + cz);
  }

  if (b.id === 'guild') {
    const pole = add(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), timber, w / 2 - 0.6, wallTop + ROOF_H + 0.3, 0);
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6, 8, 1), new THREE.MeshStandardMaterial({ color: b.accent, side: THREE.DoubleSide }));
    flag.position.set(w / 2 - 0.08, wallTop + ROOF_H + 1.1, 0);
    flag.userData.flag = true;
    g.add(flag);
  }

  g.position.set(b.x0 + w / 2, 0, b.z0 + d / 2);
  return { group: g, chimneyTop };
}

export function animateFlags(root: THREE.Object3D, t: number) {
  root.traverse((o) => {
    if (!o.userData.flag) return;
    const mesh = o as THREE.Mesh;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    if (!mesh.userData.base) mesh.userData.base = Float32Array.from(pos.array as Float32Array);
    const base = mesh.userData.base as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] + 0.5;
      pos.setZ(i, Math.sin(t * 5 - x * 4) * 0.1 * x);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });
}
