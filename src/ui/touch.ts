import { Input } from '../core/input';

/** Floating virtual joystick (left side) + action button for touch screens. */
export function setupTouch(input: Input, canvas: HTMLCanvasElement) {
  const stick = document.getElementById('stick')!;
  const knob = stick.querySelector('.knob') as HTMLElement;
  const action = document.getElementById('action') as HTMLButtonElement;
  const R = 52;
  let id: number | null = null;
  let ox = 0;
  let oy = 0;

  const isTouch = () => matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', isTouch());

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || id !== null) return;
    document.body.classList.add('touch');
    id = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    stick.style.transform = `translate(${ox - 60}px, ${oy - 60}px)`;
    stick.classList.add('on');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.stick.x = dx / R;
    input.stick.z = dy / R;
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    input.stick.x = input.stick.z = 0;
    knob.style.transform = '';
    stick.classList.remove('on');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  action.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.press('KeyE');
  });
}
