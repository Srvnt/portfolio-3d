import * as THREE from 'three';
import { WorldMap } from '../world/map';
import { uniforms } from '../world/shared';

/** Glowing pollen / fireflies drifting over the whole valley (all motion in the shader). */
export function createMotes(map: WorldMap, count = 260): THREE.Points {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([Math.random() * map.W, 0.3 + Math.random() * 2.6, Math.random() * map.H], i * 3);
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: uniforms.uTime, uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.3 + aSeed) * 0.8;
        p.z += cos(uTime * 0.25 + aSeed * 1.3) * 0.8;
        p.y += sin(uTime * 0.6 + aSeed * 2.0) * 0.35;
        vA = 0.55 + 0.45 * sin(uTime * 2.0 + aSeed * 5.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.07 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.6, 1.5, 0.8) * a * vA, a * vA);
      }`,
  }));
  pts.frustumCulled = false;
  return pts;
}

/** Pooled puffs: chimney smoke and footstep dust. */
export class Puffs {
  group = new THREE.Group();
  private pool: { m: THREE.Mesh; life: number; max: number; vel: THREE.Vector3; grow: number }[] = [];
  private next = 0;

  constructor(count: number, color: string, opacity: number) {
    const geo = new THREE.IcosahedronGeometry(0.2, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, roughness: 1, flatShading: true }));
      m.visible = false;
      this.group.add(m);
      this.pool.push({ m, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 });
    }
  }

  emit(at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, grow: number) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.m.position.copy(at);
    p.m.scale.setScalar(size);
    p.m.visible = true;
    p.vel.copy(vel);
    p.life = 0;
    p.max = life;
    p.grow = grow;
    (p.m.material as THREE.MeshStandardMaterial).userData.base ??= (p.m.material as THREE.MeshStandardMaterial).opacity;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.m.visible = false; continue; }
      p.m.position.addScaledVector(p.vel, dt);
      p.m.scale.multiplyScalar(1 + p.grow * dt);
      const mat = p.m.material as THREE.MeshStandardMaterial;
      mat.opacity = (mat.userData.base as number) * (1 - k) * Math.min(1, k * 6);
    }
  }
}

/** Butterflies fluttering around flower patches. */
export class Butterflies {
  group = new THREE.Group();
  private flies: { g: THREE.Group; wings: THREE.Group[]; home: THREE.Vector3; seed: number }[] = [];

  constructor(map: WorldMap, count = 10) {
    const homes: THREE.Vector3[] = [];
    for (let z = 0; z < map.H; z++)
      for (let x = 0; x < map.W; x++) if (map.flowers[map.i(x, z)]) homes.push(new THREE.Vector3(x + 0.5, 0, z + 0.5));
    const colors = ['#ffd84a', '#ff8ac0', '#8fd0ff', '#ffffff', '#ffa040'];
    const wingGeo = new THREE.CircleGeometry(0.11, 6);
    wingGeo.translate(0.1, 0, 0);
    for (let i = 0; i < count && homes.length; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, emissive: colors[i % colors.length], emissiveIntensity: 0.25 });
      const wings = [-1, 1].map((s) => {
        const hinge = new THREE.Group();
        const w = new THREE.Mesh(wingGeo, mat);
        w.rotation.x = -Math.PI / 2;
        hinge.scale.x = s;
        hinge.add(w);
        g.add(hinge);
        return hinge;
      });
      const home = homes[Math.floor(Math.random() * homes.length)];
      this.group.add(g);
      this.flies.push({ g, wings, home, seed: Math.random() * 100 });
    }
  }

  update(t: number) {
    for (const f of this.flies) {
      const s = f.seed;
      const x = f.home.x + Math.sin(t * 0.5 + s) * 1.6 + Math.sin(t * 1.3 + s * 2) * 0.4;
      const z = f.home.z + Math.cos(t * 0.4 + s) * 1.6;
      const y = 0.6 + Math.sin(t * 1.7 + s) * 0.3;
      const prev = f.g.position.clone();
      f.g.position.set(x, y, z);
      f.g.rotation.y = Math.atan2(x - prev.x, z - prev.z);
      const flap = Math.sin(t * 22 + s) * 1.1;
      f.wings[0].rotation.z = flap;
      f.wings[1].rotation.z = flap;
    }
  }
}
