/**
 * Round minimap (top-right) and a full map (M / click). The world is painted once into an
 * illustrated base image — trees, paths, river, buildings, danger zones — and live markers
 * (hero, monsters, chests) are drawn on top each frame.
 */
import { BUILDINGS, FOUNTAIN, Prop, SAFE, SPAWN_ZONES, Tile, WorldMap } from '../world/map';
import { hash2, rng } from '../core/random';

const PPT = 10; // base-image pixels per tile
const VIEW = 15; // minimap radius in tiles

export interface MapMarkers {
  hero: { x: number; z: number; heading: number };
  enemies: { x: number; z: number; kind: string; alive: boolean }[];
  chests: { x: number; z: number; opened: boolean }[];
}

function paintBase(map: WorldMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.W * PPT;
  c.height = map.H * PPT;
  const g = c.getContext('2d')!;
  const r = rng(17);
  const T = (n: number) => n * PPT;

  // meadow with soft colour variation
  g.fillStyle = '#74b24c';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 260; i++) {
    const x = r() * c.width, y = r() * c.height, rad = 20 + r() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.5 ? '134,196,90' : '92,156,62';
    grad.addColorStop(0, `rgba(${col},0.45)`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // danger zones: warm tint + hatching
  for (const zn of SPAWN_ZONES) {
    g.save();
    g.beginPath();
    g.roundRect(T(zn.x0), T(zn.z0), T(zn.x1 - zn.x0 + 1), T(zn.z1 - zn.z0 + 1), T(2));
    g.clip();
    g.fillStyle = 'rgba(190,80,40,0.16)';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(150,50,30,0.12)';
    g.lineWidth = 2;
    for (let d = -c.height; d < c.width; d += 14) { g.beginPath(); g.moveTo(d, 0); g.lineTo(d + c.height, c.height); g.stroke(); }
    g.restore();
  }

  const tiles = (pred: (t: Tile) => boolean, fn: (x: number, z: number) => void) => {
    for (let z = 0; z < map.H; z++) for (let x = 0; x < map.W; x++) if (pred(map.tile(x, z))) fn(x, z);
  };
  const blob = (pred: (t: Tile) => boolean, color: string, rad: number) => {
    g.fillStyle = color;
    g.beginPath();
    tiles(pred, (x, z) => { g.moveTo(T(x + 0.5) + T(rad), T(z + 0.5)); g.arc(T(x + 0.5), T(z + 0.5), T(rad), 0, Math.PI * 2); });
    g.fill();
  };
  const wet = (t: Tile) => t === Tile.Water || t === Tile.Bridge;

  // river: sandy bank, deep water, bright current
  blob(wet, '#d9c48a', 1.0);
  blob(wet, '#3f9fd0', 0.78);
  g.strokeStyle = 'rgba(190,235,255,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  for (let z = 0; z <= map.H; z += 0.5) {
    const x = map.riverCenter(z) + Math.sin(z * 0.8) * 0.25;
    if (z === 0) g.moveTo(T(x), T(z)); else g.lineTo(T(x), T(z));
  }
  g.stroke();
  // ripple ticks
  g.strokeStyle = 'rgba(220,245,255,0.6)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 40; i++) {
    const z = r() * map.H, x = map.riverCenter(z) + (r() - 0.5) * 1.4;
    g.beginPath(); g.moveTo(T(x) - 3, T(z)); g.quadraticCurveTo(T(x), T(z) - 2, T(x) + 3, T(z)); g.stroke();
  }

  // paths
  blob((t) => t === Tile.Path, '#c49a5e', 0.62);
  blob((t) => t === Tile.Path, '#ead39a', 0.5);
  // bridges: planks
  tiles((t) => t === Tile.Bridge, (x, z) => {
    g.fillStyle = '#9a6a3a';
    g.fillRect(T(x) - 1, T(z), T(1) + 2, T(1));
    g.fillStyle = '#7a4e28';
    for (let k = 0; k < PPT; k += 3) g.fillRect(T(x) + k, T(z), 1, T(1));
  });

  // plaza and fountain
  g.fillStyle = '#d8cdb4';
  g.beginPath();
  g.roundRect(T(18.2), T(14.2), T(7.6), T(7.6), T(1.4));
  g.fill();
  g.fillStyle = '#bfb39a';
  for (let z = 14.5; z < 21.6; z += 0.5) for (let x = 18.5; x < 25.6; x += 0.5) if (hash2(x * 2, z * 2, 3) < 0.3) g.fillRect(T(x), T(z), 2, 2);
  g.fillStyle = '#9aa7b0';
  g.beginPath(); g.arc(T(FOUNTAIN.x), T(FOUNTAIN.z), T(1.25), 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5cc4e8';
  g.beginPath(); g.arc(T(FOUNTAIN.x), T(FOUNTAIN.z), T(1.0), 0, Math.PI * 2); g.fill();

  // flowers
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!map.flowers[map.i(x, z)]) continue;
      for (let k = 0; k < 3; k++) {
        g.fillStyle = ['#ffe066', '#ff8ab4', '#ffffff', '#9ad8ff'][Math.floor(hash2(x, z, k) * 4)];
        g.fillRect(T(x + hash2(x, z, k + 5)), T(z + hash2(x, z, k + 9)), 2, 2);
      }
    }

  // rocks, bushes, then trees as tiny illustrated canopies (drawn back-to-front)
  const props = [...map.props].filter((p) => p.inside).sort((a, b) => a.z - b.z);
  const tree = (p: Prop) => {
    const x = T(p.x), y = T(p.z), rad = T(0.55 + hash2(Math.floor(p.x * 9), Math.floor(p.z * 9), 1) * 0.15);
    g.fillStyle = 'rgba(20,40,20,0.28)';
    g.beginPath(); g.ellipse(x + 2, y + 3, rad, rad * 0.7, 0, 0, Math.PI * 2); g.fill();
    const base = p.v === 3 ? ['#c25e8a', '#ee8ab4', '#ffd0e4'] : p.v === 2 ? ['#1f5a3e', '#2f7e56', '#5fb07e'] : ['#2f6e2e', '#4a983e', '#86c860'];
    g.fillStyle = base[0];
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    g.fillStyle = base[1];
    g.beginPath(); g.arc(x - rad * 0.15, y - rad * 0.15, rad * 0.75, 0, Math.PI * 2); g.fill();
    g.fillStyle = base[2];
    g.beginPath(); g.arc(x - rad * 0.35, y - rad * 0.38, rad * 0.32, 0, Math.PI * 2); g.fill();
  };
  for (const p of props) {
    if (p.kind === 'rock') {
      g.fillStyle = '#8a9098';
      g.beginPath(); g.ellipse(T(p.x), T(p.z), T(0.35), T(0.25), 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c4c9cf';
      g.beginPath(); g.ellipse(T(p.x) - 1, T(p.z) - 1.5, T(0.15), T(0.1), 0.3, 0, Math.PI * 2); g.fill();
    } else if (p.kind === 'bush') {
      g.fillStyle = '#3f8a3c';
      g.beginPath(); g.arc(T(p.x), T(p.z), T(0.4), 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6cb64e';
      g.beginPath(); g.arc(T(p.x) - 1.5, T(p.z) - 1.5, T(0.2), 0, Math.PI * 2); g.fill();
    } else tree(p);
  }

  // buildings: drop shadow, walls, pitched roof with ridge
  for (const b of BUILDINGS) {
    const x = T(b.x0), y = T(b.z0), w = T(b.w), h = T(b.d);
    g.fillStyle = 'rgba(20,20,30,0.35)';
    g.fillRect(x + 4, y + 5, w, h);
    g.fillStyle = '#f3ead2';
    g.fillRect(x, y, w, h);
    g.fillStyle = b.roof;
    g.fillRect(x - 2, y - 2, w + 4, h * 0.55 + 2);
    g.fillStyle = shade(b.roof, 0.72);
    g.fillRect(x - 2, y + h * 0.55, w + 4, h * 0.3);
    g.fillStyle = shade(b.roof, 0.55);
    g.fillRect(x - 2, y + h * 0.55 - 1, w + 4, 2);
    // door
    g.fillStyle = '#6b4428';
    g.fillRect(x + w / 2 - 3, y + h - 4, 6, 4);
  }

  // village boundary: dashed gold line
  g.setLineDash([8, 6]);
  g.strokeStyle = 'rgba(255,214,110,0.95)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(T(SAFE.x1), 0);
  g.lineTo(T(SAFE.x1), T(SAFE.z1));
  g.lineTo(0, T(SAFE.z1));
  g.stroke();
  g.setLineDash([]);

  // forest edge: darken the map border like hills
  const edge = g.createLinearGradient(0, 0, 0, c.height);
  edge.addColorStop(0, 'rgba(30,60,30,0.35)');
  edge.addColorStop(0.06, 'rgba(30,60,30,0)');
  edge.addColorStop(0.94, 'rgba(30,60,30,0)');
  edge.addColorStop(1, 'rgba(30,60,30,0.35)');
  g.fillStyle = edge;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

export class Minimap {
  private base: HTMLCanvasElement;
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private full = false;
  private frame = 0;

  constructor(private map: WorldMap) {
    this.base = paintBase(map);
    this.el = document.getElementById('minimap')!;
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.el.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggle();
      else if (e.code === 'Escape' && this.full) this.toggle();
    });
  }

  show() { this.el.hidden = false; }

  toggle() {
    this.full = !this.full;
    this.el.classList.toggle('full', this.full);
  }

  update(m: MapMarkers) {
    if (this.el.hidden) return;
    if (this.frame++ % 2) return; // 30 fps is plenty
    const dpr = Math.min(2, window.devicePixelRatio);
    const size = Math.round(this.el.clientWidth * dpr);
    const sizeH = Math.round(this.el.clientHeight * dpr);
    if (this.cv.width !== size || this.cv.height !== sizeH) { this.cv.width = size; this.cv.height = sizeH; }
    const g = this.g;
    g.clearRect(0, 0, size, sizeH);
    let scale: number, ox: number, oy: number;
    if (this.full) {
      scale = Math.min(size / this.map.W, sizeH / this.map.H);
      ox = (size - this.map.W * scale) / 2;
      oy = (sizeH - this.map.H * scale) / 2;
    } else {
      scale = size / (VIEW * 2);
      ox = size / 2 - m.hero.x * scale;
      oy = sizeH / 2 - m.hero.z * scale;
    }
    const W = (x: number) => ox + x * scale;
    const Z = (z: number) => oy + z * scale;

    g.save();
    if (!this.full) { g.beginPath(); g.arc(size / 2, sizeH / 2, size / 2, 0, Math.PI * 2); g.clip(); }
    // outside the map: deep forest green
    g.fillStyle = '#2c4a2a';
    g.fillRect(0, 0, size, sizeH);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, W(0), Z(0), this.map.W * scale, this.map.H * scale);

    // labels on the full map
    if (this.full) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const label = (text: string, x: number, z: number, px: number, color = '#fff8e6') => {
        g.font = `800 ${px * dpr}px Cinzel, Georgia, serif`;
        g.lineWidth = 4 * dpr;
        g.strokeStyle = 'rgba(20,24,50,0.75)';
        g.strokeText(text, W(x), Z(z));
        g.fillStyle = color;
        g.fillText(text, W(x), Z(z));
      };
      for (const b of BUILDINGS) label(b.label.split(' · ')[1] ?? b.label, b.x0 + b.w / 2, b.z0 - 0.9, 12);
      label('Village', 13, 2.5, 16, '#ffd86e');
      label('The Wilds', 58, 30, 18, '#ffb4a0');
      label('The Wilds', 17, 45, 18, '#ffb4a0');
    }

    // danger markers (skulls) in each wild zone
    for (const zn of SPAWN_ZONES) this.skull(W((zn.x0 + zn.x1) / 2), Z((zn.z0 + zn.z1) / 2), scale * (this.full ? 0.9 : 0.7));

    // chests
    for (const c of m.chests) if (!c.opened) this.chest(W(c.x), Z(c.z), Math.max(5 * dpr, scale * 0.7));
    // monsters
    for (const e of m.enemies) {
      if (!e.alive) continue;
      const rad = (e.kind === 'brute' ? 0.55 : 0.38) * scale + dpr;
      g.fillStyle = '#2a0a0a';
      g.beginPath(); g.arc(W(e.x), Z(e.z), rad + 1.2 * dpr, 0, Math.PI * 2); g.fill();
      g.fillStyle = e.kind === 'brute' ? '#ff6a3a' : '#ff3a4a';
      g.beginPath(); g.arc(W(e.x), Z(e.z), rad, 0, Math.PI * 2); g.fill();
    }
    // hero arrow
    this.arrow(W(m.hero.x), Z(m.hero.z), m.hero.heading, Math.max(7 * dpr, scale * 0.9));
    g.restore();

    if (!this.full) {
      // inner vignette for depth
      const vg = g.createRadialGradient(size / 2, sizeH / 2, size * 0.32, size / 2, sizeH / 2, size / 2);
      vg.addColorStop(0, 'rgba(10,16,40,0)');
      vg.addColorStop(1, 'rgba(10,16,40,0.45)');
      g.fillStyle = vg;
      g.beginPath(); g.arc(size / 2, sizeH / 2, size / 2, 0, Math.PI * 2); g.fill();
    }
  }

  private arrow(x: number, y: number, heading: number, s: number) {
    const g = this.g;
    g.save();
    g.translate(x, y);
    // heading 0 faces +z (down on the map)
    g.rotate(-heading);
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 4;
    g.beginPath();
    g.moveTo(0, s);
    g.lineTo(s * 0.7, -s * 0.6);
    g.lineTo(0, -s * 0.25);
    g.lineTo(-s * 0.7, -s * 0.6);
    g.closePath();
    g.fillStyle = '#fff6dc';
    g.fill();
    g.lineWidth = Math.max(1.5, s * 0.18);
    g.strokeStyle = '#e8a93a';
    g.stroke();
    g.restore();
  }

  private chest(x: number, y: number, s: number) {
    const g = this.g;
    g.fillStyle = '#3a2210';
    g.fillRect(x - s * 0.62, y - s * 0.5, s * 1.24, s);
    g.fillStyle = '#b8742e';
    g.fillRect(x - s * 0.5, y - s * 0.38, s, s * 0.76);
    g.fillStyle = '#f2c84a';
    g.fillRect(x - s * 0.5, y - s * 0.08, s, s * 0.16);
    g.fillRect(x - s * 0.1, y - s * 0.2, s * 0.2, s * 0.32);
  }

  private skull(x: number, y: number, s: number) {
    const g = this.g;
    g.globalAlpha = 0.75;
    g.fillStyle = '#fff3e6';
    g.beginPath(); g.arc(x, y - s * 0.15, s * 0.55, 0, Math.PI * 2); g.fill();
    g.fillRect(x - s * 0.32, y + s * 0.15, s * 0.64, s * 0.35);
    g.fillStyle = '#5a1e14';
    g.beginPath(); g.arc(x - s * 0.2, y - s * 0.15, s * 0.14, 0, Math.PI * 2); g.arc(x + s * 0.2, y - s * 0.15, s * 0.14, 0, Math.PI * 2); g.fill();
    g.fillRect(x - s * 0.04, y + s * 0.18, s * 0.08, s * 0.25);
    g.globalAlpha = 1;
  }
}
