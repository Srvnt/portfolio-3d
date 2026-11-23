import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BUILDINGS, FOUNTAIN, GATE, SectionId, SIGNPOST, Tile, WorldMap } from './map';
import { Physics } from '../physics';
import { canvasTexture, makeCanvas, standard, uniforms } from './shared';
import { leafTexture } from './nature';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
  return o;
};

function woodTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#b57a42';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#a86f3a' : '#bf8650';
    ctx.fillRect(14, 14 + i * 25, 100, 24);
    ctx.fillStyle = 'rgba(80,45,20,0.25)';
    for (let k = 0; k < 6; k++) ctx.fillRect(14 + Math.random() * 100, 18 + i * 25 + Math.random() * 16, 18, 1.5);
  }
  ctx.strokeStyle = '#6b4428';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, 114, 114);
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(118, 118); ctx.stroke();
  return canvasTexture(canvas);
}

export function createPushables(map: WorldMap, physics: Physics): THREE.Group {
  const group = new THREE.Group();
  const crateMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
  const barrelMat = standard({ color: '#9a6236', flatShading: false });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#59606b', metalness: 0.6, roughness: 0.45 });
  for (const spot of map.crateSpots) {
    if (spot.kind === 'crate') {
      const s = 0.55;
      const crate = shadowed(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat));
      crate.position.set(spot.x, s / 2 + 0.01, spot.z);
      crate.rotation.y = (spot.x * 7) % 1;
      group.add(crate);
      physics.dynamic(crate, new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)), 1.2);
    } else {
      const barrel = new THREE.Group();
      barrel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.7, 14), barrelMat));
      const bulge = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.36, 14), barrelMat);
      barrel.add(bulge);
      for (const y of [-0.24, 0.24]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.022, 4, 18), bandMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = y;
        barrel.add(band);
      }
      shadowed(barrel);
      barrel.position.set(spot.x, 0.36, spot.z);
      group.add(barrel);
      physics.dynamic(barrel, new CANNON.Cylinder(0.29, 0.29, 0.7, 10), 1.6);
    }
  }
  return group;
}

