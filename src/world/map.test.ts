import { describe, expect, it } from 'vitest';
import { GATE, SAFE, SPAWN_ZONES, Tile, WorldMap } from './map';

const map = new WorldMap();

function reachableTiles(m: WorldMap) {
  const seen = new Uint8Array(m.W * m.H);
  const start: [number, number] = [Math.floor(m.start.x), Math.floor(m.start.z)];
  const queue = [start];
  seen[m.i(...start)] = 1;
  while (queue.length) {
    const [x, z] = queue.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!m.inside(nx, nz) || seen[m.i(nx, nz)] || m.isBlocked(nx, nz)) continue;
      seen[m.i(nx, nz)] = 1;
      queue.push([nx, nz]);
    }
  }
  return seen;
}

describe('world map', () => {
  const seen = reachableTiles(map);
  const canReach = (x: number, z: number) =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const tx = Math.floor(x) + dx, tz = Math.floor(z) + dz;
      return map.inside(tx, tz) && seen[map.i(tx, tz)] === 1;
    });

  it('has the expanded size', () => {
    expect(map.W).toBe(72);
    expect(map.H).toBe(58);
  });

  it('starts the hero on open ground inside the village', () => {
    expect(map.isBlocked(Math.floor(map.start.x), Math.floor(map.start.z))).toBe(false);
    expect(map.isSafe(map.start.x, map.start.z)).toBe(true);
  });

  it('lets the hero walk to every door, sign, chest and the elder', () => {
    const unreachable = map.interactables.filter((it) => !canReach(it.x, it.z)).map((it) => it.id);
    expect(unreachable).toEqual([]);
  });

  it('has exactly one elder and five doors', () => {
    expect(map.interactables.filter((it) => it.kind === 'npc')).toHaveLength(1);
    expect(map.interactables.filter((it) => it.kind === 'door')).toHaveLength(5);
  });

  it('keeps monster zones outside the village with plenty of open ground', () => {
    for (const zone of SPAWN_ZONES) {
      expect(zone.x0 >= SAFE.x1 || zone.z0 >= SAFE.z1).toBe(true);
      let free = 0, total = 0;
      for (let z = zone.z0; z <= zone.z1; z++)
        for (let x = zone.x0; x <= zone.x1; x++) {
          total++;
          if (!map.isBlocked(x, z)) free++;
        }
      expect(free / total).toBeGreaterThan(0.5);
    }
  });

  it('puts a bridge wherever a road crosses the river', () => {
    const bridgeRows = new Set<number>();
    for (let z = 0; z < map.H; z++)
      for (let x = 0; x < map.W; x++) if (map.tile(x, z) === Tile.Bridge) bridgeRows.add(z);
    expect([...bridgeRows].sort((a, b) => a - b)).toEqual([17, 18, 46, 47]);
  });

  it('casts the bobber into water from a riverbank and refuses far from the river', () => {
    const z = 12.5;
    const c = map.riverCenter(z);
    const spot = map.riverSpot(c - 2.1, z);
    expect(spot).not.toBeNull();
    expect(map.tile(Math.floor(spot!.x), Math.floor(spot!.z))).toBe(Tile.Water);
    expect(map.riverSpot(c - 8, z)).toBeNull();
  });

  it('casts over the rail from a bridge', () => {
    const spot = map.riverSpot(map.riverCenter(17.5), 17.5);
    expect(spot).not.toBeNull();
    expect(map.tile(Math.floor(spot!.x), Math.floor(spot!.z))).toBe(Tile.Water);
  });

  it('blocks the gate pillars but leaves the walkway open', () => {
    const z = Math.floor(GATE.z);
    expect(map.isBlocked(Math.floor(GATE.x - GATE.span / 2), z)).toBe(true);
    expect(map.isBlocked(Math.floor(GATE.x + GATE.span / 2), z)).toBe(true);
    expect(map.isBlocked(21, z)).toBe(false);
    expect(map.isBlocked(22, z)).toBe(false);
  });

  it('generates the same world every time', () => {
    const again = new WorldMap();
    expect(again.props.length).toBe(map.props.length);
    expect(again.props.slice(0, 20)).toEqual(map.props.slice(0, 20));
  });
});
