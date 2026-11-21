import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontJson from 'three/examples/fonts/gentilis_bold.typeface.json';
import { FOUNTAIN, GATE, Tile, WorldMap } from './map';
import { Physics } from '../physics';
import { canvasTexture, makeCanvas, standard, uniforms } from './shared';
import { roofGeometry, shingleTexture } from './buildings';
import { leafTexture } from './nature';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
  return o;
};

function woodTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#b57a42';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#a86f3a' : '#bf8650';
    ctx.fillRect(14, 14 + i * 25, 100, 24);
    ctx.fillStyle = 'rgba(80,45,20,0.25)';
    for (let k = 0; k < 6; k++) ctx.fillRect(14 + Math.random() * 100, 18 + i * 25 + Math.random() * 16, 18, 1.5);
  }
  ctx.strokeStyle = '#6b4428';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, 114, 114);
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(118, 118); ctx.stroke();
  return canvasTexture(canvas);
}

export function createPushables(map: WorldMap, physics: Physics): THREE.Group {
  const group = new THREE.Group();
  const crateMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
  const barrelMat = standard({ color: '#9a6236', flatShading: false });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#59606b', metalness: 0.6, roughness: 0.45 });
  for (const spot of map.crateSpots) {
    if (spot.kind === 'crate') {
      const s = 0.55;
      const crate = shadowed(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat));
      crate.position.set(spot.x, s / 2 + 0.01, spot.z);
      crate.rotation.y = (spot.x * 7) % 1;
      group.add(crate);
      physics.dynamic(crate, new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)), 1.2);
    } else {
      const barrel = new THREE.Group();
      barrel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.7, 14), barrelMat));
      const bulge = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.36, 14), barrelMat);
      barrel.add(bulge);
      for (const y of [-0.24, 0.24]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.022, 4, 18), bandMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = y;
        barrel.add(band);
      }
      shadowed(barrel);
      barrel.position.set(spot.x, 0.36, spot.z);
      group.add(barrel);
      physics.dynamic(barrel, new CANNON.Cylinder(0.29, 0.29, 0.7, 10), 1.6);
    }
  }
  return group;
}