export function createGate(physics: Physics) {
  const g = new THREE.Group();
  const { x: cx, z: cz, span } = GATE;
  const half = span / 2;
  const POST_H = 2.15;
  const RISE = half * 0.8;
  const DEPTH = 0.36;
  const wood = standard({ color: '#8a5a34', flatShading: false, roughness: 0.8 });
  const woodDark = standard({ color: '#5e3a20', flatShading: false });
  const stone = standard({ color: '#b5ad9c' });
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', metalness: 0.5, roughness: 0.45 });
  const glow = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffb84a', emissiveIntensity: 0.2, roughness: 0.3 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  const arch = (z: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(-half, (POST_H * i) / 6, z));
    for (let i = 1; i < 24; i++) {
      const a = Math.PI - (Math.PI * i) / 24;
      pts.push(new THREE.Vector3(Math.cos(a) * half, POST_H + Math.sin(a) * RISE, z));
    }
    for (let i = 6; i >= 0; i--) pts.push(new THREE.Vector3(half, (POST_H * i) / 6, z));
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  };
  const arcs = [arch(DEPTH), arch(-DEPTH)];
  for (const c of arcs) add(new THREE.TubeGeometry(c, 120, 0.075, 8), wood, 0, 0, 0);
  for (let i = 0; i <= 26; i++) {
    const p = arcs[0].getPointAt(i / 26);
    if (p.y < 0.35) continue;
    add(new THREE.BoxGeometry(0.07, 0.07, DEPTH * 2 + 0.16), woodDark, p.x, p.y, 0);
  }
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.42, 0.24, DEPTH * 2 + 0.42), stone, side * half, 0.12, 0);
    for (const k of [0.75, 1.45])
      for (const dir of [-1, 1]) {
        const bar = add(new THREE.BoxGeometry(0.035, 0.95, 0.035), woodDark, side * half, k, 0);
        bar.rotation.x = dir * 0.62;
      }
    physics.cylinder(cx + side * half, cz, 0.3, 1.6);
  }

  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true });
  const leaves: THREE.BufferGeometry[] = [];
  const dark = new THREE.Color('#2c6a2c'), light = new THREE.Color('#8cc85a'), c = new THREE.Color();
  const leafAt = (pos: THREE.Vector3, out: THREE.Vector3, size: number) => {
    const leaf = new THREE.PlaneGeometry(size, size);
    leaf.applyMatrix4(new THREE.Matrix4().lookAt(out, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.random() * 6.28)).setPosition(pos));
    c.copy(dark).lerp(light, 0.25 + Math.random() * 0.65);
    const n = new Float32Array(12), col = new Float32Array(12);
    for (let v = 0; v < 4; v++) { n.set([out.x, out.y, out.z], v * 3); col.set([c.r, c.g, c.b], v * 3); }
    leaf.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    leaf.setAttribute('color', new THREE.BufferAttribute(col, 3));
    leaves.push(leaf);
  };
  const flowerSpots: { pos: THREE.Vector3; out: THREE.Vector3 }[] = [];
  arcs.forEach((curve, ci) => {
    const facing = ci === 0 ? 1 : -1;
    for (let i = 0; i < 90; i++) {
      const t = 0.06 + (i / 90) * 0.88 + (Math.random() - 0.5) * 0.01;
      const p = curve.getPointAt(t);
      const a = i * 2.3 + Math.random();
      const out = new THREE.Vector3(Math.cos(a) * 0.6, 0.5 + Math.random() * 0.4, facing * (0.4 + Math.random() * 0.6)).normalize();
      const pos = p.clone().add(new THREE.Vector3(Math.cos(a) * 0.1, Math.sin(a) * 0.1, facing * 0.05));
      leafAt(pos, out, 0.22 + Math.random() * 0.14);
      if (Math.random() < 0.32 && p.y > 0.9) flowerSpots.push({ pos: pos.clone().addScaledVector(out, 0.05), out });
    }
  });
  for (let i = 0; i < 34; i++) {
    const t = 0.32 + Math.random() * 0.36;
    const p = arcs[Math.random() < 0.5 ? 0 : 1].getPointAt(t);
    const drop = 0.1 + Math.pow(Math.random(), 1.6) * 0.55;
    leafAt(new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.2, p.y - drop, p.z * (0.6 + Math.random() * 0.5)), new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2, Math.sign(p.z)).normalize(), 0.18 + Math.random() * 0.1);
  }
  const vine = new THREE.Mesh(mergeGeometries(leaves)!, leafMat);
  vine.userData.noSnow = true;
  g.add(vine);

  const atlas = flowerAtlas();
  const flowerMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, emissive: '#ffffff', emissiveMap: atlas, emissiveIntensity: 0.15 });
  const blooms: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  flowerSpots.forEach((f, i) => {
    const cell = i % 4;
    const s = 0.15 + Math.random() * 0.08;
    const bloom = new THREE.PlaneGeometry(s, s);
    const uv = bloom.attributes.uv as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) uv.setX(v, (cell + uv.getX(v)) / 4);
    bloom.applyMatrix4(new THREE.Matrix4().lookAt(f.out, new THREE.Vector3(), up).multiply(new THREE.Matrix4().makeRotationZ(Math.random() * 6.28)).setPosition(f.pos));
    blooms.push(bloom);
  });
  if (blooms.length) {
    const flowers = new THREE.Mesh(mergeGeometries(blooms)!, flowerMat);
    flowers.userData.noSnow = true;
    g.add(flowers);
  }

  const lantern = new THREE.Group();
  lantern.position.set(0, POST_H + RISE - 0.05, 0);
  add(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 4), iron, 0, -0.17, 0, lantern);
  add(new THREE.ConeGeometry(0.14, 0.1, 6), iron, 0, -0.38, 0, lantern);
  add(new THREE.CylinderGeometry(0.095, 0.08, 0.22, 6), glow, 0, -0.54, 0, lantern);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 6), iron, 0, -0.66, 0, lantern);
  g.add(lantern);

  const flowerCols = ['#ff7aa8', '#ffe066', '#ffffff', '#b99cff'];
  for (const side of [-1, 1]) {
    const fx = side * (half + 0.55);
    add(new THREE.BoxGeometry(0.5, 0.22, 0.8), woodDark, fx, 0.11, 0);
    for (let k = 0; k < 9; k++) {
      const f = add(new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.03, 1), standard({ color: flowerCols[k % 4], flatShading: false }), fx + (Math.random() - 0.5) * 0.36, 0.28 + Math.random() * 0.08, (Math.random() - 0.5) * 0.66);
      f.scale.y = 0.8;
    }
  }

  g.traverse((o) => { o.castShadow = o !== lantern.children[2]; o.receiveShadow = true; });
  g.position.set(cx, 0, cz);
  return {
    group: g,
    setNight(n: number, t: number) {
      glow.emissiveIntensity = 0.2 + n * 3.4 * (1 + Math.sin(t * 9) * 0.03);
    },
    animate(t: number, wind: number) {
      lantern.rotation.z = Math.sin(t * (1.3 + wind * 2.5)) * (0.04 + wind * 0.18);
      lantern.rotation.x = Math.cos(t * (1.1 + wind * 2)) * (0.02 + wind * 0.1);
    },
  };
}

