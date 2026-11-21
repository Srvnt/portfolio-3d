import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Physics } from './physics';

const SPEED = 4.2;
const RUN = 7.4;
const RADIUS = 0.34;

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

/** A small adventurer built from primitives, animated procedurally. */
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

  constructor(x: number, z: number, physics: Physics) {
    const skin = mat('#f2c49b');
    const tunic = mat('#3f9a5c');
    const pants = mat('#465a92');
    const boots = mat('#5a3a24');
    const hair = mat('#d9663a', { flatShading: true });
    const scarf = mat('#e04848');

    const part = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // legs pivot at the hips
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
    // tunic skirt
    part(new THREE.CylinderGeometry(0.22, 0.27, 0.16, 14, 1, true), tunic, this.torso, 0, -0.04, 0);

    // arms pivot at the shoulders
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.27, 0.42, 0);
      part(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), tunic, pivot, 0, -0.15, 0);
      part(new THREE.SphereGeometry(0.065, 10, 8), skin, pivot, 0, -0.32, 0);
      pivot.rotation.z = side * 0.12;
      this.torso.add(pivot);
      this.arms.push(pivot);
    }

    // head
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
    // spiky fringe and tufts
    const spike = new THREE.ConeGeometry(0.07, 0.22, 5);
    const spikes: [number, number, number, number, number][] = [
      [-0.12, 0.17, 0.16, 0.9, 0.3], [0, 0.2, 0.18, 1.1, 0], [0.12, 0.17, 0.16, 0.9, -0.3],
      [0.05, 0.28, -0.05, -0.3, -0.2], [-0.1, 0.26, -0.12, -0.6, 0.4], [0.14, 0.2, -0.16, -0.9, -0.6],
    ];
    for (const [sx, sy, sz, rx, rz] of spikes) {
      const s = part(spike, hair, head, sx, sy, sz);
      s.rotation.set(rx, 0, rz);
    }
    // scarf
    part(new THREE.TorusGeometry(0.17, 0.05, 6, 14), scarf, this.torso, 0, 0.5, 0).rotation.x = Math.PI / 2;
    this.scarfTail = part(new THREE.BoxGeometry(0.1, 0.32, 0.04), scarf, this.torso, 0.08, 0.36, -0.18);
    this.scarfTail.geometry.translate(0, -0.14, 0);
    this.scarfTail.position.y = 0.5;

    this.group.add(this.model);

    // physics capsule approximated by a sphere
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

  /** Called before the physics step. */
  drive(input: { x: number; z: number; run: boolean }, dt: number) {
    let { x, z } = input;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    const target = (input.run ? RUN : SPEED);
    const vx = x * target;
    const vz = z * target;
    // smooth acceleration
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

  /** Called after the physics step: animate limbs from real velocity. */
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
    this.model.rotation.y = this.yaw;
  }

  face(x: number, z: number) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
    this.model.rotation.y = this.yaw;
  }
}
