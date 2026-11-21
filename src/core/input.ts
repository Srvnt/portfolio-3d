const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
export const INTERACT_KEYS = new Set(['KeyE', 'Space', 'Enter']);

/** Keyboard state: held keys for movement, a queue of fresh presses for actions. */
export class Input {
  private held = new Set<string>();
  private fresh: string[] = [];
  /** When true, Space/arrows keep their default browser behaviour (scrolling panels). */
  allowDefaults = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.allowDefaults && (MOVE_KEYS.has(e.code) || e.code === 'Space')) e.preventDefault();
      if (!e.repeat) this.fresh.push(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Analogue stick from touch controls, x/z in [-1, 1]. */
  stick = { x: 0, z: 0 };

  /** Movement vector in world space (x right, z toward camera) plus run flag. */
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

  /** Inject a key press (touch buttons). */
  press(code: string) { this.fresh.push(code); }

  /** Returns and clears the key presses since the last call. */
  drain(): string[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
}
