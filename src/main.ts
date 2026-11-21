import './style.css';
import * as THREE from 'three';
import { BUILDINGS, Interactable, WorldMap } from './world/map';
import { createRenderer } from './render/setup';
import { createTerrain } from './world/terrain';
import { createWater } from './world/water';
import { createGrass } from './world/grass';
import { createNature } from './world/nature';
import { createGroundDetails } from './world/decals';
import { animateFlags, createBuilding } from './world/buildings';
import { Chest, createBridges, createFountain, createLetters, createPushables, createSign } from './world/props';
import { Butterflies, createFallingLeaves, createMotes, Puffs } from './fx/particles';
import { uniforms } from './world/shared';
import { Physics } from './physics';
import { Hero } from './hero';
import { Input, INTERACT_KEYS } from './core/input';
import { setupTouch } from './ui/touch';
import { UI } from './ui/ui';
import { content } from './content';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const startText = document.querySelector('.title-start') as HTMLElement;

async function init() {
  // let the title screen paint before the heavy world build
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const { renderer, scene, camera, composer, followSun, lowEnd } = createRenderer(canvas);
  const map = new WorldMap();
  const physics = new Physics(map);

  scene.add(createTerrain(map));
  scene.add(createWater(map));
  scene.add(createGrass(map, lowEnd ? 28 : 64));
  scene.add(createNature(map, lowEnd));
  scene.add(createGroundDetails(map));
  scene.add(createFallingLeaves(map, lowEnd ? 120 : 240));
  scene.add(createBridges(map));
  scene.add(createFountain());
  const chimneys: THREE.Vector3[] = [];
  const town = new THREE.Group();
  for (const b of BUILDINGS) {
    const r = createBuilding(b);
    town.add(r.group);
    if (r.chimneyTop) chimneys.push(r.chimneyTop);
  }
  scene.add(town);
  scene.add(createPushables(map, physics));
  scene.add(createLetters(content.profile.name, physics));

  const chests = new Map<string, Chest>();
  for (const it of map.interactables) {
    if (it.kind === 'sign') scene.add(createSign(it.x, it.z - 0.1));
    if (it.kind === 'chest') {
      const c = new Chest(it.x, it.z);
      chests.set(it.id, c);
      scene.add(c.group);
    }
  }

  const smoke = new Puffs(40, '#f4f1ec', 0.55);
  const dust = new Puffs(30, '#d8c49a', 0.6);
  const butterflies = new Butterflies(map, lowEnd ? 6 : 12);
  scene.add(createMotes(map, lowEnd ? 140 : 260), smoke.group, dust.group, butterflies.group);

  const hero = new Hero(map.start.x, map.start.z, physics);
  hero.face(map.start.x, map.start.z - 1);
  scene.add(hero.group);

  // ---------------------------------------------------------------- state
  type State = 'title' | 'intro' | 'play' | 'dialog' | 'panel';
  let state: State = 'title';
  const input = new Input();
  const ui = new UI(content);
  ui.setLabels(map.interactables);
  ui.onPanelClose = () => { state = 'play'; input.allowDefaults = false; };
  setupTouch(input, canvas);

  startText.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap to begin' : 'Press any key to begin';
  let introT = 0;
  ui.waitForStart().then(() => {
    input.drain();
    state = 'intro';
  });

  const nearest = (): Interactable | null => {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of map.interactables) {
      const d = Math.hypot(it.x - hero.x, it.z - hero.z);
      if (d < it.range && d < bestD) { best = it; bestD = d; }
    }
    return best;
  };

  const interact = (it: Interactable) => {
    hero.face(it.x, it.z);
    hero.stop();
    if (it.kind === 'door' && it.section) {
      state = 'panel';
      input.allowDefaults = true;
      ui.openPanel(it.section);
    } else if (it.kind === 'sign') {
      state = 'dialog';
      ui.dialog('Signpost', content.sign, () => (state = 'play'));
    } else if (it.kind === 'chest') {
      const chest = chests.get(it.id)!;
      const already = chest.opened;
      chest.open();
      state = 'dialog';
      ui.dialog('Treasure', [already ? 'The chest is empty… you already found this one.' : content.secrets[it.index ?? 0] ?? '…'], () => (state = 'play'));
    }
  };

  // ---------------------------------------------------------------- camera
  const PITCH = THREE.MathUtils.degToRad(48);
  const DIST = 19;
  const offset = () => {
    const d = camera.aspect < 0.8 ? DIST * 0.95 : DIST;
    return new THREE.Vector3(0, Math.sin(PITCH) * d, Math.cos(PITCH) * d);
  };
  const focus = new THREE.Vector3(hero.x, 0, hero.z);
  const center = new THREE.Vector3(map.W / 2, 0, map.H / 2);
  const orbitPos = (t: number) => new THREE.Vector3(center.x + Math.sin(t * 0.06) * 28, 20, center.z + Math.cos(t * 0.06) * 28);
  let orbitFrom = new THREE.Vector3();
  const clampFocus = (v: THREE.Vector3) => {
    v.x = THREE.MathUtils.clamp(v.x, 5, map.W - 5);
    v.z = THREE.MathUtils.clamp(v.z, 3, map.H - 1);
  };
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let smokeT = 0;
  let dustT = 0;
  const lookTmp = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;

    const presses = input.drain();
    const near = state === 'play' ? nearest() : null;

    if (state === 'play') {
      hero.drive(input.axis(), dt);
      if (near && presses.some((k) => INTERACT_KEYS.has(k))) interact(near);
    } else {
      hero.drive({ x: 0, z: 0, run: false }, dt);
      if (state === 'dialog') {
        if (presses.includes('Escape')) ui.closeDialog();
        else if (presses.some((k) => INTERACT_KEYS.has(k))) ui.advance();
      } else if (state === 'panel' && (presses.includes('Escape') || presses.includes('KeyE'))) {
        ui.closePanel();
      }
    }

    physics.step(dt);
    hero.animate(dt, t);
    uniforms.uHero.value.set(hero.x, hero.z);
    for (const c of chests.values()) c.update(dt, t);
    animateFlags(town, t);
    butterflies.update(t);

    smokeT += dt;
    if (smokeT > 0.3) {
      smokeT = 0;
      for (const c of chimneys)
        smoke.emit(c, new THREE.Vector3(0.25 + Math.random() * 0.1, 0.7, -0.1), 3.2, 0.35 + Math.random() * 0.15, 0.45);
    }
    dustT += dt;
    if (hero.speed > 1 && dustT > (hero.speed > 5.5 ? 0.06 : 0.22)) {
      dustT = 0;
      dust.emit(
        new THREE.Vector3(hero.x + (Math.random() - 0.5) * 0.3, 0.08, hero.z + (Math.random() - 0.5) * 0.3),
        new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5, (Math.random() - 0.5) * 0.4),
        0.55, hero.speed > 5.5 ? 0.6 : 0.4, 1.4,
      );
    }
    smoke.update(dt);
    dust.update(dt);
    ui.updateDialog(dt);

    // camera
    const follow = new THREE.Vector3(hero.x + hero.body.velocity.x * 0.18, 0, hero.z + hero.body.velocity.z * 0.18);
    clampFocus(follow);
    focus.lerp(follow, 1 - Math.exp(-dt * 4));
    const followPos = focus.clone().add(offset());
    if (state === 'title') {
      camera.position.copy(orbitPos(t));
      camera.lookAt(center);
      orbitFrom = camera.position.clone();
      focus.copy(follow);
      followSun(center);
    } else if (state === 'intro') {
      introT = Math.min(1, introT + dt / 2.6);
      const k = ease(introT);
      camera.position.lerpVectors(orbitFrom, followPos, k);
      lookTmp.lerpVectors(center, focus, k);
      camera.lookAt(lookTmp);
      followSun(lookTmp);
      if (introT >= 1) state = 'play';
    } else {
      camera.position.copy(followPos);
      camera.lookAt(focus);
      followSun(focus);
    }

    ui.updateLabels(map.interactables, camera, near?.id ?? null, state !== 'play');
    composer.render(dt);
  });

  if (import.meta.env.DEV) Object.assign(window, { __dbg: { scene, camera, renderer, hero, map, physics } });
}

init().catch((err) => {
  console.error(err);
  startText.textContent = 'Something went wrong loading the world.';
});
