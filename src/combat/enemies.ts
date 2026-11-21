/**
 * Monsters of the wilds. Each enemy has its own health (scaled by its size), a floating
 * health bar, and a telegraphed attack: watch the wind-up, then get out of the way.
 *
 * Enemies move on the tile grid (no rigid bodies): they avoid trees, water and buildings
 * and never step into the village.
 */
import * as THREE from 'three';
import { EnemyKind, SPAWN_ZONES, WorldMap } from '../world/map';

interface EnemyStats {
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  radius: number;
  aggro: number;
  /** distance at which it starts its attack */
  reach: number;
  windup: number;
  cooldown: number;
  /** how far sword hits push it */
  knock: number;
  /** wind-up can't be interrupted by hits */
  armored: boolean;
  barY: number;
}

export const STATS: Record<EnemyKind, EnemyStats> = {
  jelly: { name: 'Jelly', hp: 34, dmg: 8, speed: 1.9, radius: 0.42, aggro: 7, reach: 2.4, windup: 0.55, cooldown: 1.2, knock: 7, armored: false, barY: 1.0 },
  beetle: { name: 'Thornback', hp: 60, dmg: 14, speed: 2.6, radius: 0.5, aggro: 8.5, reach: 5, windup: 0.7, cooldown: 1.6, knock: 4.5, armored: false, barY: 1.05 },
  brute: { name: 'Mushroom Brute', hp: 130, dmg: 22, speed: 1.3, radius: 0.62, aggro: 7, reach: 1.9, windup: 0.95, cooldown: 2.2, knock: 1.8, armored: true, barY: 2.1 },
};

type State = 'wander' | 'chase' | 'windup' | 'attack' | 'recover' | 'stagger' | 'dead' | 'home';

export interface Enemy {
  kind: EnemyKind;
  stats: EnemyStats;
  group: THREE.Group;
  body: THREE.Object3D;
  /** materials that flash white when hit */
  flashMats: THREE.MeshStandardMaterial[];
  parts: Record<string, THREE.Object3D>;
  x: number; z: number; yaw: number;
  kx: number; kz: number; // knockback velocity
  hp: number; maxHp: number;
  size: number;
  state: State;
  t: number;
  cool: number;
  flash: number;
  home: { x: number; z: number };
  wander: { x: number; z: number } | null;
  dir: { x: number; z: number };
  hitHero: boolean;
  respawn: number;
  zone: number;
  bar: THREE.Group;
  barFill: THREE.Mesh;
  seenT: number;
  danger?: THREE.Mesh;
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function eyes(parent: THREE.Object3D, y: number, z: number, spread: number, r: number, glow?: string) {
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), glow ? std(glow, { emissive: glow, emissiveIntensity: 2.2 }) : std('#1a1420', { roughness: 0.2 }));
    e.position.set(s * spread, y, z);
    e.scale.y = 1.3;
    parent.add(e);
    if (!glow) {
      const shine = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 6, 4), new THREE.MeshBasicMaterial({ color: '#fff' }));
      shine.position.set(s * spread + r * 0.3, y + r * 0.4, z + r * 0.75);
      parent.add(shine);
    }
  }
}

function buildJelly(hue: number) {
  const body = new THREE.Group();
  const col = new THREE.Color().setHSL(hue, 0.65, 0.55);
  const skin = std(col, { roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.88, emissive: col.clone().multiplyScalar(0.18) });
  const blob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), skin);
  blob.scale.set(1, 0.78, 1);
  blob.position.y = 0.33;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), std(col.clone().multiplyScalar(0.55)));
  core.position.y = 0.3;
  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), skin);
  tuft.position.set(0.05, 0.68, -0.02);
  tuft.rotation.z = -0.4;
  body.add(core, blob, tuft);
  eyes(body, 0.42, 0.32, 0.13, 0.055);
  return { body, flash: [skin], parts: { blob } };
}

