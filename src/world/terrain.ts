import * as THREE from 'three';
import { BUILDINGS, FOUNTAIN, Tile, WorldMap } from './map';
import { hash2, rng, valueNoise } from '../core/random';
import { canvasTexture, makeCanvas } from './shared';

export const GRASS_BASE = '#5e9e3a';

/** Height of the land. The village is flat; hills rise outside it to frame the valley. */
export function heightAt(map: WorldMap, x: number, z: number): number {
  const dx = Math.max(-x, 0, x - map.W);
  const dz = Math.max(-z, 0, z - map.H);
  const d = Math.hypot(dx, dz);
  if (d <= 0) return 0;
  const n = valueNoise(x * 0.12, z * 0.12, 7);
  return Math.pow(d, 1.4) * 0.26 + n * 1.6 * Math.min(1, d / 5);
}

const PPU = 32; // texture pixels per world unit

/** Paints grass, organic paths, cobbled plaza, riverbed and soft contact shadows. */
function paintGround(map: WorldMap): HTMLCanvasElement {
  const W = map.W * PPU;
  const H = map.H * PPU;
  const { canvas, ctx } = makeCanvas(W, H);
  const r = rng(42);

  // grass with soft colour patches
  ctx.fillStyle = GRASS_BASE;
  ctx.fillRect(0, 0, W, H);
  const patches = ['#6aae40', '#559433', '#72b848', '#4f8a30'];
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = patches[Math.floor(r() * patches.length)];
    g.addColorStop(0, c + '88');
    g.addColorStop(1, c + '00');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  const forTiles = (pred: (t: Tile) => boolean, fn: (cx: number, cy: number, x: number, z: number) => void) => {
    for (let z = 0; z < map.H; z++)
      for (let x = 0; x < map.W; x++) if (pred(map.tile(x, z))) fn((x + 0.5) * PPU, (z + 0.5) * PPU, x, z);
  };
  const blob = (color: string, radius: number, pred: (t: Tile) => boolean, blur: number) =>
    blurred(ctx, blur, (l) => {
      l.fillStyle = color;
      l.beginPath();
      forTiles(pred, (cx, cy, x, z) => {
        const r = radius * PPU * (0.92 + hash2(x, z, 77) * 0.16);
        l.moveTo(cx + r, cy);
        l.arc(cx, cy, r, 0, Math.PI * 2);
      });
      l.fill();
    });
  const isWet = (t: Tile) => t === Tile.Water || t === Tile.Bridge;

  // riverbank sand, then riverbed
  blob('#d9c48e', 1.05, isWet, 4);
  blob('#3d6f64', 0.8, isWet, 6);
  // paths: darker rim then light core
  blob('#b8955f', 0.8, (t) => t === Tile.Path, 2);
  blob('#dcc08a', 0.7, (t) => t === Tile.Path, 3);

  // path speckles
  forTiles((t) => t === Tile.Path, (cx, cy, x, z) => {
    for (let k = 0; k < 14; k++) {
      const px = cx + (hash2(x, z, k) - 0.5) * PPU;
      const py = cy + (hash2(x, z, k + 50) - 0.5) * PPU;
      ctx.fillStyle = hash2(x, z, k + 99) < 0.5 ? '#c3a06a' : '#ead3a2';
      ctx.beginPath();
      ctx.arc(px, py, 1 + hash2(x, z, k + 7) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // cobbled plaza
  const [px0, pz0, px1, pz1] = [18, 14, 26, 22];
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px0 * PPU + 6, pz0 * PPU + 6, (px1 - px0) * PPU - 12, (pz1 - pz0) * PPU - 12, 40);
  ctx.clip();
  ctx.fillStyle = '#a89c86';
  ctx.fillRect(px0 * PPU, pz0 * PPU, (px1 - px0) * PPU, (pz1 - pz0) * PPU);
  const stone = 14;
  for (let y = pz0 * PPU; y < pz1 * PPU; y += stone) {
    const off = (Math.floor(y / stone) % 2) * (stone / 2);
    for (let x = px0 * PPU - off; x < px1 * PPU; x += stone) {
      const h = hash2(x, y, 3);
      ctx.fillStyle = h < 0.33 ? '#d8cdb6' : h < 0.66 ? '#cbbfa6' : '#e2d8c2';
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, stone - 3, stone - 3, 4);
      ctx.fill();
    }
  }
  // circular inlay around the fountain
  ctx.strokeStyle = '#8f846f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(FOUNTAIN.x * PPU, FOUNTAIN.z * PPU, 2.1 * PPU, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // contact shadows (fake ambient occlusion)
  blurred(ctx, 14, (l) => {
    l.fillStyle = 'rgba(20, 30, 10, 0.45)';
    for (const b of BUILDINGS) l.fillRect((b.x0 - 0.2) * PPU, (b.z0 - 0.2) * PPU, (b.w + 0.4) * PPU, (b.d + 0.45) * PPU);
    l.beginPath();
    l.arc(FOUNTAIN.x * PPU, FOUNTAIN.z * PPU, 1.35 * PPU, 0, Math.PI * 2);
    l.fill();
  });
  blurred(ctx, 6, (l) => {
    l.fillStyle = 'rgba(20, 30, 10, 0.35)';
    l.beginPath();
    for (const p of map.props) {
      if (!p.inside) continue;
      const r = (p.kind === 'tree' ? 0.42 : 0.45) * PPU;
      l.moveTo(p.x * PPU + r, p.z * PPU);
      l.arc(p.x * PPU, p.z * PPU, r, 0, Math.PI * 2);
    }
    l.fill();
  });
  return canvas;
}

/**
 * Draw shapes on a scratch layer, then composite it blurred in ONE pass.
 * (Setting ctx.filter and filling shape-by-shape allocates a full-size
 * temporary buffer per shape — that blew memory up to many GB.)
 */
export function blurred(ctx: CanvasRenderingContext2D, blur: number, draw: (layer: CanvasRenderingContext2D) => void) {
  const { canvas: layer, ctx: l } = makeCanvas(ctx.canvas.width, ctx.canvas.height);
  draw(l);
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  layer.width = layer.height = 0; // release the scratch buffer now
}

export function createTerrain(map: WorldMap) {
  const group = new THREE.Group();

  const tex = canvasTexture(paintGround(map));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.W, map.H),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.W / 2, 0, map.H / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // rolling hills around the valley (low-poly)
  const M = 34;
  const geo = new THREE.PlaneGeometry(map.W + M * 2, map.H + M * 2, 78, 70);
  geo.rotateX(-Math.PI / 2);
  geo.translate(map.W / 2, 0, map.H / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(GRASS_BASE);
  const high = new THREE.Color('#3f7a3a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(map, x, z);
    pos.setY(i, h - 0.04);
    c.copy(low).lerp(high, Math.min(1, h / 8)).multiplyScalar(0.92 + valueNoise(x * 0.3, z * 0.3, 9) * 0.16);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  hills.receiveShadow = true;
  group.add(hills);

  return group;
}
