import * as THREE from 'three';
import { WorldMap } from '../world/map';

const SCHEMES = [
  { base: '#f6c890', inner: '#f0a028', edge: '#5a3518', spot: '#fff4dc' },
  { base: '#b58ae0', inner: '#7a50c0', edge: '#2c1848', spot: '#f3e6ff' },
  { base: '#ef7f88', inner: '#d24e62', edge: '#4a1620', spot: '#ffe6ea' },
  { base: '#f0582e', inner: '#c83a1c', edge: '#2a1208', spot: '#ffd9a8' },
  { base: '#f7d63c', inner: '#e6a812', edge: '#4a3a0c', spot: '#fffbe0' },
];

const WING = 0.15;
const LAND_Y = 0.62;

function wingTexture(s: (typeof SCHEMES)[number]): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const fore = new Path2D();
  fore.moveTo(2, 62);
  fore.bezierCurveTo(18, 30, 60, 2, 104, 6);
  fore.bezierCurveTo(126, 10, 124, 38, 108, 52);
  fore.bezierCurveTo(84, 66, 40, 70, 2, 66);
  fore.closePath();
  const hind = new Path2D();
  hind.moveTo(2, 64);
  hind.bezierCurveTo(46, 66, 92, 78, 90, 102);
  hind.bezierCurveTo(88, 122, 62, 126, 44, 116);
  hind.bezierCurveTo(22, 104, 8, 84, 2, 68);
  hind.closePath();
  const fill = (p: Path2D) => {
    const grad = g.createRadialGradient(0, 64, 4, 0, 64, 120);
    grad.addColorStop(0, s.inner);
    grad.addColorStop(0.55, s.base);
    grad.addColorStop(1, s.base);
    g.fillStyle = grad;
    g.fill(p);
    g.lineWidth = 7;
    g.strokeStyle = s.edge;
    g.save();
    g.clip(p);
    g.stroke(p);
    g.restore();
  };
  fill(hind);
  fill(fore);
  g.strokeStyle = s.edge;
  g.globalAlpha = 0.35;
  g.lineWidth = 1.5;
  for (const [x, y] of [[100, 14], [112, 36], [84, 58], [70, 104], [80, 90]]) {
    g.beginPath();
    g.moveTo(4, 64);
    g.quadraticCurveTo(x * 0.5, (y + 64) * 0.5 + (y < 64 ? -6 : 6), x, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = s.spot;
  for (const [x, y, r] of [[104, 18, 4.5], [112, 32, 3.5], [96, 44, 3], [76, 110, 4], [60, 116, 3]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Fly {
  g: THREE.Group;
  wings: THREE.Object3D[];
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  heading: number;
  bank: number;
  phase: number;
  seed: number;
  rest: number;
}

export class Butterflies {
  group = new THREE.Group();
  private flies: Fly[] = [];
  private homes: THREE.Vector3[] = [];
  private last = -1;

  constructor(map: WorldMap, count = 10) {
    for (let z = 0; z < map.H; z++)
      for (let x = 0; x < map.W; x++) if (map.flowers[map.i(x, z)]) this.homes.push(new THREE.Vector3(x + 0.5, 0, z + 0.5));
    if (!this.homes.length) return;

    const wingGeo = new THREE.PlaneGeometry(WING, WING);
    wingGeo.translate(WING / 2, 0, 0);
    const mats = SCHEMES.map((s) => {
      const map = wingTexture(s);
      return new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.22, alphaTest: 0.5, side: THREE.DoubleSide });
    });
    const bodyGeo = new THREE.CapsuleGeometry(0.009, 0.075, 3, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshLambertMaterial({ color: '#2a2018' });
    const antGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.04), new THREE.Vector3(0.022, 0.03, 0.085),
      new THREE.Vector3(0, 0, 0.04), new THREE.Vector3(-0.022, 0.03, 0.085),
    ]);
    const antMat = new THREE.LineBasicMaterial({ color: '#2a2018' });

    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.LineSegments(antGeo, antMat));
      const mat = mats[i % mats.length];
      const wings = [-1, 1].map((side) => {
        const hinge = new THREE.Group();
        const w = new THREE.Mesh(wingGeo, mat);
        w.rotation.x = Math.PI / 2;
        hinge.scale.x = side;
        hinge.add(w);
        g.add(hinge);
        return hinge;
      });
      const s = 0.8 + Math.random() * 0.4;
      g.scale.setScalar(s);
      const home = this.pickHome();
      const pos = home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 2));
      g.position.copy(pos);
      this.group.add(g);
      this.flies.push({ g, wings, pos, vel: new THREE.Vector3(), target: this.newTarget(home), heading: Math.random() * 6.28, bank: 0, phase: Math.random() * 10, seed: Math.random() * 100, rest: 0 });
    }
  }

  private pickHome(near?: THREE.Vector3): THREE.Vector3 {
    if (near && Math.random() < 0.75) {
      const close = this.homes.filter((h) => Math.abs(h.x - near.x) < 6 && Math.abs(h.z - near.z) < 6);
      if (close.length) return close[Math.floor(Math.random() * close.length)];
    }
    return this.homes[Math.floor(Math.random() * this.homes.length)];
  }

  private newTarget(home: THREE.Vector3) {
    return new THREE.Vector3(home.x + (Math.random() - 0.5) * 0.8, LAND_Y + Math.random() * 0.08, home.z + (Math.random() - 0.5) * 0.8);
  }

  update(t: number, heroX = -1e3, heroZ = -1e3) {
    const dt = this.last < 0 ? 0.016 : Math.min(0.05, t - this.last);
    this.last = t;
    const want = new THREE.Vector3();
    for (const f of this.flies) {
      const heroNear = Math.hypot(f.pos.x - heroX, f.pos.z - heroZ) < 1.4;
      if (f.rest > 0) {
        f.rest -= dt;
        if (heroNear) {
          f.rest = 0;
          f.vel.set((f.pos.x - heroX) * 1.5, 1.6, (f.pos.z - heroZ) * 1.5);
          f.target = this.newTarget(this.pickHome());
        }
        if (f.rest <= 0) f.target = this.newTarget(this.pickHome(f.pos));
        const open = 0.9 + 0.55 * Math.sin(t * 2.2 + f.seed) * Math.max(0, Math.sin(t * 0.7 + f.seed));
        f.wings[0].rotation.z = open;
        f.wings[1].rotation.z = open;
        f.g.position.copy(f.pos);
        f.g.rotation.set(0, f.heading, 0);
        continue;
      }

      const to = want.copy(f.target).sub(f.pos);
      const dist = to.length();
      const near = Math.min(1, dist / 0.8);
      const speed = 0.35 + 0.75 * near;
      to.normalize().multiplyScalar(speed);
      to.x += Math.sin(t * 1.9 + f.seed) * 0.55 * near;
      to.z += Math.cos(t * 1.6 + f.seed * 1.3) * 0.55 * near;
      to.y += (0.5 * near) * (0.5 + 0.5 * Math.sin(t * 0.9 + f.seed));
      f.vel.lerp(to, Math.min(1, dt * 2.5));
      f.pos.addScaledVector(f.vel, dt);
      f.pos.y = Math.max(0.35, f.pos.y);

      const glide = Math.sin(t * 0.8 + f.seed * 3) > 0.55 && near > 0.6;
      f.phase += dt * (glide ? 3 : 19 + 5 * Math.sin(f.seed));
      const beat = Math.sin(f.phase);
      const flap = glide ? 0.35 + beat * 0.08 : 0.25 + beat * 1.05;
      f.wings[0].rotation.z = flap;
      f.wings[1].rotation.z = flap;

      const flat = Math.hypot(f.vel.x, f.vel.z);
      if (flat > 0.05) {
        const h = Math.atan2(f.vel.x, f.vel.z);
        let dh = h - f.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        f.heading += dh * Math.min(1, dt * 6);
        f.bank = THREE.MathUtils.lerp(f.bank, THREE.MathUtils.clamp(-dh * 1.2, -0.6, 0.6), Math.min(1, dt * 4));
      }
      f.g.position.copy(f.pos);
      f.g.position.y += glide ? 0 : -beat * 0.025;
      f.g.rotation.set(-f.vel.y * 0.25, f.heading, f.bank, 'YXZ');

      if (dist < 0.08) {
        if (Math.random() < 0.6) {
          f.rest = 2 + Math.random() * 4;
          f.vel.set(0, 0, 0);
          f.bank = 0;
        } else f.target = this.newTarget(this.pickHome(f.pos));
      }
    }
  }
}