export function createGate(text: string, physics: Physics) {
  const g = new THREE.Group();
  const { x: cx, z: cz, span } = GATE;
  const stone = standard({ color: '#b5ad9c' });
  const timber = standard({ color: '#7a4c2a', flatShading: false, roughness: 0.75 });
  const timberDark = standard({ color: '#563219', flatShading: false });
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', metalness: 0.5, roughness: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ color: '#ffd36a', metalness: 0.45, roughness: 0.28, emissive: '#8a5600', emissiveIntensity: 0.45 });
  const glow = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffb84a', emissiveIntensity: 0.2, roughness: 0.3 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const POST_TOP = 3.6;
  const BEAM_Y = 3.45;

  for (const side of [-1, 1]) {
    const x = side * span / 2;
    add(new THREE.BoxGeometry(0.78, 0.5, 0.78), stone, x, 0.25, 0);
    add(new THREE.BoxGeometry(0.62, 0.1, 0.62), stone, x, 0.55, 0);
    add(new THREE.BoxGeometry(0.36, POST_TOP - 0.5, 0.36), timber, x, 0.5 + (POST_TOP - 0.5) / 2, 0);
    for (const y of [0.85, POST_TOP - 0.45]) add(new THREE.BoxGeometry(0.4, 0.07, 0.4), iron, x, y, 0);
    const brace = add(new THREE.BoxGeometry(0.12, 0.85, 0.16), timberDark, x - side * 0.34, BEAM_Y - 0.42, 0);
    brace.rotation.z = side * 0.75;
    physics.cylinder(cx + x, cz, 0.42, 1.6);
  }
  add(new THREE.BoxGeometry(span + 1.3, 0.3, 0.42), timber, 0, BEAM_Y, 0);
  for (const side of [-1, 1]) {
    const end = add(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 12, 1, false, 0, Math.PI), timber, side * (span / 2 + 0.65), BEAM_Y, 0);
    end.rotation.set(Math.PI / 2, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2);
  }

  const roof = new THREE.Mesh(roofGeometry(span + 0.7, 0.6, POST_TOP + 0.02, 0.7, 0.3), [
    new THREE.MeshStandardMaterial({ map: shingleTexture('#c4573a'), roughness: 0.8, flatShading: true }),
    timberDark,
  ]);
  g.add(roof);
  const ridge = add(new THREE.CylinderGeometry(0.08, 0.08, span + 1.4, 8), standard({ color: '#8a3424' }), 0, POST_TOP + 0.74, 0);
  ridge.rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.11, 12, 8), gold, side * (span / 2 + 0.7), POST_TOP + 0.76, 0);

  const sign = new THREE.Group();
  sign.position.set(0, POST_TOP + 0.98, 0.78);
  sign.rotation.x = -0.72;
  g.add(sign);
  const boardW = span - 0.55, boardH = 0.92;
  const shape = new THREE.Shape();
  const r = 0.16;
  shape.moveTo(-boardW / 2 + r, -boardH);
  shape.lineTo(boardW / 2 - r, -boardH);
  shape.quadraticCurveTo(boardW / 2, -boardH, boardW / 2, -boardH + r);
  shape.lineTo(boardW / 2, -r);
  shape.quadraticCurveTo(boardW / 2, 0, boardW / 2 - r, 0);
  shape.lineTo(-boardW / 2 + r, 0);
  shape.quadraticCurveTo(-boardW / 2, 0, -boardW / 2, -r);
  shape.lineTo(-boardW / 2, -boardH + r);
  shape.quadraticCurveTo(-boardW / 2, -boardH, -boardW / 2 + r, -boardH);
  const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 3 });
  boardGeo.translate(0, 0, -0.04);
  add(boardGeo, standard({ color: '#22357a', flatShading: false, roughness: 0.55 }), 0, 0, 0, sign);
  const frame = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shape.getPoints(10).map((p) => new THREE.Vector3(p.x * 0.95, (p.y + boardH / 2) * 0.88 - boardH / 2, 0))), 64, 0.022, 5, true);
  add(frame, gold, 0, 0, 0.075, sign);
  const font = new FontLoader().parse(fontJson as never);
  const textGeo = new TextGeometry(text, { font, size: 0.4, depth: 0.04, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  textGeo.computeBoundingBox();
  const bb = textGeo.boundingBox!;
  const tw = bb.max.x - bb.min.x, th = bb.max.y - bb.min.y;
  const fit = Math.min(1, (boardW - 0.6) / tw);
  textGeo.translate(-(bb.min.x + tw / 2), -(bb.min.y + th / 2), 0);
  textGeo.scale(fit, fit, 1);
  add(textGeo, gold, 0, -boardH / 2, 0.07, sign);
  for (const side of [-1, 1]) {
    const star = add(new THREE.OctahedronGeometry(0.07, 0), gold, side * (boardW / 2 - 0.22), -boardH / 2, 0.08, sign);
    star.scale.z = 0.4;
  }
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.06, 0.5), iron, side * (boardW / 2 - 0.35), -boardH + 0.05, -0.25, sign);

  for (const side of [-1, 1]) {
    const lx = side * (span / 2 + 0.55);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 4), iron, lx, BEAM_Y - 0.3, 0.05);
    add(new THREE.ConeGeometry(0.16, 0.12, 6), iron, lx, BEAM_Y - 0.48, 0.05);
    add(new THREE.CylinderGeometry(0.11, 0.09, 0.26, 6), glow, lx, BEAM_Y - 0.66, 0.05);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 6), iron, lx, BEAM_Y - 0.8, 0.05);
  }

  const pennant = new THREE.Shape();
  pennant.moveTo(-0.17, 0);
  pennant.lineTo(0.17, 0);
  pennant.lineTo(0.17, -1.15);
  pennant.lineTo(0, -0.95);
  pennant.lineTo(-0.17, -1.15);
  pennant.closePath();
  const pennantGeo = new THREE.ShapeGeometry(pennant);
  const banners: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const b = new THREE.Group();
    b.position.set(side * span / 2, BEAM_Y - 0.5, 0.2);
    add(pennantGeo, new THREE.MeshStandardMaterial({ color: side < 0 ? '#3d66c4' : '#c4473a', side: THREE.DoubleSide, roughness: 0.85 }), 0, 0, 0, b);
    add(new THREE.CircleGeometry(0.09, 16), gold, 0, -0.42, 0.005, b);
    add(new THREE.BoxGeometry(0.42, 0.04, 0.04), iron, 0, 0.01, 0, b);
    g.add(b);
    banners.push(b);
  }

  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true });
  const leaves: THREE.BufferGeometry[] = [];
  const dark = new THREE.Color('#1f5226'), light = new THREE.Color('#7cbc4c'), c = new THREE.Color();
  for (const side of [-1, 1])
    for (let i = 0; i < 46; i++) {
      const k = i / 46;
      const y = 0.55 + Math.pow(k, 1.4) * 2.6;
      const a = k * 9 + side + Math.random() * 0.8;
      const pos = new THREE.Vector3(side * span / 2 + Math.cos(a) * 0.24, y, Math.sin(a) * 0.24);
      const out = new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)).normalize();
      const leaf = new THREE.PlaneGeometry(0.34 - k * 0.12, 0.34 - k * 0.12);
      leaf.applyMatrix4(new THREE.Matrix4().lookAt(out, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.random() * 6.28)).setPosition(pos));
      c.copy(dark).lerp(light, 0.3 + Math.random() * 0.6);
      const n = new Float32Array(12), col = new Float32Array(12);
      for (let v = 0; v < 4; v++) { n.set([out.x, out.y, out.z], v * 3); col.set([c.r, c.g, c.b], v * 3); }
      leaf.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      leaf.setAttribute('color', new THREE.BufferAttribute(col, 3));
      leaves.push(leaf);
    }
  g.add(new THREE.Mesh(mergeGeometries(leaves)!, leafMat));

  const flowerCols = ['#ff7aa8', '#ffe066', '#ffffff', '#b99cff'];
  for (const side of [-1, 1]) {
    const fx = side * span / 2;
    add(new THREE.BoxGeometry(0.7, 0.22, 0.26), timberDark, fx, 0.11, 0.55);
    for (let k = 0; k < 9; k++) {
      const f = add(new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.03, 1), standard({ color: flowerCols[k % 4], flatShading: false }), fx + (Math.random() - 0.5) * 0.6, 0.28 + Math.random() * 0.08, 0.55 + (Math.random() - 0.5) * 0.16);
      f.scale.y = 0.8;
    }
  }

  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  g.position.set(cx, 0, cz);
  return {
    group: g,
    setNight(n: number, t: number) { glow.emissiveIntensity = 0.2 + n * 3.4 * (1 + Math.sin(t * 9) * 0.03); },
    animate(t: number, wind: number) {
      banners.forEach((b, i) => { b.rotation.x = Math.sin(t * (1.5 + wind * 3) + i) * (0.05 + wind * 0.22) - wind * 0.12; });
      sign.rotation.z = Math.sin(t * (1.1 + wind * 2)) * (0.006 + wind * 0.03);
    },
  };
}

