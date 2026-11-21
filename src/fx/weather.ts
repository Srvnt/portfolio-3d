import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SKY_HORIZON, SKY_TOP, FOG } from '../render/setup';
import { uniforms } from '../world/shared';

export interface WeatherState { sun: number; wind: number; rain: number; snow: number; fog: number }

export const CLEAR: WeatherState = { sun: 1, wind: 0.1, rain: 0, snow: 0, fog: 0 };

const RAIN_COUNT = 2600;
const SNOW_COUNT = 2200;
const BOX = { x: 22, y: 14, z: 18 };

const col = (h: string) => new THREE.Color(h);
const SKY = {
  clearTop: col('#6fb6ea'), clearHorizon: col('#f6e7c8'),
  greyTop: col('#8d99a6'), greyHorizon: col('#c9ced2'),
  stormTop: col('#5f6b78'), stormHorizon: col('#9aa3aa'),
  snowTop: col('#b9c6d2'), snowHorizon: col('#eef2f6'),
  fog: col('#d6dcdf'),
};

export function addWeatherCover(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshLambertMaterial)) return;
  const m = material;
  if ((m as unknown as { __weather?: boolean }).__weather) return;
  (m as unknown as { __weather?: boolean }).__weather = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${prevKey}|weather`;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms.uSnow = uniforms.uSnow;
    shader.uniforms.uWet = uniforms.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 wUp = objectNormal;
        #ifdef USE_INSTANCING
          wUp = mat3(instanceMatrix) * wUp;
        #endif
        vUp = normalize(mat3(modelMatrix) * wUp).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUp; uniform float uSnow; uniform float uWet;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - uWet * 0.22;
        float snowy = uSnow * smoothstep(0.15, 0.75, vUp);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), snowy);`);
  };
  m.needsUpdate = true;
}

function rainMesh() {
  const base = new Float32Array(RAIN_COUNT * 2 * 3);
  const end = new Float32Array(RAIN_COUNT * 2);
  const rnd = new Float32Array(RAIN_COUNT * 2);
  for (let i = 0; i < RAIN_COUNT; i++) {
    const x = (Math.random() * 2 - 1) * BOX.x, y = Math.random() * BOX.y, z = (Math.random() * 2 - 1) * BOX.z, r = Math.random();
    for (let k = 0; k < 2; k++) {
      base.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k;
      rnd[i * 2 + k] = r;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: uniforms.uTime, uWind: uniforms.uWind, uAmount: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
    vertexShader: `
      attribute float aEnd; attribute float aRand;
      uniform float uTime, uWind, uAmount; uniform vec3 uCenter;
      varying float vA;
      void main(){
        float H = ${BOX.y.toFixed(1)};
        float speed = 15.0 + aRand * 7.0;
        float y = mod(position.y - uTime * speed, H);
        vec2 slant = vec2(0.85, 0.3) * uWind * 0.55;
        vec3 p = vec3(position.x, y, position.z);
        p.xz += slant * (H - y);
        float len = 0.38 + aRand * 0.2;
        p += vec3(-slant.x * len, len, -slant.y * len) * aEnd;
        p += uCenter;
        vA = step(aRand, uAmount) * (0.35 + aRand * 0.25) * smoothstep(0.0, 1.5, y);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying float vA;
      void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(0.82, 0.88, 0.95, vA); }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  return lines;
}

function snowMesh() {
  const pos = new Float32Array(SNOW_COUNT * 3);
  const rnd = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    pos.set([(Math.random() * 2 - 1) * BOX.x, Math.random() * BOX.y, (Math.random() * 2 - 1) * BOX.z], i * 3);
    rnd[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: uniforms.uTime, uWind: uniforms.uWind, uAmount: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uScale: { value: window.innerHeight * 0.5 } },
    vertexShader: `
      attribute float aRand;
      uniform float uTime, uWind, uAmount, uScale; uniform vec3 uCenter;
      varying float vA;
      void main(){
        float H = ${BOX.y.toFixed(1)};
        float speed = 0.7 + aRand * 0.8 + uWind * 0.6;
        float y = mod(position.y - uTime * speed, H);
        vec3 p = vec3(position.x, y, position.z);
        p.x += sin(uTime * 1.2 + aRand * 40.0) * 0.45 + uWind * (H - y) * 0.55;
        p.z += cos(uTime * 0.9 + aRand * 25.0) * 0.35 + uWind * (H - y) * 0.2;
        p.x = mod(p.x + ${BOX.x.toFixed(1)}, ${(BOX.x * 2).toFixed(1)}) - ${BOX.x.toFixed(1)};
        p += uCenter;
        vA = step(aRand, uAmount) * smoothstep(0.0, 1.0, y);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * (0.07 + aRand * 0.06) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5 || vA < 0.01) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.15, d) * vA * 0.95);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export interface SunClock { utcOffset: number; sunrise: number | null; sunset: number | null; isDay: boolean }
export type TimeChoice = 'auto' | 'day' | 'dusk' | 'night';

const DAY_MS = 86_400_000;
const NIGHT = {
  top: col('#0c1532'), horizon: col('#243458'), fog: col('#1c2846'),
  sun: col('#9fb6ff'), hemiSky: col('#4a5a9a'), hemiGround: col('#161d2c'),
};
const TWILIGHT = { top: col('#5d4f94'), horizon: col('#ff9b62'), sun: col('#ff9050') };
const DAY_HEMI = { sky: col('#cfe8ff'), ground: col('#6d8f4a') };
const MOON_DIR = new THREE.Vector3(-12, 26, 10);

function starsMesh() {
  const N = 1100;
  const pos = new Float32Array(N * 3);
  const rnd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = 0.08 + Math.random() * 0.92, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 120, y * 120, Math.sin(a) * r * 120], i * 3);
    rnd[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: uniforms.uTime, uAlpha: { value: 0 } },
    vertexShader: `attribute float aRand; uniform float uTime; varying float vA;
      void main(){ vA = 0.55 + 0.45 * sin(uTime * (1.0 + aRand * 3.0) + aRand * 40.0);
        gl_PointSize = 1.5 + aRand * 2.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uAlpha; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * 1.6, smoothstep(0.5, 0.0, d) * vA * uAlpha); }`,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = -0.5;
  return pts;
}

