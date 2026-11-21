import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const SKY_TOP = new THREE.Color('#6fb6ea');
export const SKY_HORIZON = new THREE.Color('#f6e7c8');
export const FOG = new THREE.Color('#cfe6dc');

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.35, 0.85, d) * uStrength;
      gl_FragColor = c;
    }`,
};

export function createRenderer(canvas: HTMLCanvasElement) {
  const lowEnd = matchMedia('(pointer: coarse)').matches || navigator.hardwareConcurrency <= 4;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowEnd ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 32, 75);
  scene.background = FOG.clone();

  // gradient sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
        void main(){ float t = smoothstep(-0.05, 0.6, vP.y); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 220);
  sky.onBeforeRender = () => sky.position.copy(camera.position);

  // lights
  const hemi = new THREE.HemisphereLight('#cfe8ff', '#6d8f4a', 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe6bf', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  /** Direction to the sun/moon (scaled); the day-night cycle moves it. */
  const sunOffset = new THREE.Vector3(-14, 26, 12);

  // post-processing
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: lowEnd ? 0 : 2, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(VignetteShader));
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 48 : 34; // portrait phones see more
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** Keep the shadow frustum centred on the action for crisp shadows. */
  function followSun(focus: THREE.Vector3) {
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(sunOffset);
  }

  return { renderer, scene, camera, composer, sun, hemi, bloom, sunOffset, followSun, lowEnd };
}
