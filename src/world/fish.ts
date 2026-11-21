import * as THREE from 'three';
import { WorldMap } from './map';

export const SPECIES = [
  { body: '#3f5a22', belly: '#e6e0b0', fin: '#b5652a', len: 1.35, agility: 0.9 },
  { body: '#5f6a1e', belly: '#f2e6b8', fin: '#e8622a', len: 0.95, agility: 0.5 },
  { body: '#4f5f6a', belly: '#f4f0ea', fin: '#d9708a', len: 1.1, agility: 0.7 },
  { body: '#5a6878', belly: '#fbf2ee', fin: '#c4848a', len: 1.25, agility: 0.25 },
];

const UNDERWATER = new THREE.Color('#c4e2ea');
const SWIM_Y = -0.17;

export interface Fish {
  group: THREE.Group;
  tail: THREE.Object3D;
  species: number;
  z: number;
  lat: number;
  dir: 1 | -1;
  speed: number;
  agility: number;
  seed: number;
  lure: THREE.Vector3 | null;
  hooked: boolean;
  respawn: number;
  jump: number;
  nextJump: number;
}

function fishMesh(sp: (typeof SPECIES)[number]): { group: THREE.Group; tail: THREE.Object3D } {
  const group = new THREE.Group();
  const body = new THREE.SphereGeometry(0.12, 14, 10);
  body.scale(0.55, 0.62, 1.7 * sp.len);
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(sp.body), belly = new THREE.Color(sp.belly);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(belly).lerp(top, THREE.MathUtils.smoothstep(pos.getY(i), -0.04, 0.05));
    col.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, color: UNDERWATER, roughness: 0.35, metalness: 0.25, transparent: true, opacity: 0.9 }));
  group.add(bodyMesh);

  const finMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(sp.fin).multiply(UNDERWATER), roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const tri = (a: number[], b: number[], d: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...d], 3));
    g.computeVertexNormals();
    return g;
  };
  const back = -0.2 * sp.len;
  const tail = new THREE.Group();
  tail.position.z = back;
  tail.add(new THREE.Mesh(tri([0, 0, 0], [0, 0.11, -0.16], [0, -0.11, -0.16]), finMat));
  group.add(tail);
  group.add(new THREE.Mesh(tri([0, 0.07, 0.05], [0, 0.07, -0.12 * sp.len], [0, 0.15, -0.06 * sp.len]), finMat));
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshBasicMaterial({ color: '#111' }));
    eye.position.set(s * 0.05, 0.025, 0.15 * sp.len);
    group.add(eye);
  }
  group.traverse((o) => { o.castShadow = true; o.renderOrder = 2; });
  group.scale.setScalar(1.8);
  return { group, tail };
}

export class School {
  group = new THREE.Group();
  fish: Fish[] = [];
  onSplash: (p: THREE.Vector3, big: boolean) => void = () => {};

  constructor(private map: WorldMap, count: number) {
    for (let i = 0; i < count; i++) {
      const species = i % SPECIES.length;
      const { group, tail } = fishMesh(SPECIES[species]);
      const f: Fish = {
        group, tail, species,
        z: 1 + Math.random() * (map.H - 2), lat: 0,
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 0.5 + Math.random() * 0.5, seed: Math.random() * 100,
        agility: THREE.MathUtils.clamp(SPECIES[species].agility + (Math.random() - 0.5) * 0.3, 0, 1),
        lure: null, hooked: false, respawn: 0, jump: -1, nextJump: 6 + Math.random() * 14,
      };
      this.group.add(group);
      this.fish.push(f);
    }
  }

  closest(p: THREE.Vector3): Fish | null {
    let best: Fish | null = null;
    let d = Infinity;
    for (const f of this.fish) {
      if (f.hooked || f.respawn > 0) continue;
      const dd = f.group.position.distanceTo(p);
      if (dd < d) { d = dd; best = f; }
    }
    return best;
  }

  near(p: THREE.Vector3, r: number): Fish[] {
    return this.fish
      .filter((f) => !f.hooked && f.respawn <= 0 && f.group.position.distanceTo(p) < r)
      .sort((a, b) => a.group.position.distanceTo(p) - b.group.position.distanceTo(p));
  }

  caught(f: Fish, heroZ: number) {
    f.hooked = false;
    f.lure = null;
    f.group.visible = false;
    f.respawn = 20;
    f.z = heroZ > this.map.H / 2 ? 2 + Math.random() * 8 : this.map.H - 10 + Math.random() * 8;
  }

  release(f: Fish) {
    f.lure = null;
    f.hooked = false;
    f.dir = Math.random() < 0.5 ? 1 : -1;
    f.speed = 1.4;
  }

  update(dt: number, t: number) {
    for (const f of this.fish) {
      if (f.respawn > 0) {
        f.respawn -= dt;
        if (f.respawn <= 0) f.group.visible = true;
        continue;
      }
      if (f.hooked) continue;
      const g = f.group;
      const prev = g.position.clone();
      if (f.lure) {
        const to = f.lure.clone().setY(SWIM_Y);
        const d = to.distanceTo(g.position);
        const pace = 0.45 + f.agility * 1.6;
        if (d > 0.05) {
          const dir = to.sub(g.position).normalize();
          dir.x += Math.sin(t * 4 + f.seed) * 0.25 * Math.min(1, d);
          g.position.addScaledVector(dir.normalize(), Math.min(d, dt * pace));
        }
        f.z = g.position.z;
        f.lat = g.position.x - this.map.riverCenter(f.z);
      } else {
        f.speed += (0.6 - f.speed) * dt * 0.5;
        f.z += f.dir * f.speed * dt;
        if (f.z < 1 || f.z > this.map.H - 1) f.dir = f.z < 1 ? 1 : -1;
        if (Math.random() < dt * 0.05) f.dir = f.dir === 1 ? -1 : 1;
        f.lat += (Math.sin(t * 0.4 + f.seed) * 0.6 - f.lat) * dt;
        g.position.set(this.map.riverCenter(f.z) + f.lat, SWIM_Y, f.z);
      }
      const mv = g.position.clone().sub(prev);
      if (mv.lengthSq() > 1e-7) {
        const want = Math.atan2(mv.x, mv.z);
        let diff = want - g.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        g.rotation.y += diff * Math.min(1, dt * 6);
      }
      f.tail.rotation.y = Math.sin(t * (f.lure ? 6 : 9) + f.seed) * 0.5;

      if (!f.lure) {
        f.nextJump -= dt;
        if (f.nextJump <= 0 && f.jump < 0) { f.jump = 0; this.onSplash(g.position.clone().setY(0.05), false); }
        if (f.jump >= 0) {
          f.jump += dt / 0.85;
          const k = Math.min(1, f.jump);
          g.position.y = SWIM_Y + Math.sin(k * Math.PI) * 0.75;
          g.rotation.x = -Math.cos(k * Math.PI) * 0.9;
          if (f.jump >= 1) {
            f.jump = -1;
            f.nextJump = 8 + Math.random() * 16;
            g.rotation.x = 0;
            this.onSplash(g.position.clone().setY(0.05), true);
          }
        }
      }
    }
  }
}
