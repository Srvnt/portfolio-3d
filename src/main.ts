import './style.css';
import * as THREE from 'three';
import { BUILDINGS, Interactable, Tile, WorldMap } from './world/map';
import { createRenderer } from './render/setup';
import { createTerrain } from './world/terrain';
import { createWater } from './world/water';
import { createGrass } from './world/grass';
import { createNature, cutBushes, regrowBushes, treesNear } from './world/nature';
import { createGroundDetails } from './world/decals';
import { animateFlags, createBuilding } from './world/buildings';
import { Chest, createBridges, createFountain, createGate, createLanterns, createPushables, createSign } from './world/props';
import { School, SPECIES } from './world/fish';
import { Fishing } from './fishing';
import { Enemies } from './combat/enemies';
import { Hearts } from './combat/pickups';
import { Minimap } from './ui/minimap';
import { addWeatherCover, WeatherFX } from './fx/weather';
import { WeatherUI } from './ui/weather-ui';
import { Butterflies, createFallingLeaves, createMotes, Puffs, Ripples, Swoosh } from './fx/particles';
import { uniforms } from './world/shared';
import { Physics } from './physics';
import { Hero } from './hero';
import { ATTACK_KEYS, Input, INTERACT_KEYS, USE_KEYS } from './core/input';
import { setupTouch } from './ui/touch';
import { UI } from './ui/ui';
import { content } from './content';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const startText = document.querySelector('.title-start') as HTMLElement;

