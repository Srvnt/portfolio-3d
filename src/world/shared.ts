import * as THREE from 'three';

export const uniforms = {
  uTime: { value: 0 },
  uHero: { value: new THREE.Vector2(-100, -100) },
  uHit: { value: new THREE.Vector3(-100, -100, 0) },
  uWind: { value: 0 },
  uSnow: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
};

export function tint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
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

export function standard(opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, ...opts });
}

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
