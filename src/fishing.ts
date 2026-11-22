import * as THREE from 'three';
import { Hero } from './hero';
import { Fish, School } from './world/fish';
import { Puffs, Ripples } from './fx/particles';

type Phase = 'cast' | 'wait' | 'nibble' | 'hook' | 'reel';
export type FishingResult =
  | { kind: 'caught'; fish: Fish }
  | { kind: 'early' }
  | { kind: 'late' }
  | { kind: 'slip' }
  | null;

export interface Meter { needle: number; zone: number; width: number }

const WATER_Y = 0.06;
const LURE_RADIUS = 9;

export class Fishing {
  active = false;
  private phase: Phase = 'cast';
  private t = 0;
  private wait = 0;
  private nibblesLeft = 0;
  private nibbleT = 0;
  private biter: Fish | null = null;
  private lured: Fish[] = [];
  private target = new THREE.Vector3();
  private bobber = new THREE.Group();
  private line: THREE.Line;
  private linePts = new Float32Array(20 * 3);
  private tip = new THREE.Vector3();
  private reelFrom = new THREE.Vector3();
  private needleSpeed = 1;
  alertAt: THREE.Vector3 | null = null;
  hint: string | null = null;
  meter: Meter | null = null;

  constructor(scene: THREE.Scene, private hero: Hero, private school: School, private splash: Puffs, private ripples: Ripples) {
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e0322a', roughness: 0.4 }));
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), new THREE.MeshStandardMaterial({ color: '#222' }));
    stick.position.y = 0.1;
    this.bobber.add(red, white, stick);
    this.bobber.visible = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePts, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#f4f0e6', transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.bobber, this.line);
  }

  start(bobberAt: { x: number; z: number }) {
    this.active = true;
    this.phase = 'cast';
    this.t = 0;
    this.biter = null;
    this.lured = [];
    this.meter = null;
    this.target.set(bobberAt.x + (Math.random() - 0.5) * 0.3, WATER_Y, bobberAt.z + (Math.random() - 0.5) * 0.4);
    this.hero.face(this.target.x, this.target.z);
    this.hero.fishing = true;
    this.hero.cast = 0;
    this.bobber.visible = this.line.visible = true;
    this.hint = 'Casting…';
  }

  stop() {
    for (const f of this.lured) if (!f.hooked) this.school.release(f);
    if (this.biter && !this.biter.hooked) this.school.release(this.biter);
    this.lured = [];
    this.biter = null;
    this.active = false;
    this.hero.fishing = false;
    this.hero.reeling = false;
    this.bobber.visible = this.line.visible = false;
    this.alertAt = null;
    this.hint = null;
    this.meter = null;
  }

  update(dt: number, t: number, pressed: boolean): FishingResult {
    if (!this.active) return null;
    this.t += dt;
    this.hero.rodTip(this.tip);
    const b = this.bobber.position;
    let result: FishingResult = null;

    switch (this.phase) {
      case 'cast': {
        const k = Math.min(1, this.t / 0.75);
        this.hero.cast = Math.min(1, this.t / 0.5);
        if (k < 0.3) b.copy(this.tip);
        else {
          const f = (k - 0.3) / 0.7;
          b.lerpVectors(this.tip, this.target, f);
          b.y += Math.sin(f * Math.PI) * 1.2;
        }
        if (k >= 1) {
          b.copy(this.target);
          this.ripples.emit(b, 0.7);
          this.splash.emit(b.clone(), new THREE.Vector3(0, 0.6, 0), 0.4, 0.14, 1.5);
          this.phase = 'wait';
          this.t = 0;
          this.wait = 0.8 + Math.random() * 1.0;
          this.attract();
          this.hint = 'Fish are coming… don\'t pull until it really bites!';
        }
        break;
      }
      case 'wait': {
        b.y = WATER_Y + Math.sin(t * 3) * 0.012;
        if (pressed) return this.miss('early');
        if (Math.random() < dt * 0.4) this.ripples.emit(b, 0.3, 0.9);
        if (this.t > 6 && Math.random() < dt) this.attract(this.t > 10 ? LURE_RADIUS * 2.5 : LURE_RADIUS);
        if (this.t > this.wait) {
          const first = this.lured.find((f) => this.flatDist(f, b) < 0.32);
          if (first) {
            this.biter = first;
            this.circleOthers();
            this.phase = 'nibble';
            this.t = 0;
            this.nibblesLeft = Math.floor(Math.random() * 2) + Math.round(first.agility);
            this.nibbleT = 0.4 + Math.random() * 0.6;
            this.hint = 'Nibbling… wait for it…';
          }
        }
        break;
      }
      case 'nibble': {
        if (pressed) return this.miss('early');
        this.nibbleT -= dt;
        const twitch = this.nibbleT < 0.25 && this.nibbleT > 0 ? Math.max(0, Math.sin(this.nibbleT * 40)) * 0.035 : 0;
        b.y = WATER_Y - twitch;
        if (this.nibbleT <= 0) {
          if (this.nibblesLeft-- > 0) {
            this.ripples.emit(b, 0.35, 0.7);
            this.nibbleT = 0.5 + Math.random() * 0.9;
          } else {
            this.startHook();
          }
        }
        break;
      }
      case 'hook': {
        b.y = WATER_Y - 0.09 + Math.sin(t * 30) * 0.012;
        const m = this.meter!;
        m.needle = (1 - Math.cos(this.t * this.needleSpeed * Math.PI)) / 2;
        this.alertAt = b.clone().setY(0.9);
        if (pressed) {
          if (Math.abs(m.needle - m.zone) <= m.width / 2 + 0.04) this.startReel();
          else return this.miss('slip');
        } else if (this.t > 5) {
          return this.miss('late');
        }
        break;
      }
      case 'reel': {
        const k = Math.min(1, this.t / 0.9);
        const f = this.biter!;
        const to = new THREE.Vector3(this.hero.x, 1.1, this.hero.z);
        f.group.position.lerpVectors(this.reelFrom, to, k);
        f.group.position.y += Math.sin(k * Math.PI) * 1.4;
        f.group.rotation.x = -1.2 + k * 2.4;
        f.tail.rotation.y = Math.sin(t * 30) * 0.7;
        b.copy(f.group.position);
        this.hero.cast = 0.5 + k * 0.5;
        this.hero.reeling = k < 0.8;
        if (k >= 1) {
          f.group.rotation.x = 0;
          this.school.caught(f, this.hero.z);
          this.biter = null;
          this.stop();
          result = { kind: 'caught', fish: f };
        }
        break;
      }
    }

    if (this.active) this.drawLine();
    return result;
  }

  private flatDist(f: Fish, p: THREE.Vector3) {
    return Math.hypot(f.group.position.x - p.x, f.group.position.z - p.z);
  }

  private attract(radius = LURE_RADIUS) {
    for (const f of this.school.near(this.target, radius)) {
      if (this.lured.includes(f)) continue;
      f.lure = this.target.clone();
      this.lured.push(f);
    }
  }

  private circleOthers() {
    this.lured.forEach((f, i) => {
      if (f === this.biter) return;
      const a = (i / Math.max(1, this.lured.length)) * Math.PI * 2;
      f.lure = this.target.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8));
    });
  }

  private startHook() {
    const ag = this.biter?.agility ?? 0.5;
    this.phase = 'hook';
    this.t = 0;
    this.needleSpeed = 0.55 + ag * 0.6;
    const width = 0.34 - ag * 0.1;
    this.meter = { needle: 0, zone: 0.2 + Math.random() * 0.6, width };
    this.ripples.emit(this.bobber.position, 0.9, 0.9);
    this.splash.emit(this.bobber.position.clone(), new THREE.Vector3(0, 0.9, 0), 0.4, 0.16, 1.6);
    this.hint = 'BITE! Press E in the green!';
  }

  private startReel() {
    this.phase = 'reel';
    this.t = 0;
    this.alertAt = null;
    this.meter = null;
    this.hint = null;
    const f = this.biter!;
    f.hooked = true;
    f.lure = null;
    this.reelFrom.copy(f.group.position);
    this.splash.emit(this.bobber.position.clone(), new THREE.Vector3(0, 1.4, 0), 0.6, 0.22, 1.6);
    this.ripples.emit(this.bobber.position, 1.2, 1.1);
  }

  private miss(kind: 'early' | 'late' | 'slip'): FishingResult {
    this.splash.emit(this.bobber.position.clone(), new THREE.Vector3(0, 0.5, 0), 0.4, 0.12, 1.4);
    this.ripples.emit(this.bobber.position, 0.8, 0.8);
    this.stop();
    return { kind };
  }

  private drawLine() {
    const a = this.tip, b = this.bobber.position;
    const sag = this.phase === 'cast' ? 0.05 : this.phase === 'hook' ? 0.05 : 0.35;
    for (let i = 0; i < 20; i++) {
      const k = i / 19;
      this.linePts[i * 3] = a.x + (b.x - a.x) * k;
      this.linePts[i * 3 + 1] = a.y + (b.y + 0.12 - a.y) * k - Math.sin(k * Math.PI) * sag;
      this.linePts[i * 3 + 2] = a.z + (b.z - a.z) * k;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}
