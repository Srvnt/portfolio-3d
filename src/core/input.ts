const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
export const INTERACT_KEYS = new Set(['KeyE', 'Space', 'Enter']);
export const USE_KEYS = new Set(['KeyE', 'Enter']);
export const ATTACK_KEYS = new Set(['Space', 'KeyJ', 'Attack']);

export class Input {
  private held = new Set<string>();
  private fresh: string[] = [];
  allowDefaults = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (!this.allowDefaults && (MOVE_KEYS.has(e.code) || e.code === 'Space')) e.preventDefault();
      if (!e.repeat) this.fresh.push(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  stick = { x: 0, z: 0 };

  axis(): { x: number; z: number; run: boolean } {
    const h = this.held;
    let x = (h.has('KeyD') || h.has('ArrowRight') ? 1 : 0) - (h.has('KeyA') || h.has('ArrowLeft') ? 1 : 0);
    let z = (h.has('KeyS') || h.has('ArrowDown') ? 1 : 0) - (h.has('KeyW') || h.has('ArrowUp') ? 1 : 0);
    let run = h.has('ShiftLeft') || h.has('ShiftRight');
    if (x === 0 && z === 0 && (this.stick.x || this.stick.z)) {
      x = this.stick.x;
      z = this.stick.z;
      run = Math.hypot(x, z) > 0.95;
    }
    return { x, z, run };
  }

  press(code: string) { this.fresh.push(code); }

  drain(): string[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
}
