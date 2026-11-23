import * as THREE from 'three';
import { WorldMap } from '../world/map';
import { uniforms } from '../world/shared';

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
    uniforms: { uTime: uniforms.uTime, uNight: uniforms.uNight, uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: `
      attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uNight; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.3 + aSeed) * 0.8;
        p.z += cos(uTime * 0.25 + aSeed * 1.3) * 0.8;
        p.y += sin(uTime * 0.6 + aSeed * 2.0) * 0.35;
        vA = (0.55 + 0.45 * sin(uTime * (2.0 + uNight * 2.0) + aSeed * 5.0)) * (0.6 + uNight * 1.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.07 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
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

export function createFallingLeaves(map: WorldMap, count = 220): THREE.Points {
  const trees = map.props.filter((p) => p.kind === 'tree' && p.inside);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 2);
  const color = new Float32Array(count * 3);
  const palette = ['#9fd860', '#c6e27a', '#e8c65a', '#ffb3cf'].map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const t = trees[Math.floor(Math.random() * trees.length)];
    pos.set([t.x + (Math.random() - 0.5) * 1.6, 0, t.z + (Math.random() - 0.5) * 1.6], i * 3);
    seed.set([Math.random(), 0.06 + Math.random() * 0.08], i * 2);
    const c = palette[t.v === 3 && Math.random() < 0.8 ? 3 : Math.floor(Math.random() * 3)];
    color.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: uniforms.uTime, uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: `
      attribute vec2 aSeed; attribute vec3 aColor;
      uniform float uTime; uniform float uScale;
      varying float vA; varying float vRot; varying vec3 vColor;
      void main(){
        float t = fract(uTime * aSeed.y + aSeed.x);
        vec3 p = position;
        p.y = 2.8 * (1.0 - t) + 0.05;
        p.x += sin(t * 9.0 + aSeed.x * 20.0) * 0.45 + t * 0.8;
        p.z += cos(t * 7.0 + aSeed.x * 13.0) * 0.3;
        vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.88, 1.0, t));
        vRot = t * 18.0 + aSeed.x * 6.28;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * 0.11 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA; varying float vRot; varying vec3 vColor;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float s = sin(vRot), c = cos(vRot);
        q = mat2(c, -s, s, c) * q;
        q.x *= 1.0 + abs(sin(vRot * 0.5)) * 1.5;
        float d = length(q * vec2(2.2, 1.0));
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor * (0.85 + 0.3 * (0.5 - d)), vA);
      }`,
  }));
  pts.frustumCulled = false;
  return pts;
}

export class Puffs {
  group = new THREE.Group();
  private pool: { m: THREE.Mesh; life: number; max: number; vel: THREE.Vector3; grow: number }[] = [];
  private next = 0;

  constructor(count: number, color: string, opacity: number, private gravity = 0) {
    const geo = gravity ? new THREE.CircleGeometry(0.2, 5) : new THREE.IcosahedronGeometry(0.2, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, roughness: 1, flatShading: true, side: gravity ? THREE.DoubleSide : THREE.FrontSide }));
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
      if (this.gravity) {
        p.vel.y -= this.gravity * dt;
        p.vel.multiplyScalar(1 - dt * 1.5);
        p.m.rotation.x += dt * 7;
        p.m.rotation.z += dt * 5;
      }
      p.m.position.addScaledVector(p.vel, dt);
      p.m.scale.multiplyScalar(1 + p.grow * dt);
      const mat = p.m.material as THREE.MeshStandardMaterial;
      mat.opacity = (mat.userData.base as number) * (1 - k) * Math.min(1, k * 6);
    }
  }
}

export class Ripples {
  group = new THREE.Group();
  private pool: { m: THREE.Mesh; life: number; max: number; size: number }[] = [];
  private next = 0;
  constructor(count = 16, color = '#eafaff', thickness = 0.14) {
    const geo = new THREE.RingGeometry(1 - thickness, 1, 40);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.pool.push({ m, life: 0, max: 1, size: 1 });
    }
  }
  emit(at: THREE.Vector3, size = 0.6, life = 1.2) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.m.position.set(at.x, 0.07, at.z);
    p.m.visible = true;
    p.life = 0; p.max = life; p.size = size;
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.m.visible = false; continue; }
      p.m.scale.setScalar(0.08 + k * p.size);
      (p.m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.75;
    }
  }
}

export class Swoosh {
  group = new THREE.Group();
  private flat: THREE.Mesh;
  private upright: THREE.Mesh;
  private alpha = 0;
  private active: THREE.Mesh | null = null;

  constructor() {
    const make = () => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uHead: { value: 0 }, uTail: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: `
        varying vec2 vP;
        void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uHead, uTail, uAlpha; varying vec2 vP;
        void main(){
          float a = atan(vP.y, vP.x);
          float span = uHead - uTail;
          float rel = mod((a - uTail) * sign(span) + 6.28318, 6.28318);
          float t = rel / max(abs(span), 0.001);
          if (t > 1.0) discard;
          float r = length(vP);
          float edge = smoothstep(0.35, 1.2, r) * (1.0 - smoothstep(1.22, 1.3, r));
          float a2 = pow(t, 1.6) * edge * uAlpha;
          gl_FragColor = vec4(vec3(1.4, 1.6, 1.9) * a2, a2);
        }`,
    });
    const flatGeo = new THREE.RingGeometry(0.3, 1.3, 48, 1);
    flatGeo.rotateX(-Math.PI / 2);
    this.flat = new THREE.Mesh(flatGeo, make());
    this.flat.position.y = 0.88;
    const upGeo = new THREE.RingGeometry(0.3, 1.3, 48, 1);
    upGeo.rotateY(Math.PI / 2);
    this.upright = new THREE.Mesh(upGeo, make());
    this.upright.position.y = 0.95;
    this.flat.visible = this.upright.visible = false;
    this.flat.frustumCulled = this.upright.frustumCulled = false;
    this.group.add(this.flat, this.upright);
  }

  update(dt: number, x: number, y: number, z: number, swing: { combo: number; k: number; yaw: number } | null) {
    this.group.position.set(x, y, z);
    if (swing) {
      this.group.rotation.y = swing.yaw;
      const p = THREE.MathUtils.smoothstep(swing.k, 0.08, 0.62);
      const mesh = swing.combo === 2 ? this.upright : this.flat;
      const other = mesh === this.flat ? this.upright : this.flat;
      other.visible = false;
      mesh.visible = true;
      this.active = mesh;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      let head: number, start: number;
      if (swing.combo === 2) {
        const ang = (al: number) => Math.atan2(-Math.cos(al), Math.sin(al));
        start = ang(-3.1);
        head = start + p * 2.7;
      } else {
        const from = swing.combo === 0 ? -1.15 : 1.0;
        const to = swing.combo === 0 ? 1.2 : -1.25;
        start = from - Math.PI / 2;
        head = from + (to - from) * p - Math.PI / 2;
      }
      const dir = Math.sign(head - start) || 1;
      u.uHead.value = head;
      u.uTail.value = dir > 0 ? Math.max(start, head - 1.6) : Math.min(start, head + 1.6);
      this.alpha = p > 0.02 ? 1 : 0;
      u.uAlpha.value = this.alpha;
    } else if (this.active) {
      this.alpha = Math.max(0, this.alpha - dt * 7);
      (this.active.material as THREE.ShaderMaterial).uniforms.uAlpha.value = this.alpha;
      if (this.alpha <= 0) { this.active.visible = false; this.active = null; }
    }
  }
}
