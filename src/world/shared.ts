import * as THREE from 'three';

/** Uniforms shared by every animated shader in the world. */
export const uniforms = {
  uTime: { value: 0 },
  uHero: { value: new THREE.Vector2(-100, -100) },
  /** Last sword hit: x, z, strength (decays to 0). Grass flattens around it. */
  uHit: { value: new THREE.Vector3(-100, -100, 0) },
  /** Weather: wind strength 0..1, settled snow 0..1, wet ground 0..1. */
  uWind: { value: 0 },
  uSnow: { value: 0 },
  uWet: { value: 0 },
  /** 0 = full day, 1 = deep night. */
  uNight: { value: 0 },
};

/** Low-poly helpers ---------------------------------------------------------- */

/** Paint a whole geometry one colour (vertex colours, non-indexed, no uv). */
export function tint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  // one colour per triangle so flat shading reads as facets
  for (let t = 0; t < n; t += 3) {
    const k = jitter ? 1 + (Math.sin((t + seed) * 12.9898) * 43758.5453 % 1) * jitter : 1;
    for (let v = 0; v < 3 && t + v < n; v++) {
      arr[(t + v) * 3] = c.r * k;
      arr[(t + v) * 3 + 1] = c.g * k;
      arr[(t + v) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Push vertices around consistently (shared corners move together) for organic shapes. */
export function wobble(geo: THREE.BufferGeometry, amount: number, seed = 0): THREE.BufferGeometry {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x * 100) * 73856093 ^ Math.round(y * 100) * 19349663 ^ Math.round(z * 100) * 83492791 ^ seed;
    const r = (n: number) => ((Math.sin(k * 0.0001 + n) * 43758.5453) % 1);
    p.setXYZ(i, x + r(1) * amount, y + r(2) * amount, z + r(3) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Inject a wind sway into a standard material; vertices above `minY` sway more the higher they are. */
export function addWind(material: THREE.Material, amp: number, minY: number) {
  // distinct cache key so materials with different sway don't share one program
  material.customProgramCacheKey = () => `wind-${amp}-${minY}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float hgt = max(position.y - ${minY.toFixed(2)}, 0.0);
        transformed.x += (sin(uTime * (1.3 + uWind * 2.0) + ip.x * 0.5 + ip.y * 0.3) + uWind * 1.2) * ${amp.toFixed(3)} * (1.0 + uWind * 2.5) * hgt;
        transformed.z += cos(uTime * (1.1 + uWind * 2.0) + ip.x * 0.3) * ${(amp * 0.6).toFixed(3)} * (1.0 + uWind * 2.5) * hgt;`,
      );
  };
}

export function standard(opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, ...opts });
}

/** Soft canvas texture (smooth, mip-mapped). */
export function canvasTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}