function flowerAtlas(): THREE.CanvasTexture {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S * 4, S);
  const sets = [['#f6a2b6', '#ef7f88', '#f7d63c'], ['#fff4dc', '#f6c890', '#f0a028'], ['#c9a6ee', '#9a6ad0', '#fff0a0'], ['#ffe066', '#f2b820', '#c86a10']];
  sets.forEach(([petal, edge, heart], i) => {
    const cx = i * S + S / 2, cy = S / 2;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * S * 0.2, cy + Math.sin(a) * S * 0.2);
      ctx.rotate(a + Math.PI / 2);
      const grad = ctx.createLinearGradient(0, -S * 0.24, 0, S * 0.24);
      grad.addColorStop(0, petal);
      grad.addColorStop(1, edge);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, S * 0.15, S * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = heart;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.11, 0, Math.PI * 2);
    ctx.fill();
  });
  return canvasTexture(canvas);
}

export interface SignArm {
  section: SectionId;
  title: string;
  icon: string;
  place: string;
  base: THREE.Vector3;
  tip: THREE.Vector3;
}

export function createSignpost(physics: Physics): { group: THREE.Group; arms: SignArm[] } {
  const g = new THREE.Group();
  const wood = standard({ color: '#7a5232', flatShading: false, roughness: 0.8 });
  const plank = standard({ color: '#c89a62', flatShading: false, roughness: 0.7 });
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', metalness: 0.5, roughness: 0.45 });
  const stone = standard({ color: '#b5ad9c' });
  const HEIGHT = 2.55;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, HEIGHT, 8), wood);
  post.position.y = HEIGHT / 2;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.18, 8), iron);
  cap.position.y = HEIGHT + 0.09;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.2, 8), stone);
  base.position.y = 0.1;
  g.add(post, cap, base);

  const L = 1.25, H = 0.32, TIP = 0.22;
  const arrow = new THREE.Shape();
  arrow.moveTo(0.06, -H / 2);
  arrow.lineTo(L - TIP, -H / 2);
  arrow.lineTo(L, 0);
  arrow.lineTo(L - TIP, H / 2);
  arrow.lineTo(0.06, H / 2);
  arrow.closePath();
  const boardGeo = new THREE.ExtrudeGeometry(arrow, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  boardGeo.translate(0, 0, -0.025);

  const targets = BUILDINGS.map((b) => ({ b, x: b.x0 + b.w / 2, z: b.z0 + b.d / 2 }))
    .sort((a, b) => Math.atan2(a.z - SIGNPOST.z, a.x - SIGNPOST.x) - Math.atan2(b.z - SIGNPOST.z, b.x - SIGNPOST.x));
  const arms: SignArm[] = [];
  targets.forEach((t, i) => {
    const arm = new THREE.Group();
    arm.position.y = HEIGHT - 0.24 - i * 0.36;
    const yaw = Math.atan2(-(t.z - SIGNPOST.z), t.x - SIGNPOST.x);
    arm.rotation.y = yaw;
    arm.add(new THREE.Mesh(boardGeo, plank));
    const label = signLabel(HOUSE_TITLES[t.b.section] ?? t.b.section, HOUSE_ICONS[t.b.section] ?? '');
    const textMat = new THREE.MeshBasicMaterial({ map: label, transparent: true, alphaTest: 0.05, toneMapped: false });
    for (const side of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(L - TIP - 0.1, H * 0.86), textMat);
      face.position.set(0.06 + (L - TIP - 0.06) / 2 + (side < 0 ? 0.04 : 0), 0, side * 0.04);
      if (side < 0) face.rotation.y = Math.PI;
      face.userData.noSnow = true;
      arm.add(face);
    }
    const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), iron);
    nail.rotation.x = Math.PI / 2;
    nail.position.set(0.12, 0, 0);
    arm.add(nail);
    g.add(arm);
    const base = new THREE.Vector3(SIGNPOST.x, arm.position.y, SIGNPOST.z);
    const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    arms.push({
      section: t.b.section,
      title: HOUSE_TITLES[t.b.section] ?? t.b.section,
      icon: HOUSE_ICONS[t.b.section] ?? '',
      place: t.b.label.split(' · ')[0],
      base,
      tip: base.clone().addScaledVector(dir, L * 0.9),
    });
  });

  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material instanceof THREE.MeshBasicMaterial)) { m.castShadow = true; m.receiveShadow = true; } });
  g.position.set(SIGNPOST.x, 0, SIGNPOST.z);
  physics.cylinder(SIGNPOST.x, SIGNPOST.z, 0.25, 1.5);
  return { group: g, arms };
}

