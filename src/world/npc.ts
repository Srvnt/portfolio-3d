import * as THREE from 'three';

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function bubbleTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd36a';
  g.strokeStyle = '#7a4a10';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 58, 46, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(52, 100);
  g.lineTo(64, 122);
  g.lineTo(76, 100);
  g.closePath();
  g.fill();
  g.fillStyle = '#3a2208';
  g.font = '800 64px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Npc {
  group = new THREE.Group();
  talked = false;
  private model = new THREE.Group();
  private head = new THREE.Group();
  private torso = new THREE.Group();
  private waveArm = new THREE.Group();
  private staffArm = new THREE.Group();
  private bubble: THREE.Sprite;
  private quiet = bubbleTexture('…');
  private gem: THREE.MeshStandardMaterial;
  private gemLight: THREE.PointLight;
  private yaw = 0;
  private waveT = -1;
  private greeted = false;

  constructor(x: number, z: number) {
    const skin = mat('#e9b98f');
    const robe = mat('#3f6b4a');
    const robeDark = mat('#2c4c35');
    const beard = mat('#f2efe8', { flatShading: true });
    const wood = mat('#6b4428');
    const belt = mat('#7a5230');
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, px = 0, py = 0, pz = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    part(new THREE.CylinderGeometry(0.26, 0.42, 0.95, 16), robe, this.model, 0, 0.48, 0);
    part(new THREE.CylinderGeometry(0.43, 0.43, 0.06, 16), robeDark, this.model, 0, 0.03, 0);
    for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.13, 0.08, 0.2), mat('#4a3020'), this.model, s * 0.12, 0.04, 0.2);

    this.torso.position.y = 0.95;
    this.model.add(this.torso);
    const chest = part(new THREE.CapsuleGeometry(0.22, 0.18, 4, 12), robe, this.torso, 0, 0.12, 0);
    chest.scale.z = 0.85;
    part(new THREE.CylinderGeometry(0.25, 0.26, 0.07, 14), belt, this.torso, 0, -0.04, 0);
    part(new THREE.SphereGeometry(0.05, 8, 6), mat('#f0c850', { metalness: 0.6, roughness: 0.3 }), this.torso, 0, -0.04, 0.25);
    const pouch = part(new THREE.BoxGeometry(0.12, 0.13, 0.08), mat('#8a5a32'), this.torso, 0.2, -0.1, 0.14);
    pouch.rotation.y = 0.5;

    this.head.position.y = 0.5;
    this.torso.add(this.head);
    part(new THREE.SphereGeometry(0.21, 18, 14), skin, this.head);
    part(new THREE.SphereGeometry(0.06, 10, 8), mat('#d9987a'), this.head, 0, -0.02, 0.2);
    for (const s of [-1, 1]) {
      const eye = part(new THREE.SphereGeometry(0.026, 8, 6), mat('#2b1e2f', { roughness: 0.2 }), this.head, s * 0.075, 0.04, 0.18);
      eye.scale.y = 0.8;
      const brow = part(new THREE.BoxGeometry(0.09, 0.03, 0.03), beard, this.head, s * 0.08, 0.1, 0.18);
      brow.rotation.z = s * -0.2;
    }
    const beardMesh = part(new THREE.ConeGeometry(0.17, 0.42, 10), beard, this.head, 0, -0.24, 0.1);
    beardMesh.rotation.x = Math.PI + 0.25;
    for (const s of [-1, 1]) {
      const mus = part(new THREE.CapsuleGeometry(0.03, 0.09, 3, 6), beard, this.head, s * 0.06, -0.06, 0.19);
      mus.rotation.z = s * 1.1;
    }
    const hood = part(new THREE.SphereGeometry(0.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), robeDark, this.head, 0, 0.03, -0.03);
    hood.rotation.x = -0.35;
    const tip = part(new THREE.ConeGeometry(0.12, 0.3, 10), robeDark, this.head, 0, 0.18, -0.22);
    tip.rotation.x = -1.2;

    for (const [arm, side] of [[this.staffArm, -1], [this.waveArm, 1]] as [THREE.Group, number][]) {
      arm.position.set(side * 0.28, 0.27, 0);
      part(new THREE.CapsuleGeometry(0.07, 0.24, 4, 8), robe, arm, 0, -0.16, 0);
      part(new THREE.SphereGeometry(0.06, 8, 6), skin, arm, 0, -0.34, 0);
      arm.rotation.z = side * 0.18;
      this.torso.add(arm);
    }
    this.staffArm.rotation.x = -0.35;

    const staff = new THREE.Group();
    staff.position.set(-0.36, 0, 0.18);
    part(new THREE.CylinderGeometry(0.03, 0.04, 1.85, 6), wood, staff, 0, 0.92, 0);
    const knot = part(new THREE.TorusGeometry(0.08, 0.025, 6, 12), wood, staff, 0, 1.88, 0);
    knot.rotation.y = Math.PI / 2;
    this.gem = new THREE.MeshStandardMaterial({ color: '#8fe6ff', emissive: '#3ac8ff', emissiveIntensity: 0.6, roughness: 0.35 });
    part(new THREE.OctahedronGeometry(0.07, 0), this.gem, staff, 0, 1.9, 0);
    this.gemLight = new THREE.PointLight('#5fd8ff', 0, 3.5, 1.6);
    this.gemLight.position.set(0, 1.95, 0);
    staff.add(this.gemLight);
    this.model.add(staff);

    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('!'), depthWrite: false }));
    this.bubble.scale.setScalar(0.5);
    this.bubble.position.y = 2.35;
    this.group.add(this.model, this.bubble);
    this.group.position.set(x, 0, z);
  }

  talk() {
    if (!this.talked) {
      this.talked = true;
      (this.bubble.material as THREE.SpriteMaterial).map = this.quiet;
    }
  }

  update(dt: number, t: number, heroX: number, heroZ: number, night: number) {
    const dx = heroX - this.group.position.x, dz = heroZ - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    const want = dist < 5.5 ? Math.atan2(dx, dz) : 0;
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 3);
    this.model.rotation.y = this.yaw;

    if (dist < 4 && !this.greeted) { this.greeted = true; this.waveT = 0; }
    if (dist > 8) this.greeted = false;

    this.torso.position.y = 0.95 + Math.sin(t * 1.8) * 0.012;
    this.torso.rotation.z = Math.sin(t * 0.9) * 0.03;
    this.head.rotation.x = Math.sin(t * 0.7) * 0.05 + (dist < 5.5 ? -0.08 : 0.05);
    this.head.rotation.y = Math.sin(t * 0.5) * 0.15 * (dist < 5.5 ? 0.3 : 1);

    if (this.waveT >= 0) {
      this.waveT += dt;
      const k = Math.min(1, this.waveT / 1.6);
      const up = Math.sin(Math.min(1, k * 1.4) * Math.PI);
      this.waveArm.rotation.x = -2.6 * up;
      this.waveArm.rotation.z = 0.18 + Math.sin(this.waveT * 14) * 0.35 * up;
      if (k >= 1) this.waveT = -1;
    } else {
      this.waveArm.rotation.x = Math.sin(t * 1.3) * 0.05;
      this.waveArm.rotation.z = 0.18;
    }

    this.bubble.position.y = 2.35 + Math.sin(t * 3) * 0.06;
    this.bubble.visible = dist > 1.2;
    this.gem.emissiveIntensity = 0.6 + night * 2.6 + Math.sin(t * 2.5) * 0.15;
    this.gemLight.intensity = night * 4;
  }
}