async function init() {
  // let the title screen paint before the heavy world build
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const { renderer, scene, camera, composer, sun, hemi, bloom, sunOffset, followSun, lowEnd } = createRenderer(canvas);
  const map = new WorldMap();
  const physics = new Physics(map);

  scene.add(createTerrain(map));
  scene.add(createWater(map));
  scene.add(createGrass(map, lowEnd ? 24 : 50));
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
  const gate = createGate(content.profile.name, physics);
  scene.add(gate.group);

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

  // river life + fishing
  const splash = new Puffs(30, '#eaf8ff', 0.85);
  const ripples = new Ripples(18);
  const school = new School(map, Math.max(12, SPECIES.length * 3));
  school.onSplash = (p, big) => {
    ripples.emit(p, big ? 0.9 : 0.5);
    for (let i = 0; i < (big ? 5 : 3); i++)
      splash.emit(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8), 0.45, 0.1, 1.2);
  };
  scene.add(school.group, splash.group, ripples.group);

  // sword: trail, leaf bursts, knock-back, cutting bushes
  const swoosh = new Swoosh();
  const leafBurst = new Puffs(80, '#6fbf4a', 0.95, 5);
  scene.add(swoosh.group, leafBurst.group);
  let shake = 0;
  const burst = (x: number, y: number, z: number, n: number, spread = 2.4) => {
    for (let i = 0; i < n; i++)
      leafBurst.emit(
        new THREE.Vector3(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.6),
        new THREE.Vector3((Math.random() - 0.5) * spread, 1.2 + Math.random() * 2, (Math.random() - 0.5) * spread),
        1.3 + Math.random() * 0.6, 0.28 + Math.random() * 0.2, 0,
      );
  };
  // ---------------------------------------------------------------- combat
  const enemies = new Enemies(map, lowEnd ? 12 : 18);
  const hearts = new Hearts();
  const shockRings = new Ripples(6, '#ffb070', 0.3);
  const poof = new Puffs(40, '#f4e8ff', 0.9);
  scene.add(enemies.group, hearts.group, shockRings.group, poof.group);
  let hitStop = 0;
  let downT = 0;
  const heroTop = () => new THREE.Vector3(hero.x, 1.6, hero.z);
  enemies.onHeroHit = (dmg, fx, fz) => {
    if (!hero.hurt(dmg, fx, fz)) return;
    ui.damageNumber(heroTop(), `-${dmg}`, 'hero', camera);
    shake = 0.28;
    hitStop = 0.05;
    if (state === 'fishing') { fishing.stop(); state = 'play'; }
  };
  enemies.onShockwave = (x, z, r) => {
    shockRings.emit(new THREE.Vector3(x, 0, z), r * 1.1, 0.45);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      dust.emit(new THREE.Vector3(x + Math.cos(a) * 0.6, 0.1, z + Math.sin(a) * 0.6), new THREE.Vector3(Math.cos(a) * 3, 0.6, Math.sin(a) * 3), 0.5, 0.45, 1.5);
    }
    if (Math.hypot(hero.x - x, hero.z - z) < 7) shake = Math.max(shake, 0.2);
  };
  enemies.onStep = (x, z) => dust.emit(new THREE.Vector3(x, 0.1, z), new THREE.Vector3((Math.random() - 0.5), 0.5, (Math.random() - 0.5)), 0.5, 0.35, 1.3);
  enemies.onDeath = (e) => {
    for (let i = 0; i < 12; i++)
      poof.emit(new THREE.Vector3(e.x, 0.4 + Math.random() * 0.5, e.z), new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3), 0.6, 0.5, 1.4);
    if (Math.random() < (e.kind === 'brute' ? 0.9 : 0.4)) hearts.drop(e.x, e.z);
  };

  hero.onSlash = (c, fwd, combo) => {
    const r = combo === 2 ? 1.45 : 1.2;
    const hits = enemies.slash(c, r, fwd, combo, hero.x, hero.z);
    for (const h of hits) {
      ui.damageNumber(new THREE.Vector3(h.enemy.x, h.enemy.stats.barY * h.enemy.size + 0.2, h.enemy.z), h.crit ? `${h.dmg}!` : `${h.dmg}`, h.crit ? 'crit' : 'hit', camera);
      for (let i = 0; i < 4; i++)
        poof.emit(new THREE.Vector3(h.enemy.x, 0.5, h.enemy.z), new THREE.Vector3(fwd.x * 2 + (Math.random() - 0.5) * 2, 1 + Math.random(), fwd.z * 2 + (Math.random() - 0.5) * 2), 0.3, 0.25, 0.5);
    }
    if (hits.length) {
      hitStop = hits.some((h) => h.crit || h.killed) ? 0.1 : 0.06;
      shake = Math.max(shake, hits.some((h) => h.crit) ? 0.22 : 0.14);
    }
    const knocked = physics.impulseNear(c, r, fwd, combo === 2 ? 4.5 : 3.2);
    const cut = cutBushes(c, r * 0.85, clock.elapsedTime);
    for (const p of cut) { physics.setPropSolid(p, false); burst(p.x, 0.35, p.z, 16); }
    for (const tr of treesNear(c, 1.4)) burst(tr.x, 2.1, tr.z, 9, 1.2);
    uniforms.uHit.value.set(c.x, c.z, 1);
    // small lunge into the swing
    hero.body.velocity.x += fwd.x * 2.2;
    hero.body.velocity.z += fwd.z * 2.2;
    if (knocked || cut.length) shake = combo === 2 ? 0.16 : 0.1;
  };
  const fishing = new Fishing(scene, hero, school, splash, ripples);
  const caughtFacts = new Set<number>();
  // a floating "Fish here" prompt that follows the hero along any riverbank
  const riverPrompt: Interactable = { id: 'river', kind: 'fish', x: 0, z: 0, range: 0.5, label: 'Fish here', labelPos: [0, 2.2, 0] };
  let riverCast: { x: number; z: number } | null = null;
  let shownAllCaught = false;

  // ---------------------------------------------------------------- state
  type State = 'title' | 'intro' | 'play' | 'dialog' | 'panel' | 'fishing' | 'down';
  let state: State = 'title';
  const input = new Input();
  const ui = new UI(content);
  const minimap = new Minimap(map);

  // weather: snow settles / ground gets wet on world surfaces (not on characters)
  const lanterns = createLanterns(physics, lowEnd ? 2 : 4);
  scene.add(lanterns.group);
  const weather = new WeatherFX(scene, sun, hemi, bloom, renderer, sunOffset);
  scene.add(weather.group);
  const skip = new Set<THREE.Object3D>([hero.group, enemies.group, school.group, hearts.group]);
  scene.traverse((o) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (skip.has(p)) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(addWeatherCover);
  });
  const weatherUI = new WeatherUI(weather, { name: content.weather.place, lat: content.weather.lat, lon: content.weather.lon });
  const chestMarkers = map.interactables.filter((it) => it.kind === 'chest').map((it) => ({ x: it.x, z: it.z, id: it.id }));
  const labelled = [...map.interactables, riverPrompt];
  ui.setLabels(labelled);
  ui.onPanelClose = () => { state = 'play'; input.allowDefaults = false; };
  setupTouch(input, canvas);
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) input.press('Attack'); });

  startText.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap to begin' : 'Press any key to begin';
  let introT = 0;
  ui.waitForStart().then(() => {
    input.drain();
    state = 'intro';
    ui.showHud(content.profile.name);
    minimap.show();
    weatherUI.show();
  });

  const nearest = (): Interactable | null => {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of map.interactables) {
      const d = Math.hypot(it.x - hero.x, it.z - hero.z);
      if (d < it.range && d < bestD) { best = it; bestD = d; }
    }
    if (best) return best;
    // otherwise: can we fish from here?
    riverCast = map.riverSpot(hero.x, hero.z);
    if (!riverCast) return null;
    riverPrompt.x = hero.x;
    riverPrompt.z = hero.z;
    riverPrompt.labelPos = [hero.x, 2.3, hero.z];
    return riverPrompt;
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
      const warn = it.id.startsWith('warn');
      ui.dialog(warn ? 'Warning' : 'Signpost', warn ? content.warning : content.sign, () => (state = 'play'));
    } else if (it.kind === 'chest') {
      const chest = chests.get(it.id)!;
      const already = chest.opened;
      chest.open();
      state = 'dialog';
      ui.dialog('Treasure', [already ? 'The chest is empty… you already found this one.' : content.secrets[it.index ?? 0] ?? '…'], () => (state = 'play'));
    } else if (it.kind === 'fish' && riverCast) {
      state = 'fishing';
      fishing.start(riverCast);
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
  const orbitPos = (t: number) => new THREE.Vector3(center.x + Math.sin(t * 0.05) * 40, 28, center.z + Math.cos(t * 0.05) * 40);
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
    let dt = Math.min(clock.getDelta(), 1 / 20);
    // hit stop: a split-second freeze that sells the impact
    if (hitStop > 0) { hitStop -= dt; dt *= 0.06; }
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;

    const presses = input.drain();
    const near = state === 'play' ? nearest() : null;

    if (state === 'play') {
      const ax = input.axis();
      // you can still steer while swinging, just slowly
      hero.drive(hero.attacking ? { x: ax.x * 0.3, z: ax.z * 0.3, run: false } : ax, dt);
      if (presses.some((k) => ATTACK_KEYS.has(k))) hero.attack();
      else if (near && presses.some((k) => USE_KEYS.has(k))) interact(near);
    } else {
      hero.drive({ x: 0, z: 0, run: false }, dt);
      if (state === 'dialog') {
        if (presses.includes('Escape')) ui.closeDialog();
        else if (presses.some((k) => INTERACT_KEYS.has(k))) ui.advance();
      } else if (state === 'down') {
        downT += dt;
        if (downT > 1.4) {
          state = 'dialog';
          ui.dialog('Ouch!', ['You fainted… Kind villagers carried you back to the plaza. Rest up and try again!'], () => {
            hero.revive(map.start.x, map.start.z);
            state = 'play';
          });
        }
      } else if (state === 'panel' && (presses.includes('Escape') || presses.includes('KeyE'))) {
        ui.closePanel();
      } else if (state === 'fishing') {
        const ax = input.axis();
        if (presses.includes('Escape') || ax.x || ax.z) {
          fishing.stop(); // walking away or Esc reels the line in
          state = 'play';
        } else {
          const res = fishing.update(dt, t, presses.some((k) => INTERACT_KEYS.has(k)));
          if (res?.kind === 'caught') {
            const idx = res.fish.species % Math.max(1, content.fish.length);
            const info = content.fish[idx] ?? { name: 'Fish', fact: '…' };
            caughtFacts.add(idx);
            const all = caughtFacts.size >= content.fish.length;
            state = 'dialog';
            ui.dialog(`You caught a ${info.name}! · ${caughtFacts.size}/${content.fish.length}`,
              all && caughtFacts.size === content.fish.length && !shownAllCaught
                ? [info.fact, 'You have caught every kind of fish in the river. Thanks for getting to know me!']
                : [info.fact],
              () => (state = 'play'));
            if (all) shownAllCaught = true;
          } else if (res?.kind === 'early') {
            state = 'dialog';
            ui.dialog('Too soon!', ['Those were only nibbles. Wait for the real bite: the meter and the ! appear.'], () => (state = 'play'));
          } else if (res?.kind === 'late') {
            state = 'dialog';
            ui.dialog('It got away!', ['The fish stole the bait. When the meter appears, press E while the needle is in the green.'], () => (state = 'play'));
          } else if (res?.kind === 'slip') {
            state = 'dialog';
            ui.dialog('It slipped off the hook!', ['So close! Time your press so the needle is inside the green zone. Quick fish are trickier.'], () => (state = 'play'));
          }
        }
      }
    }

    physics.step(dt);
    if (hero.down && state === 'play') { state = 'down'; downT = 0; }
    enemies.update(dt, t, { x: hero.x, z: hero.z, alive: !hero.down }, camera, state === 'play' || state === 'fishing');
    enemies.pushFrom(hero.x, hero.z, 0.34);
    shockRings.update(dt);
    poof.update(dt);
    const pick = hearts.update(dt, t, hero.x, hero.z);
    if (pick.healed && pick.at) { hero.heal(pick.healed); ui.damageNumber(pick.at, `+${pick.healed}`, 'heal', camera); }
    // the village is a safe haven: slowly heal there
    if (!hero.down && map.isSafe(hero.x, hero.z) && hero.hp < hero.maxHp) hero.heal(6 * dt);
    ui.setHp(hero.hp, hero.maxHp);
    weather.update(dt, focus);
    lanterns.setNight(weather.night, t);
    gate.setNight(weather.night, t);
    gate.animate(t, weather.current.wind);
    // raindrops dimpling the river near the hero
    if (weather.current.rain > 0.1 && Math.random() < dt * 30 * weather.current.rain) {
      const rx = hero.x + (Math.random() - 0.5) * 24, rz = hero.z + (Math.random() - 0.5) * 18;
      if (map.tile(Math.floor(rx), Math.floor(rz)) === Tile.Water) ripples.emit(new THREE.Vector3(rx, 0, rz), 0.25, 0.6);
    }
    minimap.update({
      hero: { x: hero.x, z: hero.z, heading: hero.heading },
      enemies: enemies.list.map((e) => ({ x: e.x, z: e.z, kind: e.kind, alive: e.state !== 'dead' })),
      chests: chestMarkers.map((c) => ({ x: c.x, z: c.z, opened: chests.get(c.id)?.opened ?? false })),
    });
    uniforms.uHit.value.z *= Math.exp(-dt * 3);
    for (const p of regrowBushes(t, (b) => Math.hypot(b.x - hero.x, b.z - hero.z) > 0.95)) physics.setPropSolid(p, true);
    leafBurst.update(dt);
    school.update(dt, t);
    ripples.update(dt);
    splash.update(dt);
    hero.animate(dt, t);
    swoosh.update(dt, hero.x, hero.group.position.y, hero.z, hero.swing);
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
      if (shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        shake *= Math.exp(-dt * 18);
      }
      camera.lookAt(focus);
      followSun(focus);
    }

    ui.updateLabels(labelled, camera, near?.id ?? null, state !== 'play');
    ui.fishHint(state === 'fishing' && fishing.hint ? (fishing.meter ? fishing.hint : `${fishing.hint}  ·  Esc to stop`) : null);
    ui.fishAlert(state === 'fishing' ? fishing.alertAt : null, camera);
    ui.fishMeter(state === 'fishing' ? fishing.meter : null);
    composer.render(dt);
  });

  if (import.meta.env.DEV) Object.assign(window, { __dbg: { scene, camera, renderer, hero, map, physics, fishing, school, enemies } });
}

init().catch((err) => {
  console.error(err);
  startText.textContent = 'Something went wrong loading the world.';
});