export class WeatherFX {
  group = new THREE.Group();
  target: WeatherState = { ...CLEAR };
  current: WeatherState = { ...CLEAR };
  night = 0;
  private rain = rainMesh();
  private snow = snowMesh();
  private stars = starsMesh();
  private snowCover = 0;
  private wet = 0;
  private clock: SunClock | null = null;
  private time: TimeChoice = 'auto';
  private windows: THREE.MeshStandardMaterial[] = [];
  private sunDir = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    private bloom: UnrealBloomPass,
    private renderer: THREE.WebGLRenderer,
    private sunOffset: THREE.Vector3,
  ) {
    this.group.add(this.rain, this.snow, this.stars);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.name === 'window-glass' && !this.windows.includes(m)) this.windows.push(m);
    });
  }

  set(state: WeatherState) { this.target = { ...state }; }
  setClock(c: SunClock | null) { this.clock = c; }
  setTime(t: TimeChoice) { this.time = t; }

  localTimeOfDay(): number | null {
    if (!this.clock) return null;
    return (((Date.now() + this.clock.utcOffset * 1000) % DAY_MS) + DAY_MS) % DAY_MS;
  }

  private sunPosition(): { el: number; p: number } {
    if (this.time === 'day') return { el: 0.75, p: 0.42 };
    if (this.time === 'dusk') return { el: 0.04, p: 0.97 };
    if (this.time === 'night') return { el: -0.7, p: 0.5 };
    const c = this.clock;
    const tod = this.localTimeOfDay();
    if (!c || tod === null) return { el: 0.7, p: 0.42 };
    if (c.sunrise === null || c.sunset === null) return c.isDay ? { el: 0.35, p: 0.5 } : { el: -0.6, p: 0.5 };
    const sr = c.sunrise, ss = c.sunset, len = ss - sr;
    const peak = THREE.MathUtils.clamp(len / (16 * 3_600_000), 0.25, 0.9);
    if (tod >= sr && tod <= ss) {
      const p = (tod - sr) / len;
      return { el: Math.sin(Math.PI * p) * peak, p };
    }
    const nightLen = DAY_MS - len;
    const q = ((tod - ss + DAY_MS) % DAY_MS) / nightLen;
    return { el: -Math.sin(Math.PI * q) * 0.8, p: q < 0.5 ? 1 : 0 };
  }

  update(dt: number, focus: THREE.Vector3) {
    const c = this.current, t = this.target;
    const k = 1 - Math.exp(-dt * 0.8);
    (Object.keys(c) as (keyof WeatherState)[]).forEach((key) => { c[key] += (t[key] - c[key]) * k; });

    const center = new THREE.Vector3(focus.x - 2, 0, focus.z - 4);
    for (const p of [this.rain, this.snow]) (p.material as THREE.ShaderMaterial).uniforms.uCenter.value.copy(center);
    (this.rain.material as THREE.ShaderMaterial).uniforms.uAmount.value = c.rain;
    (this.snow.material as THREE.ShaderMaterial).uniforms.uAmount.value = c.snow;
    this.rain.visible = c.rain > 0.01;
    this.snow.visible = c.snow > 0.01;

    uniforms.uWind.value = c.wind;
    const settle = t.snow > 0.05 ? 0.05 * t.snow : -0.04 * (0.5 + c.sun + c.rain);
    this.snowCover = THREE.MathUtils.clamp(this.snowCover + settle * dt * 3, 0, 0.85);
    uniforms.uSnow.value = this.snowCover;
    this.wet += ((t.rain > 0.05 ? 1 : 0) - this.wet) * (1 - Math.exp(-dt * (t.rain > 0.05 ? 0.6 : 0.15)));
    uniforms.uWet.value = this.wet * (1 - this.snowCover);

    const { el, p } = this.sunPosition();
    const dayTarget = THREE.MathUtils.smoothstep(el, -0.1, 0.16);
    this.night += (1 - dayTarget - this.night) * (1 - Math.exp(-dt * 1.5));
    const night = this.night, day = 1 - night;
    const twilight = THREE.MathUtils.clamp(1 - Math.abs(el) / 0.22, 0, 1) * (0.4 + c.sun * 0.6);
    uniforms.uNight.value = night;

    const az = Math.PI * p;
    this.sunDir.set(Math.cos(az) * 22, Math.max(0.12, el) * 30 + 3, Math.sin(az) * 16 + 4);
    this.sunOffset.copy(day > 0.4 ? this.sunDir : MOON_DIR);

    const overcast = 1 - c.sun;
    const sunI = (0.55 + c.sun * 2.05) * (1 - c.fog * 0.45) * (1 - c.rain * 0.35) * (0.35 + 0.65 * THREE.MathUtils.smoothstep(el, 0, 0.35));
    const moonI = 0.5 * (1 - c.fog * 0.5) * (0.45 + c.sun * 0.55);
    this.sun.intensity = day > 0.4 ? sunI * day : moonI * night;
    this.sun.color.set('#ffe6bf').lerp(TWILIGHT.sun, twilight * 0.85).lerp(col('#dfe6ee'), overcast * 0.8).lerp(NIGHT.sun, night);
    this.hemi.intensity = THREE.MathUtils.lerp(0.5 + c.snow * 0.25, 1.2 + overcast * 0.35 + c.snow * 0.25, day);
    this.hemi.color.copy(DAY_HEMI.sky).lerp(NIGHT.hemiSky, night);
    this.hemi.groundColor.copy(DAY_HEMI.ground).lerp(NIGHT.hemiGround, night);
    this.renderer.toneMappingExposure = (1.0 + c.sun * 0.05 + this.snowCover * 0.05 - c.rain * 0.08) * (1 - night * 0.08);
    this.bloom.strength = (0.16 + c.sun * 0.16) * day + 0.42 * night;

    SKY_TOP.copy(SKY.clearTop).lerp(SKY.greyTop, overcast).lerp(SKY.stormTop, c.rain * 0.7).lerp(SKY.snowTop, c.snow * 0.8)
      .lerp(TWILIGHT.top, twilight * 0.6).lerp(NIGHT.top, night);
    SKY_HORIZON.copy(SKY.clearHorizon).lerp(SKY.greyHorizon, overcast).lerp(SKY.stormHorizon, c.rain * 0.6).lerp(SKY.snowHorizon, c.snow * 0.8)
      .lerp(TWILIGHT.horizon, twilight * 0.75).lerp(NIGHT.horizon, night);
    (this.stars.material as THREE.ShaderMaterial).uniforms.uAlpha.value = night * (1 - c.fog) * (1 - overcast * 0.85);
    this.stars.position.copy(focus);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(FOG).lerp(SKY.greyHorizon, overcast * 0.7).lerp(SKY.snowHorizon, c.snow * 0.6).lerp(SKY.fog, c.fog)
      .lerp(TWILIGHT.horizon, twilight * 0.35).lerp(NIGHT.fog, night * 0.9);
    fog.near = THREE.MathUtils.lerp(32, 3, c.fog) * (1 - c.rain * 0.3) * (1 - c.snow * 0.25);
    fog.far = THREE.MathUtils.lerp(75, 24, c.fog) * (1 - c.rain * 0.25) * (1 - c.snow * 0.2);
    (this.scene.background as THREE.Color).copy(fog.color);

    for (const w of this.windows) w.emissiveIntensity = 0.7 + night * 3.2;
  }
}
