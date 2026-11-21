import * as THREE from 'three';
import { Hero } from './hero';
import { Fish, School } from './world/fish';
import { Puffs, Ripples } from './fx/particles';

type Phase = 'cast' | 'wait' | 'nibble' | 'bite' | 'reel';
export type FishingResult =
  | { kind: 'caught'; fish: Fish }
  | { kind: 'early' }
  | { kind: 'late' }
  | null;

const WATER_Y = 0.06;

/**
 * The fishing minigame: cast → wait → nibble → BITE (press E now!) → reel in.
 * Pressing too early scares the fish; waiting too long lets it get away.
 */
export class Fishing {
  active = false;
  private phase: Phase = 'cast';
  private t = 0;
  private wait = 0;
  private fish: Fish | null = null;
  private target = new THREE.Vector3();
  private bobber = new THREE.Group();
  private line: THREE.Line;
  private linePts = new Float32Array(20 * 3);
  private tip = new THREE.Vector3();
  private reelFrom = new THREE.Vector3();
  /** Screen-space "!" while the fish is biting; null otherwise. */
  alertAt: THREE.Vector3 | null = null;
  hint: string | null = null;

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
    this.fish = null;
    this.target.set(bobberAt.x + (Math.random() - 0.5) * 0.4, WATER_Y, bobberAt.z + (Math.random() - 0.5) * 0.6);
    this.hero.face(this.target.x, this.target.z);
    this.hero.fishing = true;
    this.hero.cast = 0;
    this.bobber.visible = this.line.visible = true;
    this.hint = 'Casting…';
  }

  stop() {
    if (this.fish && !this.fish.hooked) this.school.release(this.fish);
    this.active = false;
    this.fish = null;
    this.hero.fishing = false;
    this.bobber.visible = this.line.visible = false;
    this.alertAt = null;
    this.hint = null;
  }

  /** Advance one frame. `pressed` = the action key was pressed this frame. */
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
          this.wait = 1.5 + Math.random() * 2.5;
          this.lure();
          this.hint = 'Wait for a bite… press E when the bobber dips!';
        }
        break;
      }
      case 'wait': {
        b.y = WATER_Y + Math.sin(t * 3) * 0.012;
        if (pressed) return this.miss('early');
        if (!this.fish || this.t > 9) { this.lure(); this.t = Math.min(this.t, 4); }
        const close = this.fish && this.fish.group.position.distanceTo(new THREE.Vector3(b.x, this.fish.group.position.y, b.z)) < 0.3;
        if (close && this.t > this.wait) { this.phase = 'nibble'; this.t = 0; }
        if (Math.random() < dt * 0.4) this.ripples.emit(b, 0.3, 0.9);
        break;
      }
      case 'nibble': {
        // little twitches: don't pull yet!
        b.y = WATER_Y - Math.max(0, Math.sin(this.t * 22)) * 0.03;
        if (pressed) return this.miss('early');
        if (this.t > 0.6 + Math.random() * 0.02 && Math.random() < dt * 3) {
          this.phase = 'bite';
          this.t = 0;
          this.ripples.emit(b, 0.9, 0.9);
          this.splash.emit(b.clone(), new THREE.Vector3(0, 0.9, 0), 0.4, 0.16, 1.6);
          this.hint = 'NOW! Press E!';
        }
        break;
      }
      case 'bite': {
        b.y = WATER_Y - 0.09 + Math.sin(t * 30) * 0.01;
        this.alertAt = b.clone().setY(0.9);
        if (pressed) {
          this.phase = 'reel';
          this.t = 0;
          this.alertAt = null;
          this.hint = null;
          if (this.fish) {
            this.fish.hooked = true;
            this.fish.lure = null;
            this.reelFrom.copy(this.fish.group.position);
          }
          this.splash.emit(b.clone(), new THREE.Vector3(0, 1.4, 0), 0.6, 0.22, 1.6);
          this.ripples.emit(b, 1.2, 1.1);
        } else if (this.t > 0.85) {
          return this.miss('late');
        }
        break;
      }
      case 'reel': {
        // the fish leaps out of the water and arcs to the hero
        const k = Math.min(1, this.t / 0.9);
        const f = this.fish!;
        const to = new THREE.Vector3(this.hero.x, 1.1, this.hero.z);
        f.group.position.lerpVectors(this.reelFrom, to, k);
        f.group.position.y += Math.sin(k * Math.PI) * 1.4;
        f.group.rotation.x = -1.2 + k * 2.4;
        f.tail.rotation.y = Math.sin(t * 30) * 0.7;
        b.copy(f.group.position);
        this.hero.cast = 0.5 + k * 0.5;
        if (k >= 1) {
          f.group.rotation.x = 0;
          this.school.caught(f, this.hero.z);
          const caught = f;
          this.fish = null;
          this.stop();
          result = { kind: 'caught', fish: caught };
        }
        break;
      }
    }

    if (this.active) this.drawLine();
    return result;
  }

  private lure() {
    if (this.fish) this.fish.lure = null;
    this.fish = this.school.closest(this.target);
    if (this.fish) this.fish.lure = this.target.clone();
  }

  private miss(kind: 'early' | 'late'): FishingResult {
    this.splash.emit(this.bobber.position.clone(), new THREE.Vector3(0, 0.5, 0), 0.4, 0.12, 1.4);
    this.stop();
    return { kind };
  }

  /** Sagging fishing line from rod tip to bobber. */
  private drawLine() {
    const a = this.tip, b = this.bobber.position;
    const sag = this.phase === 'cast' ? 0.05 : 0.35;
    for (let i = 0; i < 20; i++) {
      const k = i / 19;
      this.linePts[i * 3] = a.x + (b.x - a.x) * k;
      this.linePts[i * 3 + 1] = a.y + (b.y + 0.12 - a.y) * k - Math.sin(k * Math.PI) * sag;
      this.linePts[i * 3 + 2] = a.z + (b.z - a.z) * k;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}
