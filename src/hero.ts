import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Physics } from './physics';
import { HeroAssets } from './hero-assets';
import { uniforms } from './world/shared';

const SPEED = 3.6;
const RUN = 6.4;
const RADIUS = 0.34;
const HEIGHT = 1.4;
const ATTACK_DUR = [0.5, 0.5, 0.66];
const ATTACKS = ['Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal'];
const ATTACK_START = [0.12, 0.1, 0.1];
const LOCO = ['Idle_A', 'Walking_A', 'Running_A'];
const WALK_PACE = 1.25;
const RUN_PACE = 3.6;

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function addRim(m: THREE.MeshStandardMaterial, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void) {
  m.onBeforeCompile = (shader) => {
    extra?.(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += vec3(1.0, 0.92, 0.78) * pow(rimF, 3.0) * 0.22;`,
    );
  };
  m.customProgramCacheKey = () => `hero-${m.name}-${extra ? 'cape' : 'body'}`;
}

export class Hero {
  group = new THREE.Group();
  body: CANNON.Body;
  speed = 0;
  private model = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private locoW = new Map<string, number>();
  private oneShot: THREE.AnimationAction | null = null;
  private oneShotW = 0;
  private fishIdle: THREE.AnimationAction | null;
  private fishReel: THREE.AnimationAction | null;
  private poseW = 0;
  private reelW = 0;
  private capeUniforms = { uCapeBlow: { value: 0 }, uCapeTurn: { value: 0 } };
  private yaw = 0;
  fishing = false;
  reeling = false;
  cast = 1;
  private castPlayed = false;
  private rod = new THREE.Group();
  private rodTipObj = new THREE.Object3D();
  private sword = new THREE.Group();
  private lastYaw = 0;
  private attackT = -1;
  private combo = 0;
  private queued = false;
  private hitDone = false;
  private lastSwingEnd = -10;
  private clock = 0;
  onSlash: (center: THREE.Vector3, forward: THREE.Vector3, combo: number) => void = () => {};
  maxHp = 100;
  hp = 100;
  private invuln = 0;
  down = false;
  swing: { combo: number; k: number; yaw: number } | null = null;

  constructor(x: number, z: number, physics: Physics, assets: HeroAssets) {
    const character = assets.body.scene;
    const drop: THREE.Object3D[] = [];
    character.traverse((o) => { if (/helmet/i.test(o.name)) drop.push(o); });
    for (const o of drop) o.removeFromParent();
    const box = new THREE.Box3().setFromObject(character, true);
    const s = HEIGHT / (box.max.y - box.min.y);
    character.scale.setScalar(s);
    this.model.add(character);
    this.group.add(this.model);

    const bones = new Map<string, THREE.Bone>();
    character.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });

    character.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const material = (m.material as THREE.MeshStandardMaterial).clone();
      material.roughness = 0.62;
      m.material = material;
      if (/cape/i.test(m.name)) {
        material.name = 'cape';
        material.side = THREE.DoubleSide;
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox!;
        const top = bb.max.y, span = Math.max(1e-4, bb.max.y - bb.min.y);
        addRim(material, (shader) => {
          shader.uniforms.uTime = uniforms.uTime;
          shader.uniforms.uWind = uniforms.uWind;
          shader.uniforms.uCapeBlow = this.capeUniforms.uCapeBlow;
          shader.uniforms.uCapeTurn = this.capeUniforms.uCapeTurn;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform float uCapeBlow; uniform float uCapeTurn;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              float cw = clamp((${top.toFixed(5)} - position.y) / ${span.toFixed(5)}, 0.0, 1.0);
              float cw2 = cw * cw;
              float wave = sin(uTime * (4.0 + uCapeBlow * 8.0 + uWind * 4.0) - cw * 5.0 + position.x / ${span.toFixed(5)} * 3.0);
              float idle = sin(uTime * 1.4 + position.x / ${span.toFixed(5)} * 2.0) * 0.03;
              vec3 off = vec3(0.0);
              off.z -= (uCapeBlow * 0.55 + uWind * 0.25 + 0.04) * cw2;
              off.y += uCapeBlow * 0.22 * cw2;
              off.z += (wave * (0.05 + uCapeBlow * 0.08 + uWind * 0.06) + idle) * cw2;
              off.x += (uCapeTurn * 0.35 + uWind * 0.12) * cw2;
              transformed += off * ${span.toFixed(5)};`);
        });
      } else {
        material.name = m.name;
        addRim(material);
      }
    });

    this.mixer = new THREE.AnimationMixer(character);
    for (const clip of assets.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    for (const name of LOCO) {
      const a = this.actions.get(name);
      if (!a) continue;
      a.play();
      a.setEffectiveWeight(name === 'Idle_A' ? 1 : 0);
      this.locoW.set(name, name === 'Idle_A' ? 1 : 0);
    }
    this.fishIdle = this.actions.get('Fishing_Idle') ?? null;
    this.fishReel = this.actions.get('Fishing_Reeling') ?? null;
    for (const a of [this.fishIdle, this.fishReel]) { a?.play(); a?.setEffectiveWeight(0); }

    const hand = bones.get('handslotr') ?? bones.get('handr')!;
    const swordModel = assets.sword.scene;
    swordModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      const material = (m.material as THREE.MeshStandardMaterial).clone();
      material.name = 'sword';
      material.roughness = 0.45;
      addRim(material);
      m.material = material;
    });
    this.sword.add(swordModel);
    hand.add(this.sword);

    character.updateMatrixWorld(true);
    const handScale = new THREE.Vector3();
    hand.getWorldScale(handScale);
    const attach = new THREE.Group();
    attach.scale.setScalar(1 / handScale.x);
    hand.add(attach);
    const rodLen = 1.5;
    const rodGeo = new THREE.CylinderGeometry(0.008, 0.02, rodLen, 6);
    rodGeo.translate(0, rodLen / 2, 0);
    const rodMesh = new THREE.Mesh(rodGeo, mat('#7a4a26', { roughness: 0.5 }));
    rodMesh.castShadow = true;
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), mat('#b8bcc4', { metalness: 0.7, roughness: 0.3 }));
    reel.position.set(0.04, 0.12, 0);
    reel.rotation.z = Math.PI / 2;
    this.rodTipObj.position.set(0, rodLen, 0);
    this.rod.add(rodMesh, reel, this.rodTipObj);
    this.rod.position.y = -0.08;
    this.rod.visible = false;
    attach.add(this.rod);

    this.body = new CANNON.Body({
      mass: 6,
      material: physics.heroMat,
      shape: new CANNON.Sphere(RADIUS),
      fixedRotation: true,
      linearDamping: 0,
      allowSleep: false,
    });
    this.body.position.set(x, RADIUS, z);
    physics.world.addBody(this.body);
    this.sync();
  }

  get x() { return this.body.interpolatedPosition.x; }
  get z() { return this.body.interpolatedPosition.z; }
  get heading() { return this.yaw; }
  get attacking() { return this.attackT >= 0; }

  private sync() {
    const p = this.body.interpolatedPosition;
    this.group.position.set(p.x, p.y - RADIUS, p.z);
  }

  drive(input: { x: number; z: number; run: boolean }, dt: number) {
    let { x, z } = input;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    const target = input.run ? RUN : SPEED;
    const k = 1 - Math.exp(-dt * 12);
    this.body.velocity.x += (x * target - this.body.velocity.x) * k;
    this.body.velocity.z += (z * target - this.body.velocity.z) * k;
    if (len > 0.1) {
      let diff = Math.atan2(x, z) - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * (1 - Math.exp(-dt * 12));
    }
  }

  stop() {
    this.body.velocity.x = 0;
    this.body.velocity.z = 0;
  }

  private play(name: string, timeScale = 1, startAt = 0) {
    const a = this.actions.get(name);
    if (!a) return;
    if (this.oneShot && this.oneShot !== a) this.oneShot.stop();
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    a.time = startAt;
    a.play();
    this.oneShot = a;
  }

  playInteract() {
    if (!this.down && this.attackT < 0) this.play('Interact', 1.5);
  }

  animate(dt: number, t: number) {
    this.sync();
    this.clock = t;
    this.speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);

    const sp = this.speed;
    const still = 1 - THREE.MathUtils.smoothstep(sp, 0.15, 0.9);
    const moving = 1 - still;
    const runK = THREE.MathUtils.smoothstep(sp, 2.2, 3.4);
    const want: Record<string, number> = { Idle_A: still, Walking_A: moving * (1 - runK), Running_A: moving * runK };
    const lk = 1 - Math.exp(-dt * 10);
    for (const name of LOCO) if (this.locoW.has(name)) this.locoW.set(name, this.locoW.get(name)! + (want[name] - this.locoW.get(name)!) * lk);
    const walk = this.actions.get('Walking_A'), run = this.actions.get('Running_A');
    if (walk) walk.timeScale = THREE.MathUtils.clamp(sp / WALK_PACE, 0.7, 2.2);
    if (run) run.timeScale = THREE.MathUtils.clamp(sp / RUN_PACE, 0.8, 1.7);

    this.swing = null;
    if (this.attackT >= 0) this.updateAttack(dt);

    const oneShotActive = !!this.oneShot && this.oneShot.isRunning();
    const oneTarget = this.down || oneShotActive ? 1 : 0;
    this.oneShotW += (oneTarget - this.oneShotW) * (1 - Math.exp(-dt * 18));
    this.oneShot?.setEffectiveWeight(this.oneShotW);
    if (this.oneShot && !oneShotActive && !this.down && this.oneShotW < 0.02) { this.oneShot.stop(); this.oneShot = null; }

    const poseTarget = this.fishing && !oneShotActive ? 1 : 0;
    this.poseW += (poseTarget - this.poseW) * (1 - Math.exp(-dt * 8));
    this.reelW += ((this.reeling ? 1 : 0) - this.reelW) * (1 - Math.exp(-dt * 8));
    const pose = this.poseW * (1 - this.oneShotW);
    this.fishIdle?.setEffectiveWeight(pose * (1 - this.reelW));
    this.fishReel?.setEffectiveWeight(pose * this.reelW);
    if (this.fishing && this.cast < 0.3 && !this.castPlayed) {
      this.castPlayed = true;
      const c = this.actions.get('Fishing_Cast');
      if (c) this.play('Fishing_Cast', c.getClip().duration / 0.95, 0);
    }
    if (!this.fishing) { this.castPlayed = false; this.reeling = false; }

    const rest = (1 - this.oneShotW) * (1 - this.poseW);
    for (const name of LOCO) this.actions.get(name)?.setEffectiveWeight((this.locoW.get(name) ?? 0) * rest);

    this.rod.visible = this.fishing;
    this.sword.visible = !this.fishing;
    if (this.invuln > 0) this.invuln -= dt;

    this.model.rotation.y = this.yaw;
    const turnRate = Math.atan2(Math.sin(this.yaw - this.lastYaw), Math.cos(this.yaw - this.lastYaw)) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    const cb = this.capeUniforms.uCapeBlow, ct = this.capeUniforms.uCapeTurn;
    cb.value += (Math.min(1, sp / RUN) - cb.value) * (1 - Math.exp(-dt * 5));
    ct.value += (THREE.MathUtils.clamp(-turnRate * 0.12, -0.6, 0.6) - ct.value) * (1 - Math.exp(-dt * 6));
    this.mixer.update(dt);
  }

  hurt(dmg: number, fromX: number, fromZ: number): boolean {
    if (this.invuln > 0 || this.down) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = 0.9;
    const dx = this.x - fromX, dz = this.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.body.velocity.x = (dx / d) * 7;
    this.body.velocity.z = (dz / d) * 7;
    this.attackT = -1;
    this.model.position.y = 0;
    if (this.hp <= 0) {
      this.down = true;
      this.play('Death_A', 1);
    } else this.play('Hit_A', 1.4);
    return true;
  }

  heal(n: number) { this.hp = Math.min(this.maxHp, this.hp + n); }

  revive(x: number, z: number) {
    this.down = false;
    this.hp = this.maxHp;
    this.invuln = 1.5;
    this.oneShot?.stop();
    this.oneShot = null;
    this.oneShotW = 0;
    this.body.position.set(x, RADIUS, z);
    this.body.interpolatedPosition.set(x, RADIUS, z);
    this.body.previousPosition.set(x, RADIUS, z);
    this.body.velocity.set(0, 0, 0);
  }

  attack() {
    if (this.fishing || this.down) return;
    if (this.attackT >= 0) {
      if (this.attackT > 0.35) this.queued = true;
      return;
    }
    this.combo = this.clock - this.lastSwingEnd < 0.35 ? (this.combo + 1) % 3 : 0;
    this.beginSwing();
  }

  private beginSwing() {
    this.attackT = 0;
    this.hitDone = false;
    this.queued = false;
    const name = ATTACKS[this.combo];
    const a = this.actions.get(name);
    if (!a) return;
    const dur = a.getClip().duration;
    const start = dur * ATTACK_START[this.combo];
    this.play(name, (dur * 0.85 - start) / ATTACK_DUR[this.combo], start);
  }

  private updateAttack(dt: number) {
    this.attackT += dt / ATTACK_DUR[this.combo];
    const k = Math.min(1, this.attackT);
    this.model.position.y = this.combo === 2 ? Math.sin(k * Math.PI) * 0.12 : 0;
    this.swing = { combo: this.combo, k, yaw: this.yaw };
    if (!this.hitDone && k >= 0.42) {
      this.hitDone = true;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.onSlash(new THREE.Vector3(this.x, 0.5, this.z).addScaledVector(fwd, 0.85), fwd, this.combo);
    }
    if (this.attackT >= 1) {
      this.model.position.y = 0;
      if (this.queued) {
        this.combo = (this.combo + 1) % 3;
        this.beginSwing();
      } else {
        this.attackT = -1;
        this.lastSwingEnd = this.clock;
      }
    }
  }

  rodTip(out: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    return this.rodTipObj.getWorldPosition(out);
  }

  face(x: number, z: number) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
    this.model.rotation.y = this.yaw;
  }
}