function buildBeetle(hue: number) {
  const body = new THREE.Group();
  const shellCol = new THREE.Color().setHSL(hue, 0.55, 0.32);
  const shell = std(shellCol, { roughness: 0.3, metalness: 0.25 });
  const dark = std('#2a1c18');
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  dome.scale.set(0.85, 0.75, 1.1);
  dome.position.y = 0.22;
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.12, 16), dark);
  belly.scale.set(1, 1, 1.3);
  belly.position.y = 0.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), dark);
  head.position.set(0, 0.28, 0.55);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 6), std('#e8dcc0'));
  horn.position.set(0, 0.42, 0.7);
  horn.rotation.x = 0.9;
  body.add(dome, belly, head, horn);
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 5), std('#e8dcc0'));
    spike.position.set(0, 0.55 - Math.abs(i - 2) * 0.05, -0.35 + i * 0.16);
    spike.rotation.x = -0.3;
    body.add(spike);
  }
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.32, 5), dark);
      leg.geometry.translate(0, -0.16, 0);
      leg.position.set(s * 0.38, 0.24, -0.25 + i * 0.25);
      leg.rotation.z = s * 0.9;
      body.add(leg);
      legs.push(leg);
    }
  eyes(body, 0.32, 0.72, 0.09, 0.045, '#ffd23a');
  return { body, flash: [shell], parts: { leg0: legs[0], leg1: legs[1], leg2: legs[2], leg3: legs[3], leg4: legs[4], leg5: legs[5], dome } };
}

function buildBrute(hue: number) {
  const body = new THREE.Group();
  const capCol = new THREE.Color().setHSL(hue, 0.65, 0.42);
  const cap = std(capCol, { roughness: 0.45 });
  const stem = std('#efe2c4', { roughness: 0.8 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.48, 0.9, 16), stem);
  trunk.position.y = 0.5;
  const capMesh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), cap);
  capMesh.scale.set(1, 0.7, 1);
  capMesh.position.y = 0.88;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 6, 24), cap);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.9;
  const capGroup = new THREE.Group();
  capGroup.add(capMesh, rim);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3, r = 0.35 + (i % 3) * 0.13;
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.09 + (i % 2) * 0.04, 8, 6), std('#fff6e8'));
    spot.scale.y = 0.4;
    spot.position.set(Math.cos(a) * r, 0.88 + Math.sqrt(Math.max(0, 0.64 - r * r)) * 0.7 - 0.02, Math.sin(a) * r);
    capGroup.add(spot);
  }
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.42, 0.7, 0.05);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), stem);
    arm.position.y = -0.22;
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), stem);
    fist.position.y = -0.45;
    pivot.add(arm, fist);
    pivot.rotation.z = s * 0.35;
    body.add(pivot);
    arms.push(pivot);
  }
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 6), stem);
    foot.scale.set(1, 0.6, 1.3);
    foot.position.set(s * 0.22, 0.08, 0.08);
    body.add(foot);
  }
  body.add(trunk, capGroup);
  eyes(body, 0.66, 0.38, 0.13, 0.06);
  // angry brows
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.04), std('#4a3020'));
    brow.position.set(s * 0.13, 0.76, 0.42);
    brow.rotation.z = s * 0.4;
    body.add(brow);
  }
  return { body, flash: [cap, stem], parts: { cap: capGroup, armL: arms[0], armR: arms[1] } };
}

function healthBar(width: number) {
  const g = new THREE.Group();
  const mk = (color: string, w: number, h: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    m.position.z = z;
    m.renderOrder = 20;
    return m;
  };
  const back = mk('#141a30', width + 0.06, 0.13, 0);
  const fill = mk('#58d860', width, 0.08, 0.001);
  fill.geometry.translate(width / 2, 0, 0);
  fill.position.x = -width / 2;
  g.add(back, fill);
  g.visible = false;
  return { bar: g, fill };
}

export interface SlashHit { enemy: Enemy; dmg: number; crit: boolean; killed: boolean }

export class Enemies {
  group = new THREE.Group();
  list: Enemy[] = [];
  /** Hero got hit: damage and the direction it came from. */
  onHeroHit: (dmg: number, fromX: number, fromZ: number) => void = () => {};
  onShockwave: (x: number, z: number, r: number) => void = () => {};
  onDeath: (e: Enemy) => void = () => {};
  onStep: (x: number, z: number) => void = () => {};

  constructor(private map: WorldMap, count: number) {
    let n = 0;
    while (n < count) {
      for (let zi = 0; zi < SPAWN_ZONES.length && n < count; zi++) {
        const kinds = SPAWN_ZONES[zi].kinds;
        this.spawn(kinds[n % kinds.length], zi);
        n++;
      }
    }
  }

