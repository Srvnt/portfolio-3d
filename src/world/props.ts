import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontJson from 'three/examples/fonts/gentilis_bold.typeface.json';
import { FOUNTAIN, LETTERS, Tile, WorldMap } from './map';
import { Physics } from '../physics';
import { canvasTexture, makeCanvas, standard, uniforms } from './shared';

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

/** Crates and barrels you can shove around. */
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

/** Your name in big 3D letters that can be knocked over. */
export function createLetters(text: string, physics: Physics): THREE.Group {
  const group = new THREE.Group();
  const font = new FontLoader().parse(fontJson as never);
  const mat = new THREE.MeshStandardMaterial({ color: '#fff3d6', roughness: 0.45 });
  const size = 1.35;
  const gap = 0.14;
  const geos = [...text].map((ch) => {
    if (ch === ' ') return null;
    const g = new TextGeometry(ch, { font, size, depth: 0.42, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
    g.computeBoundingBox();
    g.center();
    return g;
  });
  const widths = geos.map((g) => (g ? g.boundingBox!.max.x - g.boundingBox!.min.x : size * 0.4));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  const scale = Math.min(1, LETTERS.maxWidth / total);
  let x = LETTERS.x - (total * scale) / 2;
  geos.forEach((g, i) => {
    const w = widths[i] * scale;
    if (g) {
      g.scale(scale, scale, scale);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const half = new THREE.Vector3().subVectors(bb.max, bb.min).multiplyScalar(0.5);
      const mesh = shadowed(new THREE.Mesh(g, mat));
      mesh.position.set(x + w / 2, half.y + 0.02, LETTERS.z);
      group.add(mesh);
      physics.dynamic(mesh, new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)), 2.2);
    }
    x += w + gap * scale;
  });
  return group;
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

  const waterMat = new THREE.MeshStandardMaterial({ color: '#4cc0d8', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, emissive: '#0a3a48' });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.14, 32), waterMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.46;
  g.add(pool);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.52, 20), waterMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 1.33;
  g.add(top);

  // spray particles computed in the shader
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
    vertexShader: /* glsl */ `
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
    fragmentShader: /* glsl */ `
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

/** A wooden bridge over every bridge-tile run. */
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
        // only build once per bridge (rows are merged)
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