function signLabel(text: string, icon: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 110);
  ctx.font = '800 66px Cinzel, Georgia, serif';
  ctx.textBaseline = 'middle';
  const label = icon ? `${icon} ${text}` : text;
  const w = ctx.measureText(label).width;
  const scale = Math.min(1, 480 / w);
  ctx.translate(256, 58);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 236, 200, 0.35)';
  ctx.fillText(label, 0, 2);
  ctx.fillStyle = '#3a2208';
  ctx.fillText(label, 0, 0);
  return canvasTexture(canvas);
}

export function createSign(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const wood = standard({ color: '#9a6a3a' });
  const dark = standard({ color: '#6b4428' });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 6), dark);
  post.position.y = 0.7;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.08), wood);
  board.position.set(0, 1.2, 0.05);
  board.rotation.z = 0.04;
  g.add(post, board);
  for (const [y, w] of [[1.3, 0.7], [1.18, 0.55], [1.07, 0.65]]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.02), dark);
    line.position.set(0, y, 0.1);
    g.add(line);
  }
  g.position.set(x, 0, z);
  return shadowed(g);
}

export class Chest {
  group = new THREE.Group();
  opened = false;
  private lid = new THREE.Group();
  private lidAngle = 0;
  private light: THREE.PointLight;
  private glow: THREE.Mesh;

  constructor(x: number, z: number) {
    const wood = standard({ color: '#9a5a2a' });
    const gold = new THREE.MeshStandardMaterial({ color: '#f0c040', metalness: 0.8, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.5), wood);
    body.position.y = 0.21;
    this.group.add(body);
    for (const bx of [-0.26, 0.26]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.52), gold);
      band.position.set(bx, 0.21, 0);
      this.group.add(band);
    }
    const lidGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.75, 14, 1, false, 0, Math.PI);
    lidGeo.rotateZ(Math.PI / 2);
    const lidMesh = new THREE.Mesh(lidGeo, wood);
    lidMesh.position.set(0, 0, 0.25);
    this.lid.add(lidMesh);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), gold);
    lock.position.set(0, -0.02, 0.51);
    this.lid.add(lock);
    this.lid.position.set(0, 0.42, -0.25);
    this.group.add(this.lid);
    shadowed(this.group);

    this.glow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), new THREE.MeshBasicMaterial({ color: '#fff0a0' }));
    this.glow.position.y = 0.41;
    this.glow.visible = false;
    this.group.add(this.glow);
    this.light = new THREE.PointLight('#ffd36b', 0, 4, 1.5);
    this.light.position.y = 0.9;
    this.group.add(this.light);
    this.group.position.set(x, 0, z);
  }

  open() {
    this.opened = true;
    this.glow.visible = true;
  }

  update(dt: number, t: number) {
    const target = this.opened ? -1.9 : Math.sin(t * 3) * 0.02 - 0.02;
    this.lidAngle += (target - this.lidAngle) * (1 - Math.exp(-dt * 6));
    this.lid.rotation.x = this.lidAngle;
    this.light.intensity = this.opened ? 3 + Math.sin(t * 6) * 0.6 : 0;
    (this.glow.material as THREE.MeshBasicMaterial).color.setScalar(this.opened ? 2.5 : 1);
  }
}

