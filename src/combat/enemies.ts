import * as THREE from 'three';
import { EnemyKind, SPAWN_ZONES, WorldMap } from '../world/map';
import { MonsterAssets, instantiate } from './monster-assets';

interface EnemyStats {
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  radius: number;
  aggro: number;
  reach: number;
  windup: number;
  cooldown: number;
  knock: number;
  armored: boolean;
  barY: number;
}

export const STATS: Record<EnemyKind, EnemyStats> = {
  jelly: { name: 'Jelly', hp: 34, dmg: 8, speed: 1.9, radius: 0.42, aggro: 7, reach: 2.4, windup: 0.55, cooldown: 1.2, knock: 7, armored: false, barY: 0.85 },
  beetle: { name: 'Thornback', hp: 60, dmg: 14, speed: 2.6, radius: 0.5, aggro: 8.5, reach: 5, windup: 0.7, cooldown: 1.6, knock: 4.5, armored: false, barY: 1.3 },
  brute: { name: 'Mushroom Brute', hp: 130, dmg: 22, speed: 1.3, radius: 0.62, aggro: 7, reach: 1.9, windup: 0.95, cooldown: 2.2, knock: 1.8, armored: true, barY: 2.0 },
};

type State = 'wander' | 'chase' | 'windup' | 'attack' | 'recover' | 'stagger' | 'dead' | 'home';

export interface Enemy {
  kind: EnemyKind;
  stats: EnemyStats;
  group: THREE.Group;
  body: THREE.Object3D;
  flashMats: THREE.MeshStandardMaterial[];
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  clip: string;
  prev: State;
  x: number; z: number; yaw: number;
  kx: number; kz: number;
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

const DEATH_SINK = 0.9;
const DEATH_HIDE = 1.7;
const FLASH = new THREE.Color(1.6, 1.6, 1.6);
const WALK_PACE: Record<EnemyKind, number> = { jelly: 1.1, beetle: 1.3, brute: 1.0 };

export interface SlashHit { enemy: Enemy; dmg: number; crit: boolean; killed: boolean }

export class Enemies {
  group = new THREE.Group();
  list: Enemy[] = [];
  private picked: Partial<Record<EnemyKind, number>> = {};
  onHeroHit: (dmg: number, fromX: number, fromZ: number) => void = () => {};
  onShockwave: (x: number, z: number, r: number) => void = () => {};
  onDeath: (e: Enemy) => void = () => {};
  onStep: (x: number, z: number) => void = () => {};

