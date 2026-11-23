import * as THREE from 'three';

const RING = 540.35;
const STEM = 62;
const STAGES: [number, string][] = [
  [0, 'Waking up…'],
  [0.12, 'Planting the grass…'],
  [0.32, 'Raising the trees…'],
  [0.52, 'Waking the butterflies…'],
  [0.72, 'Lighting the lanterns…'],
  [0.9, 'Opening the gate…'],
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Loader {
  private el = document.getElementById('loader');
  private ring = this.el?.querySelector<SVGCircleElement>('.ring-fill') ?? null;
  private stem = this.el?.querySelector<SVGPathElement>('.stem') ?? null;
  private pops = [...(this.el?.querySelectorAll<SVGElement>('.pop') ?? [])];
  private pct = this.el?.querySelector<HTMLElement>('.pct') ?? null;
  private status = this.el?.querySelector<HTMLElement>('.status') ?? null;
  private target = 0.03;
  private shown = 0;
  private stage = -1;
  private raf = 0;

  constructor() {
    if (!this.el) return;
    THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => this.bump(0.12 + 0.8 * (loaded / Math.max(1, total)));
    const tick = () => {
      this.shown += (this.target - this.shown) * 0.08 + 0.0008;
      this.shown = Math.min(this.shown, this.target);
      this.render(this.shown);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  bump(p: number) {
    this.target = Math.max(this.target, Math.min(0.97, p));
  }

  private render(p: number) {
    if (!this.el) return;
    this.ring?.setAttribute('stroke-dashoffset', (RING * (1 - p)).toFixed(2));
    this.stem?.setAttribute('stroke-dashoffset', (STEM * (1 - Math.min(1, p / 0.3))).toFixed(2));
    for (const el of this.pops) el.classList.toggle('on', p >= Number(el.dataset.at ?? 1));
    const n = Math.round(p * 100);
    if (this.pct) this.pct.textContent = `${n}%`;
    this.el.setAttribute('aria-valuenow', String(n));
    let s = 0;
    for (let i = 0; i < STAGES.length; i++) if (p >= STAGES[i][0]) s = i;
    if (s !== this.stage && this.status) {
      this.stage = s;
      const status = this.status;
      status.classList.add('swap');
      setTimeout(() => {
        status.textContent = STAGES[s][1];
        status.classList.remove('swap');
      }, 180);
    }
  }

  async finish() {
    if (!this.el) return;
    this.target = 1;
    for (let i = 0; i < 200 && this.shown < 0.995; i++) await wait(20);
    cancelAnimationFrame(this.raf);
    this.shown = 1;
    this.render(1);
    this.el.classList.add('ready');
    await wait(650);
    this.el.classList.add('out');
    await wait(900);
    this.el.remove();
  }

  fail(message: string) {
    if (!this.el) return;
    cancelAnimationFrame(this.raf);
    if (this.status) this.status.textContent = message;
  }
}