export function createFountain() {
  const g = new THREE.Group();
  const stone = standard({ color: '#c9c1b0', flatShading: false });
  const profile = [
    [0, 0], [1.3, 0], [1.35, 0.1], [1.35, 0.55], [1.22, 0.6], [1.15, 0.5], [1.1, 0.18], [0, 0.18],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const basin = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), stone);
  g.add(basin);
  const column = new THREE.Mesh(new THREE.LatheGeometry([
    [0, 0.1], [0.22, 0.1], [0.16, 0.6], [0.14, 1.1], [0.55, 1.25], [0.6, 1.35], [0.5, 1.38], [0.12, 1.3], [0.1, 1.6], [0.14, 1.7], [0, 1.72],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 20), stone);
  g.add(column);
  shadowed(g);

  const waterMat = new THREE.MeshStandardMaterial({ color: '#4cc0d8', roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85, emissive: '#0a3a48' });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.14, 32), waterMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.46;
  g.add(pool);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.52, 20), waterMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 1.33;
  g.add(top);

  const N = 160;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) seeds.set([Math.random(), Math.random() * Math.PI * 2, 0.6 + Math.random() * 0.6], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const spray = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: uniforms.uTime, uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: `
      attribute vec3 aSeed; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        float t = fract(uTime * 0.7 * aSeed.z + aSeed.x);
        float r = 0.08 + t * 0.62;
        vec3 p = vec3(cos(aSeed.y) * r, 1.72 + t * 1.1 - t * t * 2.3, sin(aSeed.y) * r);
        vA = 1.0 - t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.05 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(1.4, 1.6, 1.7), vA * 0.85);
      }`,
  }));
  spray.frustumCulled = false;
  g.add(spray);
  g.position.set(FOUNTAIN.x, 0, FOUNTAIN.z);
  return g;
}

export function createBridges(map: WorldMap): THREE.Group {
  const g = new THREE.Group();
  const plank = standard({ color: '#a8743f' });
  const dark = standard({ color: '#6b4428' });
  for (let z = 0; z < map.H; z++) {
    let x0 = -1;
    for (let x = 0; x <= map.W; x++) {
      const b = x < map.W && map.tile(x, z) === Tile.Bridge;
      if (b && x0 < 0) x0 = x;
      if (!b && x0 >= 0) {
        if (map.tile(x0, z - 1) !== Tile.Bridge) {
          let z1 = z;
          while (map.tile(x0, z1 + 1) === Tile.Bridge) z1++;
          const len = x - x0 + 0.8;
          const depth = z1 - z + 1;
          for (let px = 0; px < len; px += 0.28) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, depth + 0.1), plank);
            p.position.set(x0 - 0.4 + px + 0.14, 0.06 + Math.sin((px / len) * Math.PI) * 0.12, z + depth / 2);
            p.rotation.z = Math.cos((px / len) * Math.PI) * -0.12;
            g.add(p);
          }
          for (const rz of [z + 0.05, z1 + 0.95]) {
            for (let px = 0; px <= len; px += len / 4) {
              const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), dark);
              post.position.set(x0 - 0.4 + px, 0.35 + Math.sin((px / len) * Math.PI) * 0.12, rz);
              g.add(post);
            }
            const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.08, 0.1), dark);
            rail.position.set(x0 - 0.4 + len / 2, 0.66, rz);
            g.add(rail);
          }
        }
        x0 = -1;
      }
    }
  }
  return shadowed(g);
}

export function createLanterns(physics: Physics, withLights: number) {
  const spots: [number, number][] = [[17.5, 21.6], [26.5, 21.6], [17.5, 13.5], [26.5, 13.5], [12.5, 16.3], [30.5, 16.3], [20.3, 25.5], [23.7, 25.5]];
  const group = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', roughness: 0.5, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffb84a', emissiveIntensity: 0.2, roughness: 0.3 });
  const lights: THREE.PointLight[] = [];
  spots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.1, 8), iron);
    post.position.y = 1.05;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.15, 8), iron);
    base.position.y = 0.07;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.04), iron);
    arm.position.set(0.17, 2.0, 0);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.26, 6, 1, true), iron);
    cage.position.set(0.36, 1.83, 0);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.22, 6), glow);
    lamp.position.copy(cage.position);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 6), iron);
    cap.position.set(0.36, 2.02, 0);
    g.add(post, base, arm, cage, lamp, cap);
    g.traverse((o) => (o.castShadow = o !== lamp));
    if (i < withLights) {
      const l = new THREE.PointLight('#ffb35a', 0, 7, 1.6);
      l.position.set(0.36, 1.75, 0);
      g.add(l);
      lights.push(l);
    }
    g.position.set(x, 0, z);
    g.rotation.y = (i % 2 ? Math.PI : 0) + (z > 20 ? Math.PI / 2 : 0);
    group.add(g);
    physics.cylinder(x, z, 0.14, 1.1);
  });
  return {
    group,
    setNight(n: number, t: number) {
      const flicker = 1 + Math.sin(t * 11) * 0.03 + Math.sin(t * 23) * 0.02;
      glow.emissiveIntensity = 0.2 + n * 3.4 * flicker;
      for (const l of lights) l.intensity = n * 9 * flicker;
    },
  };
}