  constructor(private map: WorldMap, private assets: MonsterAssets, count: number) {
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
    const models = this.assets[kind];
    const n = (this.picked[kind] = (this.picked[kind] ?? Math.floor(Math.random() * models.length)) + 1);
    const model = models[n % models.length];
    const { root, mats } = instantiate(model);
    const size = 0.85 + Math.random() * 0.3;
    const body = new THREE.Group();
    body.add(root);
    const group = new THREE.Group();
    group.add(body);
    const mixer = new THREE.AnimationMixer(root);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const [name, clip] of Object.entries(model.clips)) actions[name] = actions[clip.name] ?? mixer.clipAction(clip);
    const { bar, fill } = healthBar(kind === 'brute' ? 1.1 : 0.8);
    this.group.add(group, bar);
    const at = this.freeSpot(zone);
    const maxHp = Math.round(stats.hp * size * size * (0.9 + Math.random() * 0.2));
    const e: Enemy = {
      kind, stats, group, body, flashMats: mats, mixer, actions, clip: '', prev: 'wander',
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

  private free(x: number, z: number, r: number) {
    const m = this.map;
    if (m.isSafe(x, z)) return false;
    return !(m.isBlocked(Math.floor(x - r), Math.floor(z - r)) || m.isBlocked(Math.floor(x + r), Math.floor(z - r)) ||
      m.isBlocked(Math.floor(x - r), Math.floor(z + r)) || m.isBlocked(Math.floor(x + r), Math.floor(z + r)));
  }

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

  slash(center: THREE.Vector3, r: number, fwd: THREE.Vector3, combo: number, heroX: number, heroZ: number): SlashHit[] {
    const hits: SlashHit[] = [];
    for (const e of this.list) {
      if (e.state === 'dead') continue;
      const reach = r + e.stats.radius * e.size;
      const d = Math.hypot(e.x - center.x, e.z - center.z);
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
        if (e.group.visible) this.animate(e, dt, t);
        e.bar.visible = false;
        if (e.t > DEATH_HIDE) e.group.visible = false;
        e.respawn -= dt;
        if (e.respawn <= 0) this.revive(e, hero);
        continue;
      }
      if (active) this.think(e, dt, t, hero, heroSafe);

      if (Math.abs(e.kx) + Math.abs(e.kz) > 0.01) {
        this.move(e, e.kx * dt, e.kz * dt);
        const f = Math.exp(-dt * 7);
        e.kx *= f;
        e.kz *= f;
      }
      this.animate(e, dt, t);

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
          if (!ok && e.kind === 'beetle') { e.state = 'stagger'; e.t = -0.6; this.onStep(e.x, e.z); break; }
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

  private play(e: Enemy, name: string, fade = 0.15, opts: { once?: boolean; speed?: number; restart?: boolean } = {}) {
    const next = e.actions[name] ?? e.actions.Idle;
    if (!next) return;
    next.timeScale = opts.speed ?? 1;
    if (e.clip === name && !opts.restart) return;
    const cur = e.actions[e.clip];
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!opts.once;
    next.play();
    if (cur && cur !== next) cur.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
    e.clip = name;
  }

  private fit(e: Enemy, name: string, dur: number) {
    const a = e.actions[name];
    return a ? a.getClip().duration / dur : 1;
  }

  private pick(e: Enemy) {
    const s = e.stats, k = e.kind;
    const moving = e.state === 'chase' || e.state === 'home' || (e.state === 'wander' && !!e.wander);
    const fresh = e.state !== e.prev;
    e.prev = e.state;
    switch (e.state) {
      case 'dead': if (fresh) this.play(e, 'Death', 0.1, { once: true, restart: true }); return;
      case 'stagger': if (fresh) this.play(e, k === 'jelly' ? 'HitRecieve' : 'HitReact', 0.06, { once: true, restart: true, speed: this.fit(e, k === 'jelly' ? 'HitRecieve' : 'HitReact', e.t < 0 ? 0.9 : 0.3) }); return;
      case 'windup':
        if (k === 'jelly') this.play(e, 'Idle', 0.1, { speed: 3 });
        else if (k === 'beetle') this.play(e, 'Duck', 0.12, { once: true, speed: 1.67 / s.windup * 0.5 });
        else this.play(e, 'Jump', 0.12, { once: true, speed: 0.37 / s.windup });
        return;
      case 'attack':
        if (k === 'jelly') this.play(e, 'Bite_Front', 0.05, { once: true, restart: fresh, speed: this.fit(e, 'Bite_Front', 0.4) });
        else if (k === 'beetle') this.play(e, 'Run', 0.08, { speed: 1.8 });
        else this.play(e, 'Jump_Land', 0.04, { once: true, restart: fresh });
        return;
      case 'recover': this.play(e, 'Idle', 0.2); return;
    }
    if (!moving) { this.play(e, 'Idle', 0.25); return; }
    const fast = e.state === 'chase';
    if (k === 'beetle' && fast) this.play(e, 'Run', 0.2, { speed: s.speed / 3.2 / e.size });
    else this.play(e, 'Walk', 0.2, { speed: (fast ? s.speed : s.speed * 0.4) / WALK_PACE[k] / e.size });
  }

  private animate(e: Enemy, dt: number, t: number) {
    const g = e.group;
    g.position.set(e.x, 0, e.z);
    g.rotation.y = e.yaw;
    const b = e.body;
    const base = e.size;
    b.position.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    b.scale.setScalar(base);
    this.pick(e);
    e.mixer.update(dt);
    e.flash = Math.max(0, e.flash - dt * 6);
    for (const m of e.flashMats) {
      if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
      m.emissive.copy(m.userData.baseEmissive as THREE.Color).lerp(FLASH, e.flash);
    }
    if (e.state === 'dead') {
      b.position.y = -Math.max(0, e.t - DEATH_SINK) * 1.2 * base;
      return;
    }
    if (e.kind === 'jelly') {
      if (e.state === 'windup') {
        const k = Math.min(1, e.t / e.stats.windup);
        b.scale.set(base * (1 + k * 0.22), base * (1 - k * 0.3), base * (1 + k * 0.22));
        b.position.x = Math.sin(t * 40) * 0.03 * k;
      } else if (e.state === 'attack') {
        const k = Math.min(1, e.t / 0.4);
        b.position.y = Math.sin(k * Math.PI) * 0.8;
      } else if (e.state === 'chase') {
        b.position.y = Math.abs(Math.sin(t * 7 + e.home.x)) * 0.12;
      }
    } else if (e.kind === 'beetle') {
      if (e.state === 'windup') {
        b.position.x = Math.sin(t * 50) * 0.035;
        if (Math.random() < dt * 8) this.onStep(e.x - e.dir.x * 0.5, e.z - e.dir.z * 0.5);
      } else if (e.state === 'attack') {
        b.rotation.x = 0.18;
        if (Math.random() < dt * 14) this.onStep(e.x - e.dir.x * 0.4, e.z - e.dir.z * 0.4);
      } else if (e.state === 'stagger' && e.t < 0) {
        b.rotation.z = Math.sin(t * 20) * 0.2;
      }
    } else if (e.state === 'windup') {
      const k = Math.min(1, e.t / e.stats.windup);
      b.position.y = Math.pow(Math.max(0, (k - 0.35) / 0.65), 0.7) * 0.9 * base;
      b.position.x = Math.sin(t * 30) * 0.02 * (1 - k);
    } else if (e.state === 'attack') {
      const k = Math.min(1, e.t / 0.35);
      b.scale.set(base * (1 + (1 - k) * 0.08), base * (1 - (1 - k) * 0.1), base * (1 + (1 - k) * 0.08));
    }
  }

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
    e.prev = 'dead';
    e.clip = '';
    e.mixer.stopAllAction();
  }

  pushFrom(x: number, z: number, r: number) {
    for (const e of this.list) {
      if (e.state === 'dead') continue;
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      const min = r + e.stats.radius * e.size * 0.8;
      if (d > 0.001 && d < min) this.move(e, (dx / d) * (min - d), (dz / d) * (min - d));
    }
  }
}