export function createSign(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const wood = standard({ color: '#9a6a3a' });
  const dark = standard({ color: '#6b4428' });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 6), dark);
  post.position.y = 0.7;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.08), wood);
  board.position.set(0, 1.2, 0.05);
  board.rotation.z = 0.04;
  g.add(post, board);
  for (const [y, w] of [[1.3, 0.7], [1.18, 0.55], [1.07, 0.65]]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.02), dark);
    line.position.set(0, y, 0.1);
    g.add(line);
  }
  g.position.set(x, 0, z);
  return shadowed(g);
}

export class Chest {
  group = new THREE.Group();
  opened = false;
  private lid = new THREE.Group();
  private lidAngle = 0;
  private light: THREE.PointLight;
  private glow: THREE.Mesh;

  constructor(x: number, z: number) {
    const wood = standard({ color: '#9a5a2a' });
    const gold = new THREE.MeshStandardMaterial({ color: '#f0c040', metalness: 0.8, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.5), wood);
    body.position.y = 0.21;
    this.group.add(body);
    for (const bx of [-0.26, 0.26]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.52), gold);
      band.position.set(bx, 0.21, 0);
      this.group.add(band);
    }
    const lidGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.75, 14, 1, false, 0, Math.PI);
    lidGeo.rotateZ(Math.PI / 2);
    const lidMesh = new THREE.Mesh(lidGeo, wood);
    lidMesh.position.set(0, 0, 0.25);
    this.lid.add(lidMesh);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), gold);
    lock.position.set(0, -0.02, 0.51);
    this.lid.add(lock);
    this.lid.position.set(0, 0.42, -0.25);
    this.group.add(this.lid);
    shadowed(this.group);

    this.glow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), new THREE.MeshBasicMaterial({ color: '#fff0a0' }));
    this.glow.position.y = 0.41;
    this.glow.visible = false;
    this.group.add(this.glow);
    this.light = new THREE.PointLight('#ffd36b', 0, 4, 1.5);
    this.light.position.y = 0.9;
    this.group.add(this.light);
    this.group.position.set(x, 0, z);
  }

  open() {
    this.opened = true;
    this.glow.visible = true;
  }

  update(dt: number, t: number) {
    const target = this.opened ? -1.9 : Math.sin(t * 3) * 0.02 - 0.02;
    this.lidAngle += (target - this.lidAngle) * (1 - Math.exp(-dt * 6));
    this.lid.rotation.x = this.lidAngle;
    this.light.intensity = this.opened ? 3 + Math.sin(t * 6) * 0.6 : 0;
    (this.glow.material as THREE.MeshBasicMaterial).color.setScalar(this.opened ? 2.5 : 1);
  }
}

