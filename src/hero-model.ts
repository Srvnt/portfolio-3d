import * as THREE from 'three';

export interface Limb { upper: THREE.Group; lower: THREE.Group; end: THREE.Group }

export interface HeroRig {
  root: THREE.Group;
  torso: THREE.Group;
  chest: THREE.Object3D;
  head: THREE.Group;
  hair: THREE.Group;
  eyes: THREE.Object3D[];
  arms: Limb[];
  legs: Limb[];
  scarf: THREE.Group[];
}

const RIM = new THREE.Color('#ffe9c4');

function withRim(m: THREE.MeshStandardMaterial, strength = 0.35) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += vec3(${RIM.r.toFixed(3)}, ${RIM.g.toFixed(3)}, ${RIM.b.toFixed(3)}) * pow(rimF, 3.0) * ${strength.toFixed(2)};`,
    );
  };
  m.customProgramCacheKey = () => `hero-rim-${strength}`;
  return m;
}

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}, rim = 0.35) =>
  withRim(new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra }), rim);

function lathe(points: [number, number][], segments = 24) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function lockGeometry(len: number, radius: number, bend: number, twist = 0) {
  const g = new THREE.ConeGeometry(radius, len, 10, 6);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / len;
    p.setZ(i, p.getZ(i) + bend * t * t * len);
    p.setX(i, p.getX(i) + twist * t * t * len);
  }
  g.computeVertexNormals();
  return g;
}

export function buildHeroRig(): HeroRig {
  const skin = mat('#f3c7a0', { roughness: 0.65 }, 0.25);
  const skinShade = mat('#e3a98a', { roughness: 0.7 }, 0.2);
  const tunic = mat('#3f9a5c', { roughness: 0.8 });
  const tunicDark = mat('#2c7445', { roughness: 0.85 });
  const trim = mat('#e8c46a', { roughness: 0.45, metalness: 0.3 });
  const shirt = mat('#f3ecdc', { roughness: 0.85 });
  const pants = mat('#3e4f86', { roughness: 0.85 });
  const leather = mat('#6a4128', { roughness: 0.6 });
  const leatherLight = mat('#8a5a36', { roughness: 0.55 });
  const hairMat = mat('#3a2416', { roughness: 0.5 }, 0.45);
  const hairHi = mat('#5a3a24', { roughness: 0.45 }, 0.45);
  const scarfMat = mat('#d9443c', { roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
  const iris = new THREE.MeshStandardMaterial({ color: '#3d6fae', roughness: 0.25 });
  const pupil = new THREE.MeshStandardMaterial({ color: '#141018', roughness: 0.2 });
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const browMat = new THREE.MeshStandardMaterial({ color: '#2e1c12', roughness: 0.6 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: '#a8463e', roughness: 0.5 });

  const part = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    parent.add(mesh);
    return mesh;
  };

  const root = new THREE.Group();

  const legs: Limb[] = [];
  for (const side of [-1, 1]) {
    const upper = new THREE.Group();
    upper.position.set(side * 0.1, 0.48, 0);
    part(new THREE.CapsuleGeometry(0.078, 0.12, 6, 12), pants, upper, 0, -0.1, 0);
    const lower = new THREE.Group();
    lower.position.y = -0.2;
    upper.add(lower);
    part(new THREE.CapsuleGeometry(0.066, 0.1, 6, 12), pants, lower, 0, -0.07, 0);
    part(lathe([[0, 0], [0.072, 0], [0.076, 0.05], [0.074, 0.13], [0.086, 0.15], [0.084, 0.175], [0, 0.175]], 16), leather, lower, 0, -0.205, 0);
    const end = new THREE.Group();
    end.position.y = -0.2;
    lower.add(end);
    const foot = part(new THREE.SphereGeometry(0.08, 18, 12), leather, end, 0, -0.035, 0.04);
    foot.scale.set(0.95, 0.6, 1.55);
    const sole = part(new THREE.CylinderGeometry(0.075, 0.078, 0.025, 18), leatherLight, end, 0, -0.075, 0.04);
    sole.scale.z = 1.5;
    root.add(upper);
    legs.push({ upper, lower, end });
  }

  const torso = new THREE.Group();
  torso.position.y = 0.5;
  root.add(torso);
  const skirt = part(lathe([[0.17, 0.08], [0.2, 0.02], [0.25, -0.08], [0.27, -0.12], [0.255, -0.13], [0, -0.13]], 28), tunic, torso);
  skirt.scale.z = 0.88;
  const hem = part(new THREE.TorusGeometry(0.262, 0.012, 6, 32), trim, torso, 0, -0.125, 0);
  hem.rotation.x = Math.PI / 2;
  hem.scale.y = 0.88;
  const chest = part(lathe([[0, 0], [0.185, 0], [0.2, 0.08], [0.215, 0.2], [0.2, 0.3], [0.13, 0.36], [0, 0.37]], 28), tunic, torso, 0, 0.04, 0);
  chest.scale.z = 0.82;
  const placket = part(new THREE.BoxGeometry(0.035, 0.24, 0.02), tunicDark, torso, 0, 0.22, 0.17);
  placket.rotation.x = -0.12;
  for (let i = 0; i < 3; i++) part(new THREE.SphereGeometry(0.012, 8, 6), trim, torso, 0, 0.14 + i * 0.07, 0.182 - i * 0.008);
  const belt = part(new THREE.TorusGeometry(0.205, 0.028, 8, 32), leather, torso, 0, 0.06, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.84;
  part(new THREE.BoxGeometry(0.075, 0.06, 0.025), trim, torso, 0, 0.06, 0.178);
  part(new THREE.BoxGeometry(0.04, 0.028, 0.03), leather, torso, 0, 0.06, 0.18);
  const pouch = part(new THREE.BoxGeometry(0.09, 0.1, 0.06), leatherLight, torso, 0.19, 0.0, 0.07);
  pouch.rotation.y = 0.9;
  const pauldron = part(new THREE.SphereGeometry(0.095, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), leather, torso, 0.235, 0.33, 0);
  pauldron.rotation.z = -0.5;
  const collar = part(lathe([[0.1, 0], [0.12, 0.03], [0.115, 0.06], [0.09, 0.06]], 20), shirt, torso, 0, 0.36, 0.005);
  collar.scale.z = 0.9;
  part(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 14), skin, torso, 0, 0.42, 0);

  const arms: Limb[] = [];
  for (const side of [-1, 1]) {
    const upper = new THREE.Group();
    upper.position.set(side * 0.235, 0.31, 0);
    upper.rotation.z = side * 0.1;
    part(new THREE.SphereGeometry(0.068, 14, 10), tunic, upper, 0, -0.01, 0);
    part(new THREE.CapsuleGeometry(0.056, 0.08, 6, 12), tunic, upper, 0, -0.08, 0);
    const cuff = part(new THREE.TorusGeometry(0.056, 0.012, 6, 16), trim, upper, 0, -0.14, 0);
    cuff.rotation.x = Math.PI / 2;
    const lower = new THREE.Group();
    lower.position.y = -0.16;
    upper.add(lower);
    part(new THREE.CapsuleGeometry(0.046, 0.07, 6, 12), skin, lower, 0, -0.05, 0);
    part(lathe([[0.05, 0], [0.056, 0.02], [0.054, 0.08], [0.048, 0.1]], 14), leatherLight, lower, 0, -0.13, 0);
    const end = new THREE.Group();
    end.position.y = -0.17;
    lower.add(end);
    const hand = part(new THREE.SphereGeometry(0.05, 14, 10), leather, end, 0, -0.01, 0.005);
    hand.scale.set(0.9, 1.05, 0.8);
    const thumb = part(new THREE.CapsuleGeometry(0.016, 0.03, 4, 8), leather, end, side * -0.035, 0.0, 0.03);
    thumb.rotation.z = side * 0.6;
    torso.add(upper);
    arms.push({ upper, lower, end });
  }

  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);
  const skull = part(new THREE.SphereGeometry(0.245, 36, 28), skin, head);
  skull.scale.set(1, 0.97, 0.96);
  const jaw = part(new THREE.SphereGeometry(0.17, 24, 16), skin, head, 0, -0.09, 0.04);
  jaw.scale.set(1, 0.8, 0.95);
  for (const s of [-1, 1]) {
    const ear = part(new THREE.SphereGeometry(0.05, 12, 10), skin, head, s * 0.235, -0.01, -0.01);
    ear.scale.set(0.45, 0.9, 0.7);
  }
  part(new THREE.SphereGeometry(0.022, 10, 8), skinShade, head, 0, -0.05, 0.228, false);
  const mouth = part(new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI * 0.8), mouthMat, head, 0, -0.09, 0.212, false);
  mouth.rotation.z = Math.PI + Math.PI * 0.1;

  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.085, -0.005, 0.2);
    eye.rotation.y = s * 0.28;
    head.add(eye);
    const sclera = part(new THREE.SphereGeometry(0.046, 18, 14), white, eye, 0, 0, 0, false);
    sclera.scale.set(0.95, 1.22, 0.55);
    const ir = part(new THREE.SphereGeometry(0.033, 16, 12), iris, eye, 0, -0.004, 0.018, false);
    ir.scale.set(1, 1.18, 0.5);
    const pu = part(new THREE.SphereGeometry(0.018, 12, 10), pupil, eye, 0, -0.004, 0.028, false);
    pu.scale.set(1, 1.15, 0.5);
    part(new THREE.SphereGeometry(0.009, 8, 6), shine, eye, 0.012, 0.017, 0.034, false);
    part(new THREE.SphereGeometry(0.005, 6, 4), shine, eye, -0.012, -0.018, 0.033, false);
    const lid = part(new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat, eye, 0, 0.004, -0.004, false);
    lid.scale.set(1.0, 1.0, 0.6);
    lid.rotation.x = -0.25;
    eyes.push(eye);
    const brow = part(new THREE.CapsuleGeometry(0.009, 0.05, 4, 8), browMat, head, s * 0.09, 0.08, 0.214, false);
    brow.rotation.z = Math.PI / 2 + s * 0.18;
    const blush = part(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: '#f29a8a', transparent: true, opacity: 0.35 }), head, s * 0.14, -0.065, 0.2, false);
    blush.rotation.y = s * 0.55;
  }

  const hair = new THREE.Group();
  head.add(hair);
  const cap = part(new THREE.SphereGeometry(0.262, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat, hair, 0, 0.015, -0.015);
  cap.rotation.x = -0.22;
  const back = part(new THREE.SphereGeometry(0.255, 28, 16, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.35), hairMat, hair, 0, 0.01, -0.03);
  back.rotation.x = 0.55;
  const locks: [number, number, number, number, number, number, number, number, boolean][] = [
    [-0.13, 0.17, 0.15, -0.35, -0.55, 0.75, 0.2, 0.06, false],
    [-0.04, 0.2, 0.16, -0.1, -0.5, 0.85, 0.22, 0.065, true],
    [0.06, 0.2, 0.16, 0.15, -0.45, 0.85, 0.21, 0.065, false],
    [0.15, 0.16, 0.13, 0.45, -0.55, 0.7, 0.19, 0.058, true],
    [-0.22, 0.08, 0.06, -0.4, -0.9, 0.15, 0.2, 0.055, false],
    [0.22, 0.08, 0.06, 0.4, -0.9, 0.15, 0.2, 0.055, false],
    [-0.2, 0.02, -0.08, -0.25, -0.95, -0.2, 0.2, 0.055, true],
    [0.2, 0.02, -0.08, 0.25, -0.95, -0.2, 0.2, 0.055, true],
    [0.0, 0.25, -0.02, 0.05, 0.8, -0.6, 0.17, 0.058, true],
    [-0.08, 0.23, -0.1, -0.3, 0.7, -0.65, 0.16, 0.055, false],
    [0.09, 0.22, -0.11, 0.35, 0.65, -0.65, 0.16, 0.055, false],
    [-0.11, 0.08, -0.21, -0.2, -0.6, -0.75, 0.2, 0.06, false],
    [0.11, 0.08, -0.21, 0.2, -0.6, -0.75, 0.2, 0.06, false],
    [0.0, 0.06, -0.24, 0.0, -0.65, -0.75, 0.22, 0.065, true],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  locks.forEach(([x, y, z, dx, dy, dz, len, r, hi], i) => {
    const lock = part(lockGeometry(len, r, i % 2 ? 0.35 : 0.25, i % 3 === 0 ? 0.12 : -0.08), hi ? hairHi : hairMat, hair, x, y, z);
    lock.quaternion.setFromUnitVectors(up, new THREE.Vector3(dx, dy, dz).normalize());
  });

  const neckScarf = part(new THREE.TorusGeometry(0.115, 0.042, 10, 28), scarfMat, torso, 0, 0.39, 0);
  neckScarf.rotation.x = Math.PI / 2;
  neckScarf.scale.y = 0.9;
  part(new THREE.SphereGeometry(0.045, 12, 10), scarfMat, torso, 0.07, 0.37, -0.1);
  const scarf: THREE.Group[] = [];
  let parent: THREE.Object3D = torso;
  let pos = new THREE.Vector3(0.07, 0.36, -0.12);
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.copy(pos);
    parent.add(seg);
    const w = 0.1 - i * 0.012;
    const piece = part(new THREE.CapsuleGeometry(0.02, 0.1, 4, 10), scarfMat, seg, 0, -0.065, 0);
    piece.scale.set(w / 0.04, 1, 0.55);
    scarf.push(seg);
    parent = seg;
    pos = new THREE.Vector3(0, -0.13, 0);
  }

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = false; });
  return { root, torso, chest, head, hair, eyes, arms, legs, scarf };
}