export const HOUSE_ICONS: Record<string, string> = { about: '🏠', projects: '🗺️', skills: '⚒️', experience: '📚', contact: '✉️' };
const HOUSE_TITLES: Record<string, string> = { about: 'About', projects: 'Projects', skills: 'Skills', experience: 'Experience', contact: 'Contact' };

function houseSignTexture(icon: string, title: string, place: string) {
  const W = 640, H = 256, SCALE = 2;
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext('2d')!;
  g.scale(SCALE, SCALE);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#3e5fc4');
  grad.addColorStop(1, '#22378a');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(6, 6, W - 12, H - 12, 34);
  g.fill();
  g.lineWidth = 14;
  g.strokeStyle = '#ffd36a';
  g.stroke();
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255,244,210,0.75)';
  g.beginPath();
  g.roundRect(24, 24, W - 48, H - 48, 22);
  g.stroke();
  g.font = '110px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(icon, 128, H / 2 + 6);
  g.textAlign = 'left';
  g.fillStyle = '#ffe28e';
  g.shadowColor = 'rgba(255,200,90,0.55)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 0;
  let size = 84;
  g.font = `800 ${size}px Cinzel, Georgia, serif`;
  while (g.measureText(title).width > W - 280 && size > 40) g.font = `800 ${(size -= 4)}px Cinzel, Georgia, serif`;
  g.fillText(title, 228, H / 2 - 22);
  g.shadowColor = 'rgba(10,16,50,0.6)';
  g.shadowBlur = 6;
  g.fillStyle = '#ffffff';
  g.font = '800 38px Nunito, system-ui, sans-serif';
  g.fillText(place, 232, H / 2 + 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createHouseSigns(physics: Physics) {
  const group = new THREE.Group();
  const faces: THREE.MeshStandardMaterial[] = [];
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffb84a', emissiveIntensity: 0.15, roughness: 0.3 });
  const wood = standard({ color: '#6b4428', flatShading: false });
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', metalness: 0.5, roughness: 0.45 });
  for (const b of BUILDINGS) {
    const [place] = b.label.split(' · ');
    const sx = b.x0 + Math.floor(b.w / 2) + 0.5 + 1.45;
    const sz = b.z0 + b.d + 0.75;
    const sign = new THREE.Group();
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.35, 8), wood);
      post.position.set(side * 0.72, 0.67, 0);
      sign.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), iron);
      cap.position.set(side * 0.72, 1.36, 0);
      sign.add(cap);
    }
    const panel = new THREE.Group();
    panel.position.set(0, 1.02, 0.02);
    panel.rotation.x = -0.55;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.66, 0.06), wood);
    const art = houseSignTexture(HOUSE_ICONS[b.section] ?? '★', HOUSE_TITLES[b.section] ?? place, place);
    const faceMat = new THREE.MeshStandardMaterial({ map: art, emissiveMap: art, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.55 });
    faces.push(faceMat);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.62), faceMat);
    face.position.z = 0.032;
    face.userData.noSnow = true;
    panel.add(back, face);
    sign.add(panel);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.03), iron);
    hook.position.set(-0.72 - 0.1, 1.3, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.08, 6), iron);
    cap.position.set(-0.92, 1.22, 0);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.14, 6), lampMat);
    lamp.position.set(-0.92, 1.11, 0);
    sign.add(hook, cap, lamp);
    sign.traverse((o) => { o.castShadow = o !== lamp; o.receiveShadow = o !== face && o !== lamp; });
    sign.position.set(sx, 0, sz);
    group.add(sign);
    for (const side of [-1, 1]) physics.cylinder(sx + side * 0.72, sz, 0.1, 0.8);
  }
  return {
    group,
    setNight(n: number, t: number) {
      for (const f of faces) f.emissiveIntensity = 0.3 + n * 0.45;
      lampMat.emissiveIntensity = 0.15 + n * 3.2 * (1 + Math.sin(t * 10) * 0.03);
    },
  };
}