export function createFountain() {
  const g = new THREE.Group();
  const stone = standard({ color: '#c9c1b0', flatShading: false });
  const profile = [
    [0, 0], [1.3, 0], [1.35, 0.1], [1.35, 0.55], [1.22, 0.6], [1.15, 0.5], [1.1, 0.18], [0, 0.18],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const basin = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), stone);
  g.add(basin);
  const column = new THREE.Mesh(new THREE.LatheGeometry([
    [0, 0.1], [0.22, 0.1], [0.16, 0.6], [0.14, 1.1], [0.55, 1.25], [0.6, 1.35], [0.5, 1.38], [0.12, 1.3], [0.1, 1.6], [0.14, 1.7], [0, 1.72],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 20), stone);
  g.add(column);
  shadowed(g);

  const waterMat = new THREE.MeshStandardMaterial({ color: '#4cc0d8', roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85, emissive: '#0a3a48' });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.14, 32), waterMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.46;
  g.add(pool);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.52, 20), waterMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 1.33;
  g.add(top);

  const N = 160;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) seeds.set([Math.random(), Math.random() * Math.PI * 2, 0.6 + Math.random() * 0.6], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const spray = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: uniforms.uTime, uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: `
      attribute vec3 aSeed; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        float t = fract(uTime * 0.7 * aSeed.z + aSeed.x);
        float r = 0.08 + t * 0.62;
        vec3 p = vec3(cos(aSeed.y) * r, 1.72 + t * 1.1 - t * t * 2.3, sin(aSeed.y) * r);
        vA = 1.0 - t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.05 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(1.4, 1.6, 1.7), vA * 0.85);
      }`,
  }));
  spray.frustumCulled = false;
  g.add(spray);
  g.position.set(FOUNTAIN.x, 0, FOUNTAIN.z);
  return g;
}

export function createBridges(map: WorldMap): THREE.Group {
  const g = new THREE.Group();
  const plank = standard({ color: '#a8743f' });
  const dark = standard({ color: '#6b4428' });
  for (let z = 0; z < map.H; z++) {
    let x0 = -1;
    for (let x = 0; x <= map.W; x++) {
      const b = x < map.W && map.tile(x, z) === Tile.Bridge;
      if (b && x0 < 0) x0 = x;
      if (!b && x0 >= 0) {
        if (map.tile(x0, z - 1) !== Tile.Bridge) {
          let z1 = z;
          while (map.tile(x0, z1 + 1) === Tile.Bridge) z1++;
          const len = x - x0 + 0.8;
          const depth = z1 - z + 1;
          for (let px = 0; px < len; px += 0.28) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, depth + 0.1), plank);
            p.position.set(x0 - 0.4 + px + 0.14, 0.06 + Math.sin((px / len) * Math.PI) * 0.12, z + depth / 2);
            p.rotation.z = Math.cos((px / len) * Math.PI) * -0.12;
            g.add(p);
          }
          for (const rz of [z + 0.05, z1 + 0.95]) {
            for (let px = 0; px <= len; px += len / 4) {
              const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), dark);
              post.position.set(x0 - 0.4 + px, 0.35 + Math.sin((px / len) * Math.PI) * 0.12, rz);
              g.add(post);
            }
            const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.08, 0.1), dark);
            rail.position.set(x0 - 0.4 + len / 2, 0.66, rz);
            g.add(rail);
          }
        }
        x0 = -1;
      }
    }
  }
  return shadowed(g);
}

export function createLanterns(physics: Physics, withLights: number) {
  const spots: [number, number][] = [[17.5, 21.6], [26.5, 21.6], [17.5, 13.5], [26.5, 13.5], [12.5, 16.3], [30.5, 16.3], [20.3, 25.5], [23.7, 25.5]];
  const group = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', roughness: 0.5, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffb84a', emissiveIntensity: 0.2, roughness: 0.3 });
  const lights: THREE.PointLight[] = [];
  spots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.1, 8), iron);
    post.position.y = 1.05;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.15, 8), iron);
    base.position.y = 0.07;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.04), iron);
    arm.position.set(0.17, 2.0, 0);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.26, 6, 1, true), iron);
    cage.position.set(0.36, 1.83, 0);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.22, 6), glow);
    lamp.position.copy(cage.position);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 6), iron);
    cap.position.set(0.36, 2.02, 0);
    g.add(post, base, arm, cage, lamp, cap);
    g.traverse((o) => (o.castShadow = o !== lamp));
    if (i < withLights) {
      const l = new THREE.PointLight('#ffb35a', 0, 7, 1.6);
      l.position.set(0.36, 1.75, 0);
      g.add(l);
      lights.push(l);
    }
    g.position.set(x, 0, z);
    g.rotation.y = (i % 2 ? Math.PI : 0) + (z > 20 ? Math.PI / 2 : 0);
    group.add(g);
    physics.cylinder(x, z, 0.14, 1.1);
  });
  return {
    group,
    setNight(n: number, t: number) {
      const flicker = 1 + Math.sin(t * 11) * 0.03 + Math.sin(t * 23) * 0.02;
      glow.emissiveIntensity = 0.2 + n * 3.4 * flicker;
      for (const l of lights) l.intensity = n * 9 * flicker;
    },
  };
}
