/**
 * World layout. Tile coords: x → east, z → south (toward the camera). 1 tile = 1 world unit.
 * Edit BUILDINGS / CHESTS / roads here to reshape the village.
 */
import { hash2, valueNoise } from '../core/random';

export enum Tile { Grass = 0, Path = 1, Water = 2, Bridge = 3 }
/** What occupies a blocked tile. */
export enum Occ { None = 0, Prop = 1, Building = 2, Fixture = 3 }

export type SectionId = 'about' | 'projects' | 'skills' | 'experience' | 'contact';

export interface Building {
  id: string;
  section: SectionId;
  label: string;
  x0: number; z0: number; w: number; d: number;
  roof: string;
  accent: string;
  chimney?: boolean;
}

export interface Interactable {
  id: string;
  kind: 'door' | 'sign' | 'chest' | 'fish';
  x: number; z: number;
  range: number;
  label: string;
  labelPos: [number, number, number];
  section?: SectionId;
  index?: number;
  /** Custom dialog lines (signs). */
  text?: string[];
}

export type EnemyKind = 'jelly' | 'beetle' | 'brute';
/** Wild areas where monsters roam. The village (SAFE) is never entered by them. */
export const SPAWN_ZONES: { x0: number; z0: number; x1: number; z1: number; kinds: EnemyKind[] }[] = [
  { x0: 47, z0: 3, x1: 68, z1: 14, kinds: ['jelly', 'jelly', 'beetle'] },
  { x0: 47, z0: 21, x1: 68, z1: 40, kinds: ['beetle', 'jelly', 'brute', 'jelly'] },
  { x0: 4, z0: 38, x1: 29, z1: 54, kinds: ['jelly', 'jelly', 'beetle', 'brute'] },
  { x0: 39, z0: 43, x1: 68, z1: 54, kinds: ['brute', 'beetle', 'jelly'] },
];
/** The village: monsters stay out and the hero slowly heals here. */
export const SAFE = { x0: 0, z0: 0, x1: 45, z1: 35 };

export interface Prop { kind: 'tree' | 'bush' | 'rock'; x: number; z: number; v: number; inside: boolean }

export const WALL_H = 2.4;
export const ROOF_H = 1.7;

export const BUILDINGS: Building[] = [
  { id: 'home', section: 'about', label: 'Home · About', x0: 6, z0: 9, w: 5, d: 4, roof: '#c4573a', accent: '#3f7fbf', chimney: true },
  { id: 'guild', section: 'projects', label: "Adventurers' Guild · Projects", x0: 18, z0: 5, w: 8, d: 5, roof: '#3d66c4', accent: '#e0b040' },
  { id: 'smithy', section: 'skills', label: 'Smithy · Skills', x0: 6, z0: 22, w: 5, d: 4, roof: '#59606e', accent: '#d0603a', chimney: true },
  { id: 'library', section: 'experience', label: 'Library · Experience', x0: 26, z0: 23, w: 5, d: 4, roof: '#7a4fb0', accent: '#e8c860' },
  { id: 'post', section: 'contact', label: 'Post Office · Contact', x0: 37, z0: 11, w: 5, d: 4, roof: '#2f9488', accent: '#e05050' },
];

const CHESTS: [number, number][] = [[3, 3], [40, 33], [14, 33], [65, 6], [6, 53]];
export const SIGN: [number, number] = [19, 15];
export const FOUNTAIN = { x: 22, z: 17.5 };
/** The village gate (with the name) spans the south road just below the plaza. */
export const GATE = { x: 22, z: 22.4, span: 5.0 };

export class WorldMap {
  readonly W = 72;
  readonly H = 58;
  tiles: Uint8Array;
  occ: Uint8Array;
  flowers: Uint8Array;
  private reserved: Uint8Array;
  props: Prop[] = [];
  interactables: Interactable[] = [];
  /** Free spots for pushable crates and barrels. */
  crateSpots: { x: number; z: number; kind: 'crate' | 'barrel' }[] = [];
  start = { x: 22, z: 23.5 };
  private center: Float32Array = new Float32Array(0);

  /**
   * If (x, z) is on a riverbank or a bridge, where should the bobber land? Null otherwise.
   * Banks: cast toward the middle of the river. Bridges: cast over the downstream rail.
   */
  riverSpot(x: number, z: number): { x: number; z: number } | null {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (this.tile(tx, tz) === Tile.Bridge) {
      const side = this.tile(tx, tz + 2) === Tile.Water ? 1 : -1;
      return { x, z: z + side * 1.7 };
    }
    const c = this.riverCenter(z);
    const d = Math.abs(x - c);
    if (d < 1.4 || d > 2.9) return null;
    // the water tile between the hero and the centre must actually be river (not a bridge row)
    if (this.tile(Math.floor(c), tz) !== Tile.Water) return null;
    return { x: c + Math.sign(x - c) * 0.35, z };
  }

