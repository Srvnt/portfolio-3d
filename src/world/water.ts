import * as THREE from 'three';
import { Tile, WorldMap } from './map';
import { makeCanvas, uniforms } from './shared';
import { blurred } from './terrain';

function riverMask(map: WorldMap): THREE.CanvasTexture {
  const ppu = 16;
  const { canvas, ctx } = makeCanvas(map.W * ppu, map.H * ppu);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  blurred(ctx, 7, (l) => {
    l.fillStyle = '#fff';
    l.beginPath();
    for (let z = -1; z <= map.H; z++)
      for (let x = 0; x < map.W; x++) {
        const t = map.tile(x, Math.min(map.H - 1, Math.max(0, z)));
        if (t === Tile.Water || t === Tile.Bridge) {
          const cx = (x + 0.5) * ppu, cy = (z + 0.5) * ppu, r = ppu * 0.85;
          l.moveTo(cx + r, cy);
          l.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
    l.fill();
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const NOISE = `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
  }`;

export function createWater(map: WorldMap) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMask: { value: riverMask(map) },
        uDeep: { value: new THREE.Color('#1f6a9e') },
        uShallow: { value: new THREE.Color("#3fa8b0") },
        uFoam: { value: new THREE.Color('#f2fbff') },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform sampler2D uMask; uniform float uTime;
      uniform vec3 uDeep, uShallow, uFoam;
      varying vec2 vUv; varying vec3 vWorld;
      ${NOISE}
      void main(){
        float m = texture2D(uMask, vUv).r;
        if (m < 0.32) discard;
        vec2 p = vWorld.xz;
        float flow = vnoise(p * 1.3 + vec2(0.0, uTime * 0.6)) * 0.5 + vnoise(p * 2.7 - vec2(uTime * 0.3, uTime * 0.9)) * 0.5;
        float depth = smoothstep(0.32, 0.95, m);
        vec3 col = mix(uShallow, uDeep, depth * (0.75 + flow * 0.35));
        float edge = 1.0 - smoothstep(0.32, 0.48, m + (flow - 0.5) * 0.12);
        col = mix(col, uFoam, edge * 0.9);
        float streak = smoothstep(0.78, 0.86, vnoise(vec2(p.x * 3.0, p.y * 0.8 - uTime * 1.2)));
        col += streak * 0.1 * depth;
        float s = vnoise(p * 9.0 + uTime * vec2(0.4, 1.1));
        col += smoothstep(0.93, 0.99, s) * 2.2 * depth;
        gl_FragColor = vec4(col, mix(0.5, 0.62, depth));
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = uniforms.uTime;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(map.W, map.H), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(map.W / 2, 0.04, map.H / 2);
  return mesh;
}