  private freeSpot(zi: number, awayFrom?: { x: number; z: number }) {
    const zn = SPAWN_ZONES[zi];
    for (let i = 0; i < 60; i++) {
      const x = zn.x0 + Math.random() * (zn.x1 - zn.x0);
      const z = zn.z0 + Math.random() * (zn.z1 - zn.z0);
      if (awayFrom && Math.hypot(x - awayFrom.x, z - awayFrom.z) < 12) continue;
      if (this.free(x, z, 0.6)) return { x, z };
    }
    return { x: (zn.x0 + zn.x1) / 2, z: (zn.z0 + zn.z1) / 2 };
  }

  private spawn(kind: EnemyKind, zone: number) {
    const stats = STATS[kind];
    const hue = kind === 'jelly' ? [0.3, 0.55, 0.85, 0.12][Math.floor(Math.random() * 4)] : kind === 'beetle' ? [0.0, 0.08, 0.7][Math.floor(Math.random() * 3)] : [0.0, 0.58, 0.08][Math.floor(Math.random() * 3)];
    const built = kind === 'jelly' ? buildJelly(hue) : kind === 'beetle' ? buildBeetle(hue) : buildBrute(hue);
    const size = 0.85 + Math.random() * 0.35;
    const group = new THREE.Group();
    built.body.scale.setScalar(size);
    built.body.traverse((o) => { o.castShadow = true; });
    group.add(built.body);
    const { bar, fill } = healthBar(kind === 'brute' ? 1.1 : 0.8);
    this.group.add(group, bar);
    const at = this.freeSpot(zone);
    // bigger individuals are tougher
    const maxHp = Math.round(stats.hp * size * size * (0.9 + Math.random() * 0.2));
    const e: Enemy = {
      kind, stats, group, body: built.body, flashMats: built.flash, parts: built.parts,
      x: at.x, z: at.z, yaw: Math.random() * Math.PI * 2, kx: 0, kz: 0,
      hp: maxHp, maxHp, size, state: 'wander', t: Math.random() * 2, cool: 0, flash: 0,
      home: { ...at }, wander: null, dir: { x: 0, z: 1 }, hitHero: false, respawn: 0, zone,
      bar, barFill: fill, seenT: 0,
    };
    if (kind === 'brute') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 1, 40), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      ring.visible = false;
      this.group.add(ring);
      e.danger = ring;
    }
    this.list.push(e);
  }

  /** Is the circle at (x,z) clear of trees, water, buildings and the village? */
  private free(x: number, z: number, r: number) {
    const m = this.map;
    if (m.isSafe(x, z)) return false;
    return !(m.isBlocked(Math.floor(x - r), Math.floor(z - r)) || m.isBlocked(Math.floor(x + r), Math.floor(z - r)) ||
      m.isBlocked(Math.floor(x - r), Math.floor(z + r)) || m.isBlocked(Math.floor(x + r), Math.floor(z + r)));
  }

  /** Move with sliding collision; returns false if fully blocked. */
  private move(e: Enemy, dx: number, dz: number) {
    const r = e.stats.radius * e.size * 0.8;
    let moved = false;
    if (this.free(e.x + dx, e.z, r)) { e.x += dx; moved = true; }
    if (this.free(e.x, e.z + dz, r)) { e.z += dz; moved = true; }
    return moved;
  }

  private face(e: Enemy, tx: number, tz: number, dt: number, rate = 8) {
    const want = Math.atan2(tx - e.x, tz - e.z);
    let d = want - e.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e.yaw += d * Math.min(1, dt * rate);
  }

  /** Sword slash: damage every living enemy in the arc. */
  slash(center: THREE.Vector3, r: number, fwd: THREE.Vector3, combo: number, heroX: number, heroZ: number): SlashHit[] {
    const hits: SlashHit[] = [];
    for (const e of this.list) {
      if (e.state === 'dead') continue;
      const reach = r + e.stats.radius * e.size;
      const d = Math.hypot(e.x - center.x, e.z - center.z);
      // must be in front of the hero, not behind
      const ahead = (e.x - heroX) * fwd.x + (e.z - heroZ) * fwd.z;
      if (d > reach || ahead < -0.3) continue;
      const base = [10, 12, 22][combo];
      const crit = Math.random() < 0.12;
      const dmg = Math.round(base * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1));
      e.hp -= dmg;
      e.flash = 1;
      e.seenT = 4;
      const kb = e.stats.knock * (combo === 2 ? 1.6 : 1);
      const ax = e.x - heroX, az = e.z - heroZ, al = Math.hypot(ax, az) || 1;
      e.kx = (ax / al) * kb;
      e.kz = (az / al) * kb;
      const killed = e.hp <= 0;
      if (killed) {
        e.state = 'dead';
        e.t = 0;
        e.respawn = 35 + Math.random() * 20;
        if (e.danger) e.danger.visible = false;
        this.onDeath(e);
      } else if (!(e.stats.armored && e.state === 'windup') || combo === 2) {
        // interrupt everything except an armored wind-up (only the finisher breaks it)
        e.state = 'stagger';
        e.t = 0;
        if (e.danger) e.danger.visible = false;
      }
      hits.push({ enemy: e, dmg, crit, killed });
    }
    return hits;
  }

  update(dt: number, t: number, hero: { x: number; z: number; alive: boolean }, camera: THREE.Camera, active: boolean) {
    const heroSafe = this.map.isSafe(hero.x, hero.z);
    for (const e of this.list) {
      if (e.state === 'dead') {
        e.t += dt;
        // poof: squash and vanish
        const k = Math.min(1, e.t / 0.35);
        e.group.scale.set(1 + k * 0.6, Math.max(0.001, 1 - k), 1 + k * 0.6);
        e.bar.visible = false;
        if (e.t > 0.35) e.group.visible = false;
        e.respawn -= dt;
        if (e.respawn <= 0) this.revive(e, hero);
        continue;
      }
      if (active) this.think(e, dt, t, hero, heroSafe);

      // knockback slide + friction
      if (Math.abs(e.kx) + Math.abs(e.kz) > 0.01) {
        this.move(e, e.kx * dt, e.kz * dt);
        const f = Math.exp(-dt * 7);
        e.kx *= f;
        e.kz *= f;
      }
      this.animate(e, dt, t);

      // health bar: visible when near the hero or recently hit
      e.seenT = Math.max(0, e.seenT - dt);
      const near = Math.hypot(e.x - hero.x, e.z - hero.z) < 9;
      e.bar.visible = near || e.seenT > 0;
      if (e.bar.visible) {
        e.bar.position.set(e.x, e.stats.barY * e.size + 0.25, e.z);
        e.bar.quaternion.copy(camera.quaternion);
        const ratio = Math.max(0, e.hp / e.maxHp);
        e.barFill.scale.x = Math.max(0.001, ratio);
        (e.barFill.material as THREE.MeshBasicMaterial).color.set(ratio > 0.5 ? '#58d860' : ratio > 0.25 ? '#f2c040' : '#ef4a3a');
      }
    }
    this.separate();
  }

  private think(e: Enemy, dt: number, t: number, hero: { x: number; z: number; alive: boolean }, heroSafe: boolean) {
    const s = e.stats;
    e.t += dt;
    e.cool = Math.max(0, e.cool - dt);
    const dx = hero.x - e.x, dz = hero.z - e.z;
    const dist = Math.hypot(dx, dz);
    const fromHome = Math.hypot(e.x - e.home.x, e.z - e.home.z);
    const canSee = hero.alive && !heroSafe && dist < s.aggro;

    switch (e.state) {
      case 'wander': {
        if (canSee && fromHome < 15) { e.state = 'chase'; e.t = 0; break; }
        if (!e.wander || e.t > 4) {
          e.t = 0;
          const a = Math.random() * Math.PI * 2, r = Math.random() * 4;
          e.wander = Math.random() < 0.35 ? null : { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
        }
        if (e.wander) {
          const wx = e.wander.x - e.x, wz = e.wander.z - e.z, wd = Math.hypot(wx, wz);
          if (wd > 0.2) {
            this.face(e, e.wander.x, e.wander.z, dt, 4);
            if (!this.move(e, (wx / wd) * s.speed * 0.4 * dt, (wz / wd) * s.speed * 0.4 * dt)) e.wander = null;
          } else e.wander = null;
        }
        break;
      }
      case 'chase': {
        if (!canSee || fromHome > 16) { e.state = 'home'; e.t = 0; break; }
        this.face(e, hero.x, hero.z, dt);
        if (dist < s.reach && e.cool <= 0) {
          e.state = 'windup';
          e.t = 0;
          e.dir = { x: dx / dist, z: dz / dist };
          if (e.danger) { e.danger.visible = true; e.danger.position.set(e.x, 0.06, e.z); }
          break;
        }
        if (dist > s.radius + 0.6) this.move(e, (dx / dist) * s.speed * dt, (dz / dist) * s.speed * dt);
        break;
      }
      case 'home': {
        const hx = e.home.x - e.x, hz = e.home.z - e.z, hd = Math.hypot(hx, hz);
        if (hd < 0.5) { e.state = 'wander'; e.t = 0; break; }
        this.face(e, e.home.x, e.home.z, dt);
        this.move(e, (hx / hd) * s.speed * 0.8 * dt, (hz / hd) * s.speed * 0.8 * dt);
        if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.15 * dt);
        if (canSee && fromHome < 8) { e.state = 'chase'; e.t = 0; }
        break;
      }
      case 'windup': {
        // telegraph: keep tracking the hero a little (not for the beetle: it commits to a line)
        if (e.kind !== 'beetle' && dist > 0.01) e.dir = { x: dx / dist, z: dz / dist };
        this.face(e, e.x + e.dir.x, e.z + e.dir.z, dt, e.kind === 'beetle' ? 12 : 6);
        if (e.danger) {
          const k = Math.min(1, e.t / s.windup);
          const r = 2.3 * e.size;
          e.danger.scale.setScalar(r * (0.35 + k * 0.65));
          (e.danger.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 20) * 0.1 + k * 0.25;
        }
        if (e.t >= s.windup) {
          e.state = 'attack';
          e.t = 0;
          e.hitHero = false;
          if (e.kind === 'brute') {
            if (e.danger) e.danger.visible = false;
            this.onShockwave(e.x, e.z, 2.3 * e.size);
            if (dist < 2.3 * e.size + 0.3 && hero.alive) { this.onHeroHit(s.dmg, e.x, e.z); e.hitHero = true; }
          }
        }
        break;
      }
      case 'attack': {
        const dur = e.kind === 'jelly' ? 0.4 : e.kind === 'beetle' ? 0.75 : 0.35;
        const v = e.kind === 'jelly' ? 6.5 : e.kind === 'beetle' ? 9.5 : 0;
        if (v) {
          const ok = this.move(e, e.dir.x * v * dt, e.dir.z * v * dt);
          if (!ok && e.kind === 'beetle') { e.state = 'stagger'; e.t = -0.6; this.onStep(e.x, e.z); break; } // rammed a wall: dazed
          if (!e.hitHero && dist < s.radius * e.size + 0.45 && hero.alive) { this.onHeroHit(s.dmg, e.x, e.z); e.hitHero = true; }
        }
        if (e.t >= dur) { e.state = 'recover'; e.t = 0; e.cool = s.cooldown; if (e.kind === 'jelly') this.onStep(e.x, e.z); }
        break;
      }
      case 'recover':
        if (e.t > 0.45) { e.state = canSee ? 'chase' : 'home'; e.t = 0; }
        break;
      case 'stagger':
        if (e.t > 0.3) { e.state = canSee ? 'chase' : 'home'; e.t = 0; e.cool = Math.max(e.cool, 0.5); }
        break;
    }
  }

  private animate(e: Enemy, dt: number, t: number) {
    const g = e.group;
    g.position.set(e.x, 0, e.z);
    g.rotation.y = e.yaw;
    const b = e.body;
    b.position.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    const base = e.size;
    b.scale.setScalar(base);
    if (e.kind === 'jelly') {
      const blob = e.parts.blob;
      if (e.state === 'windup') {
        const k = Math.min(1, e.t / e.stats.windup);
        b.scale.set(base * (1 + k * 0.25), base * (1 - k * 0.35), base * (1 + k * 0.25));
        b.position.x = Math.sin(t * 40) * 0.03 * k;
      } else if (e.state === 'attack') {
        const k = Math.min(1, e.t / 0.4);
        b.position.y = Math.sin(k * Math.PI) * 0.9;
        b.scale.set(base * 0.9, base * 1.2, base * 0.9);
      } else {
        // idle/walk bounce
        const hop = Math.abs(Math.sin(t * (e.state === 'chase' ? 7 : 3.5) + e.home.x));
        b.position.y = hop * (e.state === 'chase' ? 0.22 : 0.08);
        const sq = 1 - hop * 0.12;
        b.scale.set(base * (2 - sq), base * sq, base * (2 - sq));
      }
      blob.rotation.y = Math.sin(t * 2) * 0.1;
    } else if (e.kind === 'beetle') {
      const walking = e.state === 'chase' || e.state === 'wander' || e.state === 'attack' || e.state === 'home';
      const speed = e.state === 'attack' ? 30 : 14;
      for (let i = 0; i < 6; i++) {
        const leg = e.parts[`leg${i}`];
        const side = i < 3 ? -1 : 1;
        leg.rotation.x = walking ? Math.sin(t * speed + i * 2.1) * 0.6 : 0;
        leg.rotation.z = side * 0.9;
      }
      if (e.state === 'windup') {
        // scrape and shake before charging
        b.rotation.x = -0.15;
        b.position.x = Math.sin(t * 50) * 0.04;
        if (Math.random() < dt * 8) this.onStep(e.x - e.dir.x * 0.5, e.z - e.dir.z * 0.5);
      } else if (e.state === 'stagger' && e.t < 0) {
        b.rotation.z = Math.sin(t * 20) * 0.25; // dazed after hitting a wall
      }
    } else {
      const cap = e.parts.cap, armL = e.parts.armL, armR = e.parts.armR;
      if (e.state === 'windup') {
        const k = Math.min(1, e.t / e.stats.windup);
        armL.rotation.x = armR.rotation.x = -k * 2.6;
        cap.position.y = k * 0.1;
        b.rotation.x = -k * 0.25;
      } else if (e.state === 'attack') {
        const k = Math.min(1, e.t / 0.35);
        armL.rotation.x = armR.rotation.x = -2.6 + k * 3.4;
        b.rotation.x = 0.25 * (1 - k);
        b.scale.set(base * (1 + (1 - k) * 0.1), base * (1 - (1 - k) * 0.12), base * (1 + (1 - k) * 0.1));
      } else {
        const walk = e.state === 'chase' || e.state === 'home' || (e.state === 'wander' && e.wander);
        const w = walk ? Math.sin(t * 6) : 0;
        armL.rotation.x = w * 0.5;
        armR.rotation.x = -w * 0.5;
        b.rotation.z = w * 0.06;
        b.position.y = Math.abs(w) * 0.05;
        cap.position.y = Math.sin(t * 2) * 0.01;
      }
    }
    if (e.state === 'stagger' && e.t >= 0) b.rotation.x -= 0.25;
    // hit flash
    e.flash = Math.max(0, e.flash - dt * 6);
    for (const m of e.flashMats) {
      if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
      m.emissive.copy(m.userData.baseEmissive as THREE.Color).lerp(new THREE.Color(2.5, 2.5, 2.5), e.flash);
    }
  }

  /** Keep enemies from stacking on top of each other. */
  private separate() {
    const L = this.list;
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j];
        if (a.state === 'dead' || b.state === 'dead') continue;
        const min = a.stats.radius * a.size + b.stats.radius * b.size;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d > 0.001 && d < min) {
          const push = (min - d) / 2;
          this.move(a, (-dx / d) * push, (-dz / d) * push);
          this.move(b, (dx / d) * push, (dz / d) * push);
        }
      }
  }

  private revive(e: Enemy, hero: { x: number; z: number }) {
    const at = this.freeSpot(e.zone, hero);
    e.x = e.home.x = at.x;
    e.z = e.home.z = at.z;
    e.hp = e.maxHp;
    e.state = 'wander';
    e.t = 0;
    e.kx = e.kz = 0;
    e.group.visible = true;
    e.group.scale.set(1, 1, 1);
  }

  /** Push enemies out of the hero's way (the hero is a physics body; enemies are not). */
  pushFrom(x: number, z: number, r: number) {
    for (const e of this.list) {
      if (e.state === 'dead') continue;
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      const min = r + e.stats.radius * e.size * 0.8;
      if (d > 0.001 && d < min) this.move(e, (dx / d) * (min - d), (dz / d) * (min - d));
    }
  }
}
