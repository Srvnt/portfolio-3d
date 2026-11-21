import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Physics } from './physics';

const SPEED = 4.2;
const RUN = 7.4;
const RADIUS = 0.34;

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

export class Hero {
  group = new THREE.Group();
  body: CANNON.Body;
  speed = 0;
  private model = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private torso: THREE.Group;
  private scarfTail: THREE.Mesh;
  private phase = 0;
  private yaw = 0;
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
    const skin = mat('#f2c49b');
    const tunic = mat('#3f9a5c');
    const pants = mat('#465a92');
    const boots = mat('#5a3a24');
    const hair = mat('#3b2618', { flatShading: true });
    const scarf = mat('#e04848');

    const part = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.11, 0.48, 0);
      part(new THREE.CapsuleGeometry(0.085, 0.24, 4, 8), pants, pivot, 0, -0.2, 0);
      part(new THREE.BoxGeometry(0.17, 0.12, 0.26), boots, pivot, 0, -0.42, 0.04);
      this.model.add(pivot);
      this.legs.push(pivot);
    }

    this.torso = new THREE.Group();
    this.torso.position.y = 0.5;
    this.model.add(this.torso);
    const chest = part(new THREE.CapsuleGeometry(0.2, 0.2, 4, 12), tunic, this.torso, 0, 0.22, 0);
    chest.scale.set(1, 1, 0.8);
    part(new THREE.CylinderGeometry(0.215, 0.23, 0.07, 14), mat('#6b4a2b'), this.torso, 0, 0.06, 0);
    part(new THREE.BoxGeometry(0.08, 0.07, 0.03), mat('#f0c850', { metalness: 0.7, roughness: 0.3 }), this.torso, 0, 0.06, 0.2);
    part(new THREE.CylinderGeometry(0.22, 0.27, 0.16, 14, 1, true), tunic, this.torso, 0, -0.04, 0);

    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.27, 0.42, 0);
      part(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), tunic, pivot, 0, -0.15, 0);
      part(new THREE.SphereGeometry(0.065, 10, 8), skin, pivot, 0, -0.32, 0);
      pivot.rotation.z = side * 0.12;
      this.torso.add(pivot);
      this.arms.push(pivot);
    }

    const head = new THREE.Group();
    head.position.y = 0.72;
    this.torso.add(head);
    part(new THREE.SphereGeometry(0.24, 20, 16), skin, head);
    for (const side of [-1, 1]) {
      const eye = part(new THREE.SphereGeometry(0.035, 10, 8), mat('#2b1e2f', { roughness: 0.2 }), head, side * 0.085, 0.0, 0.215);
      eye.scale.y = 1.5;
      const shine = part(new THREE.SphereGeometry(0.012, 6, 4), mat('#ffffff', { emissive: '#ffffff' }), head, side * 0.085 + 0.012, 0.025, 0.245);
      shine.castShadow = false;
      const blush = part(new THREE.CircleGeometry(0.035, 10), mat('#f59a8a', { transparent: true, opacity: 0.6 }), head, side * 0.14, -0.06, 0.2);
      blush.rotation.y = side * 0.5;
      blush.castShadow = false;
    }
    const cap = part(new THREE.SphereGeometry(0.265, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, head, 0, 0.02, -0.02);
    cap.rotation.x = -0.25;
    const spike = new THREE.ConeGeometry(0.07, 0.22, 5);
    const spikes: [number, number, number, number, number][] = [
      [-0.12, 0.17, 0.16, 0.9, 0.3], [0, 0.2, 0.18, 1.1, 0], [0.12, 0.17, 0.16, 0.9, -0.3],
      [0.05, 0.28, -0.05, -0.3, -0.2], [-0.1, 0.26, -0.12, -0.6, 0.4], [0.14, 0.2, -0.16, -0.9, -0.6],
    ];
    for (const [sx, sy, sz, rx, rz] of spikes) {
      const s = part(spike, hair, head, sx, sy, sz);
      s.rotation.set(rx, 0, rz);
    }
    part(new THREE.TorusGeometry(0.17, 0.05, 6, 14), scarf, this.torso, 0, 0.5, 0).rotation.x = Math.PI / 2;
    this.scarfTail = part(new THREE.BoxGeometry(0.1, 0.32, 0.04), scarf, this.torso, 0.08, 0.36, -0.18);
    this.scarfTail.geometry.translate(0, -0.14, 0);
    this.scarfTail.position.y = 0.5;

    this.group.add(this.model);

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
    this.rod.position.set(0, -0.32, 0);
    this.rod.visible = false;
    this.arms[0].add(this.rod);

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
    this.sword.position.set(0, -0.32, 0);
    this.arms[0].add(this.sword);

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

  get x() { return this.body.position.x; }
  get z() { return this.body.position.z; }

  private sync() {
    this.group.position.set(this.body.position.x, this.body.position.y - RADIUS, this.body.position.z);
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
    const swing = 0.75 * moving + running * 0.25;
    this.legs[0].rotation.x = s * swing;
    this.legs[1].rotation.x = -s * swing;
    this.arms[0].rotation.x = -s * swing * 0.9;
    this.arms[1].rotation.x = s * swing * 0.9;
    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * moving;
    const breathe = Math.sin(t * 2.2) * 0.012 * (1 - moving);
    this.torso.position.y = 0.5 + bob + breathe;
    this.torso.rotation.x = 0.08 * moving + 0.12 * running;
    this.model.position.y = bob * 0.5;
    this.scarfTail.rotation.x = 0.3 + moving * 0.6 + Math.sin(t * 8) * 0.12 * moving;
    this.rod.visible = this.fishing;
    this.sword.visible = !this.fishing;
    this.clock = t;
    this.torso.rotation.y = 0;
    this.arms[0].rotation.z = -0.12;
    this.swing = null;
    if (this.attackT >= 0) this.animateAttack(dt);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.down) {
      this.downT = Math.min(1, this.downT + dt * 3);
      this.model.rotation.x = -this.downT * Math.PI / 2;
      this.model.position.y = 0.15 * this.downT;
    } else this.model.rotation.x = 0;
    if (this.fishing) {
      const swing = this.cast < 1 ? Math.sin(this.cast * Math.PI) * 1.4 : 0;
      this.arms[0].rotation.x = -1.25 + swing;
      this.arms[1].rotation.x = -0.6;
      this.legs[0].rotation.x = this.legs[1].rotation.x = 0;
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
    this.legs[0].rotation.x = 0.35;
    this.legs[1].rotation.x = -0.25;
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
