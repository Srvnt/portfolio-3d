import * as THREE from 'three';
import { Building, ROOF_H, WALL_H } from './map';
import { canvasTexture, makeCanvas, standard } from './shared';

const PLINTH = 0.3;
const PLASTER = '#f3ead2';
const TIMBER = '#6b4428';

/** Soft shingle texture tinted per roof colour. */
function shingleTexture(color: string): THREE.CanvasTexture {
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

/** Pitched roof with overhang (ridge along x) and gables. */
function roofGeometry(w: number, d: number, y0: number, hr: number, o: number): THREE.BufferGeometry {
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
  // roof thickness: a thin fascia under the eaves
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
  const plaster = standard({ color: PLASTER, flatShading: false, roughness: 0.95 });
  const timber = standard({ color: TIMBER });
  const stone = standard({ color: '#a9a397' });
  const accent = standard({ color: b.accent });
  const glass = new THREE.MeshStandardMaterial({ color: '#ffe3a0', emissive: '#ffbf5a', emissiveIntensity: 1.6, roughness: 0.3 });
  const { w, d } = b;
  const wallTop = PLINTH + WALL_H;

  add(new THREE.BoxGeometry(w + 0.25, PLINTH, d + 0.25), stone, 0, PLINTH / 2, 0);
  add(new THREE.BoxGeometry(w, WALL_H, d), plaster, 0, PLINTH + WALL_H / 2, 0);

  // timber framing
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

  // door with frame, knob and step
  const doorH = 1.45;
  add(new THREE.BoxGeometry(1.05, doorH + 0.15, 0.1), timber, 0, PLINTH + (doorH + 0.15) / 2, d / 2 + 0.04);
  add(new THREE.BoxGeometry(0.82, doorH, 0.1), standard({ color: '#8a5a32' }), 0, PLINTH + doorH / 2, d / 2 + 0.08);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: '#f0c850', metalness: 0.8, roughness: 0.3 }));
  knob.position.set(0.25, PLINTH + doorH * 0.48, d / 2 + 0.15);
  g.add(knob);
  add(new THREE.BoxGeometry(1.3, 0.14, 0.45), stone, 0, 0.07, d / 2 + 0.3);
  // awning over the door in the accent colour
  const awning = add(new THREE.BoxGeometry(1.4, 0.08, 0.6), accent, 0, PLINTH + doorH + 0.32, d / 2 + 0.3);
  awning.rotation.x = 0.35;

  // windows: glowing glass, cross bars, shutters, flower boxes
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

  // roof
  const roofMat = standard({ map: shingleTexture(b.roof), flatShading: true });
  const roof = new THREE.Mesh(roofGeometry(w, d, wallTop, ROOF_H, 0.45), [roofMat, plaster]);
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  const ridge = add(new THREE.CylinderGeometry(0.1, 0.1, w + 1.0, 6), standard({ color: new THREE.Color(b.roof).multiplyScalar(0.7) }), 0, wallTop + ROOF_H + 0.02, 0);
  ridge.rotation.z = Math.PI / 2;

  let chimneyTop: THREE.Vector3 | undefined;
  if (b.chimney) {
    const cx = w / 2 - 1, cz = -d / 4;
    add(new THREE.BoxGeometry(0.55, 1.5, 0.55), stone, cx, wallTop + ROOF_H - 0.2, cz);
    add(new THREE.BoxGeometry(0.68, 0.14, 0.68), stone, cx, wallTop + ROOF_H + 0.58, cz);
    chimneyTop = new THREE.Vector3(b.x0 + w / 2 + cx, wallTop + ROOF_H + 0.7, b.z0 + d / 2 + cz);
  }

  // a banner pole on the guild
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

/** Wave any flags in the scene. */
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
