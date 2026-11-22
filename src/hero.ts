import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Physics } from './physics';
import { buildHeroRig, HeroRig } from './hero-model';

const SPEED = 4.2;
const RUN = 7.4;
const RADIUS = 0.34;

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

export class Hero {
  group = new THREE.Group();
  body: CANNON.Body;
  speed = 0;
  private rig: HeroRig;
  private model: THREE.Group;
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private torso: THREE.Group;
  private phase = 0;
  private yaw = 0;
  private prevYaw = 0;
  private blinkT = 2;
  private hairLag = new THREE.Vector2();
  private scarfAngles = [0.4, 0.2, 0.1];
  private scarfVel = [0, 0, 0];
  fishing = false;
  cast = 1;
  private rod = new THREE.Group();
  private rodTipObj = new THREE.Object3D();
  private sword = new THREE.Group();
  private attackT = -1;
  private combo = 0;
  private queued = false;
  private hitDone = false;
  private lastSwingEnd = -10;
  private clock = 0;
  onSlash: (center: THREE.Vector3, forward: THREE.Vector3, combo: number) => void = () => {};
  maxHp = 100;
  hp = 100;
  private invuln = 0;
  down = false;
  private downT = 0;
  swing: { combo: number; k: number; yaw: number } | null = null;

  constructor(x: number, z: number, physics: Physics) {
    this.rig = buildHeroRig();
    this.model = this.rig.root;
    this.torso = this.rig.torso;
    this.arms = this.rig.arms.map((a) => a.upper);
    this.legs = this.rig.legs.map((l) => l.upper);
    this.group.add(this.model);
    const hand = this.rig.arms[0].end;

    const rodDir = new THREE.Vector3(0, -0.75, 0.66).normalize();
    const rodLen = 1.5;
    const rodGeo = new THREE.CylinderGeometry(0.008, 0.02, rodLen, 6);
    rodGeo.translate(0, rodLen / 2, 0);
    const rodMesh = new THREE.Mesh(rodGeo, mat('#7a4a26', { roughness: 0.5 }));
    rodMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rodDir);
    rodMesh.castShadow = true;
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), mat('#b8bcc4', { metalness: 0.7, roughness: 0.3 }));
    reel.position.copy(rodDir).multiplyScalar(0.12).add(new THREE.Vector3(0.04, 0, 0));
    reel.rotation.z = Math.PI / 2;
    this.rodTipObj.position.copy(rodDir).multiplyScalar(rodLen);
    this.rod.add(rodMesh, reel, this.rodTipObj);
    this.rod.visible = false;
    hand.add(this.rod);

    const steel = new THREE.MeshStandardMaterial({ color: '#e6ecf4', metalness: 0.45, roughness: 0.22, emissive: '#1a2230' });
    const gold = mat('#e8b84a', { metalness: 0.6, roughness: 0.3 });
    const blade = new THREE.Group();
    const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.66, 0.014), steel);
    bladeMesh.position.y = 0.43;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.039, 0.12, 4), steel);
    tip.rotation.y = Math.PI / 4;
    tip.scale.z = 0.25;
    tip.position.y = 0.82;
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.5, 0.016), mat('#9aa6b4', { metalness: 0.5, roughness: 0.3 }));
    fuller.position.y = 0.4;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.05), gold);
    guard.position.y = 0.08;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.15, 8), mat('#5a3420'));
    grip.position.y = -0.01;
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), gold);
    pommel.position.y = -0.1;
    blade.add(bladeMesh, tip, fuller, guard, grip, pommel);
    blade.traverse((o) => (o.castShadow = true));
    blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0.3).normalize());
    this.sword.add(blade);
    hand.add(this.sword);

    this.body = new CANNON.Body({
      mass: 6,
      material: physics.heroMat,
      shape: new CANNON.Sphere(RADIUS),
      fixedRotation: true,
      linearDamping: 0,
      allowSleep: false,
    });
    this.body.position.set(x, RADIUS, z);
    physics.world.addBody(this.body);
    this.sync();
  }

  get x() { return this.body.interpolatedPosition.x; }
  get z() { return this.body.interpolatedPosition.z; }

  private sync() {
    const p = this.body.interpolatedPosition;
    this.group.position.set(p.x, p.y - RADIUS, p.z);
  }

  drive(input: { x: number; z: number; run: boolean }, dt: number) {
    let { x, z } = input;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    const target = (input.run ? RUN : SPEED);
    const vx = x * target;
    const vz = z * target;
    const k = 1 - Math.exp(-dt * 14);
    this.body.velocity.x += (vx - this.body.velocity.x) * k;
    this.body.velocity.z += (vz - this.body.velocity.z) * k;
    if (len > 0.1) {
      const want = Math.atan2(x, z);
      let diff = want - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * (1 - Math.exp(-dt * 14));
    }
  }

  stop() {
    this.body.velocity.x = 0;
    this.body.velocity.z = 0;
  }

  animate(dt: number, t: number) {
    this.sync();
    this.speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const moving = Math.min(1, this.speed / SPEED);
    const running = Math.max(0, (this.speed - SPEED) / (RUN - SPEED));
    this.phase += dt * (5 + this.speed * 1.6);
    const s = Math.sin(this.phase);
    const swing = 0.7 * moving + running * 0.3;
    const { legs: L, arms: A, head, hair, chest, eyes } = this.rig;

    L[0].upper.rotation.x = s * swing;
    L[1].upper.rotation.x = -s * swing;
    L[0].lower.rotation.x = Math.max(0, Math.sin(this.phase - 1.2)) * (0.9 + running * 0.5) * moving;
    L[1].lower.rotation.x = Math.max(0, Math.sin(this.phase + Math.PI - 1.2)) * (0.9 + running * 0.5) * moving;
    L[0].end.rotation.x = -L[0].lower.rotation.x * 0.35;
    L[1].end.rotation.x = -L[1].lower.rotation.x * 0.35;

    A[0].upper.rotation.x = -s * swing * 0.85;
    A[1].upper.rotation.x = s * swing * 0.85;
    A[0].lower.rotation.x = -0.25 - moving * 0.35 - running * 0.4 - Math.max(0, -s) * 0.3 * moving;
    A[1].lower.rotation.x = -0.25 - moving * 0.35 - running * 0.4 - Math.max(0, s) * 0.3 * moving;
    A[0].upper.rotation.z = -0.1 - running * 0.1;
    A[1].upper.rotation.z = 0.1 + running * 0.1;

    const bob = Math.abs(Math.cos(this.phase)) * 0.05 * moving;
    const breathe = Math.sin(t * 2.2) * (1 - moving);
    this.torso.position.y = 0.5 + bob + breathe * 0.008;
    this.torso.rotation.x = 0.06 * moving + 0.14 * running;
    this.torso.rotation.y = s * 0.12 * moving;
    this.torso.rotation.z = Math.sin(t * 0.8) * 0.015 * (1 - moving);
    chest.scale.set(1 + breathe * 0.012, 1 + breathe * 0.01, 0.82 + breathe * 0.01);
    this.model.position.y = bob * 0.4;

    head.rotation.y = -this.torso.rotation.y * 0.8 + Math.sin(t * 0.45) * 0.12 * (1 - moving);
    head.rotation.x = -0.04 * moving + Math.sin(t * 0.7) * 0.03 * (1 - moving);

    const turn = Math.atan2(Math.sin(this.yaw - this.prevYaw), Math.cos(this.yaw - this.prevYaw)) / Math.max(dt, 1e-3);
    this.prevYaw = this.yaw;
    const k = 1 - Math.exp(-dt * 10);
    this.hairLag.x += (-(moving * 0.12 + running * 0.1) + Math.cos(this.phase * 2) * 0.03 * moving - this.hairLag.x) * k;
    this.hairLag.y += (THREE.MathUtils.clamp(-turn * 0.02, -0.15, 0.15) - this.hairLag.y) * k;
    hair.rotation.x = this.hairLag.x;
    hair.rotation.z = this.hairLag.y;

    const target = [0.35 + moving * 0.7 + running * 0.4, 0.15 + moving * 0.35, 0.1 + moving * 0.3];
    this.rig.scarf.forEach((seg, i) => {
      const flutter = Math.sin(t * (6 + i * 2) + i) * (0.08 + moving * 0.12);
      const accel = (target[i] + flutter - this.scarfAngles[i]) * 60 - this.scarfVel[i] * 9;
      this.scarfVel[i] += accel * dt;
      this.scarfAngles[i] += this.scarfVel[i] * dt;
      seg.rotation.x = this.scarfAngles[i];
      seg.rotation.z = THREE.MathUtils.clamp(-turn * 0.03, -0.4, 0.4) * (i + 1) * 0.5;
    });

    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? Math.abs(this.blinkT / 0.06 - 1) : 1;
    for (const e of eyes) e.scale.y = Math.max(0.1, blink);
    if (this.blinkT <= 0) this.blinkT = 2.5 + Math.random() * 3;

    this.rod.visible = this.fishing;
    this.sword.visible = !this.fishing;
    this.clock = t;
    this.swing = null;
    if (this.attackT >= 0) {
      A[0].lower.rotation.x = 0;
      A[0].upper.rotation.z = -0.12;
      this.torso.rotation.y = 0;
      this.animateAttack(dt);
    }
    if (this.invuln > 0) this.invuln -= dt;
    if (this.down) {
      this.downT = Math.min(1, this.downT + dt * 3);
      this.model.rotation.x = -this.downT * Math.PI / 2;
      this.model.position.y = 0.15 * this.downT;
    } else this.model.rotation.x = 0;
    if (this.fishing) {
      const castSwing = this.cast < 1 ? Math.sin(this.cast * Math.PI) * 1.4 : 0;
      A[0].upper.rotation.x = -1.25 + castSwing;
      A[0].lower.rotation.x = 0;
      A[1].upper.rotation.x = -0.6;
      A[1].lower.rotation.x = -0.7;
      this.torso.rotation.y = 0;
      for (const l of L) { l.upper.rotation.x = 0; l.lower.rotation.x = 0; l.end.rotation.x = 0; }
    }
    this.model.rotation.y = this.yaw;
  }

  get attacking() { return this.attackT >= 0; }

  hurt(dmg: number, fromX: number, fromZ: number): boolean {
    if (this.invuln > 0 || this.down) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = 0.9;
    const dx = this.x - fromX, dz = this.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.body.velocity.x = (dx / d) * 7;
    this.body.velocity.z = (dz / d) * 7;
    this.attackT = -1;
    if (this.hp <= 0) { this.down = true; this.downT = 0; }
    return true;
  }

  get heading() { return this.yaw; }

  heal(n: number) { this.hp = Math.min(this.maxHp, this.hp + n); }

  revive(x: number, z: number) {
    this.down = false;
    this.hp = this.maxHp;
    this.invuln = 1.5;
    this.body.position.set(x, RADIUS, z);
    this.body.interpolatedPosition.set(x, RADIUS, z);
    this.body.previousPosition.set(x, RADIUS, z);
    this.body.velocity.set(0, 0, 0);
  }

  attack() {
    if (this.fishing || this.down) return;
    if (this.attackT >= 0) {
      if (this.attackT > 0.35) this.queued = true;
      return;
    }
    this.combo = this.clock - this.lastSwingEnd < 0.35 ? (this.combo + 1) % 3 : 0;
    this.beginSwing();
  }

  private beginSwing() {
    this.attackT = 0;
    this.hitDone = false;
    this.queued = false;
  }

  private animateAttack(dt: number) {
    const dur = [0.3, 0.3, 0.44][this.combo];
    this.attackT += dt / dur;
    const k = Math.min(1, this.attackT);
    const p = THREE.MathUtils.smoothstep(k, 0.08, 0.62);
    const arm = this.arms[0];
    if (this.combo === 2) {
      arm.rotation.x = -3.1 + p * 2.7;
      this.torso.rotation.x = -0.15 + p * 0.45;
      this.model.position.y += Math.sin(k * Math.PI) * 0.22;
    } else {
      const from = this.combo === 0 ? -1.15 : 1.0;
      const to = this.combo === 0 ? 1.2 : -1.25;
      this.torso.rotation.y = from + (to - from) * p;
      arm.rotation.x = -1.5;
      arm.rotation.z = this.combo === 0 ? -0.1 : 0.2;
    }
    this.arms[1].rotation.x = -0.5;
    this.rig.arms[1].lower.rotation.x = -0.8;
    this.legs[0].rotation.x = 0.35;
    this.legs[1].rotation.x = -0.25;
    this.rig.legs[0].lower.rotation.x = 0.25;
    this.rig.legs[1].lower.rotation.x = 0.15;
    this.swing = { combo: this.combo, k, yaw: this.yaw };
    if (!this.hitDone && k >= 0.42) {
      this.hitDone = true;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.onSlash(new THREE.Vector3(this.x, 0.5, this.z).addScaledVector(fwd, 0.85), fwd, this.combo);
    }
    if (this.attackT >= 1) {
      if (this.queued) {
        this.combo = (this.combo + 1) % 3;
        this.beginSwing();
      } else {
        this.attackT = -1;
        this.lastSwingEnd = this.clock;
      }
    }
  }

  rodTip(out: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    return this.rodTipObj.getWorldPosition(out);
  }

  face(x: number, z: number) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
    this.model.rotation.y = this.yaw;
  }
}