  /** X of the river's centre line at any z (smoothly interpolated between rows). */
  riverCenter(z: number): number {
    const zc = Math.min(this.H - 1, Math.max(0, z - 0.5));
    const z0 = Math.floor(zc), z1 = Math.min(this.H - 1, z0 + 1);
    const t = zc - z0;
    return this.center[z0] * (1 - t) + this.center[z1] * t;
  }

  constructor() {
    const n = this.W * this.H;
    this.tiles = new Uint8Array(n);
    this.occ = new Uint8Array(n);
    this.flowers = new Uint8Array(n);
    this.reserved = new Uint8Array(n);
    this.build();
  }

  isSafe(x: number, z: number) { return x < SAFE.x1 && z < SAFE.z1; }

  inside(x: number, z: number) { return x >= 0 && z >= 0 && x < this.W && z < this.H; }
  i(x: number, z: number) { return z * this.W + x; }
  tile(x: number, z: number): Tile { return this.inside(x, z) ? (this.tiles[this.i(x, z)] as Tile) : Tile.Grass; }
  isBlocked(x: number, z: number) {
    if (!this.inside(x, z)) return true;
    const i = this.i(x, z);
    return this.occ[i] !== Occ.None || this.tiles[i] === Tile.Water;
  }

  private rect(x0: number, z0: number, x1: number, z1: number, fn: (x: number, z: number, i: number) => void) {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) if (this.inside(x, z)) fn(x, z, this.i(x, z));
  }

  private road(x0: number, z0: number, x1: number, z1: number) {
    this.rect(x0, z0, x1, z1, (_x, _z, i) => {
      this.tiles[i] = this.tiles[i] === Tile.Water ? Tile.Bridge : Tile.Path;
    });
    this.rect(x0 - 1, z0 - 1, x1 + 1, z1 + 1, (_x, _z, i) => (this.reserved[i] = 1));
  }

  private build() {
    const { W, H } = this;

    for (let z = 0; z < H; z++) {
      const cx = Math.round(34 + Math.sin(z * 0.22) * 1.4 + Math.sin(z * 0.07 + 1));
      for (let x = cx - 1; x <= cx + 1; x++) if (this.inside(x, z)) this.tiles[this.i(x, z)] = Tile.Water;
    }

    this.road(2, 17, W - 3, 18);
    this.road(4, 29, 30, 30);
    this.road(21, 10, 22, 50);
    // roads into the wilds: a southern east-west road (second bridge) and an eastern loop
    this.road(6, 46, W - 8, 47);
    this.road(56, 18, 57, 46);
    this.road(18, 14, 25, 21);
    this.road(8, 13, 8, 16);
    this.road(8, 26, 8, 28);
    this.road(28, 27, 28, 28);
    this.road(39, 15, 39, 16);

    // river centre line (bridge tiles count as river)
    this.center = new Float32Array(H);
    for (let z = 0; z < H; z++) {
      let sum = 0, n = 0;
      for (let x = 0; x < W; x++) {
        const t = this.tiles[this.i(x, z)];
        if (t === Tile.Water || t === Tile.Bridge) { sum += x + 0.5; n++; }
      }
      this.center[z] = n ? sum / n : W / 2;
    }

    // riverside footpaths down to the water (you can fish from any bank; see riverSpot())
    const westBank = (z: number) => { let x = 0; while (x < W && this.tiles[this.i(x, z)] !== Tile.Water) x++; return x - 1; };
    const eastBank = (z: number) => { let x = W - 1; while (x >= 0 && this.tiles[this.i(x, z)] !== Tile.Water) x--; return x + 1; };
    const riverside = (z0: number, z1: number, bank: (z: number) => number) => {
      for (let z = z0; z <= z1; z++) { const bx = bank(z); this.road(bx, z, bx, z); }
    };
    riverside(6, 16, westBank);
    riverside(19, 26, westBank);
    riverside(19, 28, eastBank);

    const trail = (x0: number, z0: number, x1: number, z1: number) =>
      this.rect(x0, z0, x1, z1, (_x, _z, i) => (this.reserved[i] = 1));
    trail(3, 3, 3, 17);
    trail(40, 18, 40, 33);
    trail(14, 31, 14, 33);

    for (const b of BUILDINGS) {
      this.rect(b.x0, b.z0, b.x0 + b.w - 1, b.z0 + b.d - 1, (_x, _z, i) => (this.occ[i] = Occ.Building));
      this.rect(b.x0 - 1, b.z0 - 1, b.x0 + b.w, b.z0 + b.d, (_x, _z, i) => (this.reserved[i] = 1));
      const dx = b.x0 + Math.floor(b.w / 2);
      const dz = b.z0 + b.d;
      this.interactables.push({
        id: b.id, kind: 'door', section: b.section, label: b.label,
        x: dx + 0.5, z: dz + 0.5, range: 1.25,
        labelPos: [b.x0 + b.w / 2, WALL_H + ROOF_H + 1.1, b.z0 + b.d / 2],
      });
      this.rect(b.x0 - 1, dz, b.x0 + b.w, dz + 1, (x, z, i) => {
        if (this.tiles[i] === Tile.Grass && hash2(x, z, 21) < 0.6) this.flowers[i] = 1;
      });
      // crates/barrels beside the front corners
      const spots: [number, number][] = [[b.x0 - 0.55, b.z0 + b.d - 0.4], [b.x0 + b.w + 0.55, b.z0 + b.d - 0.4]];
      spots.forEach(([x, z], k) => {
        if (!this.isBlocked(Math.floor(x), Math.floor(z)) && this.tile(Math.floor(x), Math.floor(z)) === Tile.Grass)
          this.crateSpots.push({ x, z, kind: k === 0 ? 'barrel' : 'crate' });
      });
    }
    // plaza corners
    this.crateSpots.push({ x: 18.6, z: 14.6, kind: 'crate' }, { x: 19.3, z: 14.5, kind: 'crate' }, { x: 25.4, z: 14.6, kind: 'barrel' }, { x: 24.7, z: 14.5, kind: 'barrel' });

    this.rect(21, 16, 22, 18, (_x, _z, i) => (this.occ[i] = Occ.Fixture)); // fountain
    for (const side of [-1, 1]) this.occ[this.i(Math.floor(GATE.x + side * GATE.span / 2), Math.floor(GATE.z))] = Occ.Fixture; // gate pillars
    this.occ[this.i(SIGN[0], SIGN[1])] = Occ.Fixture;
    this.interactables.push({
      id: 'sign', kind: 'sign', label: 'Signpost',
      x: SIGN[0] + 0.5, z: SIGN[1] + 0.5, range: 1.5,
      labelPos: [SIGN[0] + 0.5, 2.3, SIGN[1] + 0.5],
    });

    // warning signs where the roads leave the village
    for (const [id, x, z] of [['warn-east', 45, 15], ['warn-south', 23, 35]] as [string, number, number][]) {
      this.occ[this.i(x, z)] = Occ.Fixture;
      this.interactables.push({
        id, kind: 'sign', label: 'Warning sign',
        x: x + 0.5, z: z + 0.5, range: 1.5,
        labelPos: [x + 0.5, 2.3, z + 0.5],
      });
    }

    CHESTS.forEach(([x, z], index) => {
      this.occ[this.i(x, z)] = Occ.Fixture;
      this.rect(x - 1, z - 1, x + 1, z + 1, (_x, _z, i) => (this.reserved[i] = 1));
      this.interactables.push({
        id: `chest-${index}`, kind: 'chest', label: 'Treasure', index,
        x: x + 0.5, z: z + 0.5, range: 1.5,
        labelPos: [x + 0.5, 1.6, z + 0.5],
      });
    });

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const i = this.i(x, z);
        if (this.tiles[i] !== Tile.Grass || this.occ[i]) continue;
        const border = x < 2 || z < 2 || x >= W - 2 || z >= H - 2;
        const h = hash2(x, z, 1);
        if (!border && this.reserved[i]) {
          if (h < 0.08) this.flowers[i] = 1;
          continue;
        }
        const forest = valueNoise(x / 5, z / 5, 11) > 0.62;
        const nearWater = this.near(x, z, Tile.Water);
        const meadow = SPAWN_ZONES.some((zn) => x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1);
        const treeP = meadow ? (forest ? 0.35 : 0.025) : forest ? 0.6 : 0.06;
        const bushP = treeP + (meadow ? 0.07 : forest ? 0.06 : 0.04);
        if (border || h < treeP) this.addProp('tree', x, z);
        else if (h < bushP) this.addProp('bush', x, z);
        else if (h < (nearWater ? 0.2 : 0.115)) this.addProp('rock', x, z);
        else if (h > 0.9) this.flowers[i] = 1;
      }
    }

    // decorative forest on the hills outside the map
    for (let z = -12; z < H + 8; z++)
      for (let x = -12; x < W + 12; x++) {
        if (this.inside(x, z)) continue;
        if (hash2(x, z, 2) < 0.7)
          this.props.push({
            kind: 'tree', inside: false,
            x: x + 0.5 + (hash2(x, z, 3) - 0.5) * 0.8,
            z: z + 0.5 + (hash2(x, z, 4) - 0.5) * 0.8,
            v: Math.floor(hash2(x, z, 5) * 4),
          });
      }
  }

  private near(x: number, z: number, t: Tile) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.tile(x + dx, z + dz) === t) return true;
    return false;
  }

  private addProp(kind: Prop['kind'], x: number, z: number) {
    this.occ[this.i(x, z)] = Occ.Prop;
    this.props.push({
      kind, inside: true,
      x: x + 0.5 + (hash2(x, z, 6) - 0.5) * 0.3,
      z: z + 0.5 + (hash2(x, z, 7) - 0.5) * 0.3,
      v: Math.floor(hash2(x, z, 8) * 4),
    });
  }
}
