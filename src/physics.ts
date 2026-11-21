import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BUILDINGS, FOUNTAIN, Occ, Prop, Tile, WorldMap } from './world/map';

interface Linked { body: CANNON.Body; mesh: THREE.Object3D; offset?: THREE.Vector3 }

/** Thin wrapper over cannon-es: static world colliders + pushable props. */
export class Physics {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -25, 0) });
  heroMat = new CANNON.Material('hero');
  propMat = new CANNON.Material('prop');
  private groundMat = new CANNON.Material('ground');
  private linked: Linked[] = [];
  /** Static colliders of trees/bushes/rocks, so a cut bush can stop blocking. */
  propBodies = new Map<Prop, CANNON.Body>();

  constructor(map: WorldMap) {
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.heroMat, this.groundMat, { friction: 0, restitution: 0 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.heroMat, this.propMat, { friction: 0.05, restitution: 0.1 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.propMat, this.groundMat, { friction: 0.4, restitution: 0.15 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.propMat, this.propMat, { friction: 0.3, restitution: 0.2 }));

    const ground = new CANNON.Body({ mass: 0, material: this.groundMat, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);

    // buildings
    for (const b of BUILDINGS) this.box(b.x0 + b.w / 2, b.z0 + b.d / 2, b.w / 2 + 0.12, 2, b.d / 2 + 0.12);
    // fountain
    this.cylinder(FOUNTAIN.x, FOUNTAIN.z, 1.25, 1);
    // trees, bushes, rocks
    for (const p of map.props) {
      if (!p.inside) continue;
      this.propBodies.set(p, this.cylinder(p.x, p.z, p.kind === 'tree' ? 0.32 : p.kind === 'bush' ? 0.5 : 0.42, 1.5));
    }
    // water: merge each row's run of water tiles into one tall box
    for (let z = 0; z < map.H; z++) {
      let run = -1;
      for (let x = 0; x <= map.W; x++) {
        const wet = x < map.W && map.tile(x, z) === Tile.Water;
        if (wet && run < 0) run = x;
        if (!wet && run >= 0) {
          this.box((run + x) / 2, z + 0.5, (x - run) / 2, 2, 0.5);
          run = -1;
        }
      }
    }
    // fixtures (sign, chests)
    for (let z = 0; z < map.H; z++)
      for (let x = 0; x < map.W; x++)
        if (map.occ[map.i(x, z)] === Occ.Fixture && !(Math.abs(x + 0.5 - FOUNTAIN.x) < 1.6 && Math.abs(z + 0.5 - FOUNTAIN.z) < 1.6))
          this.box(x + 0.5, z + 0.5, 0.38, 1, 0.3);
    // world edges
    this.box(map.W / 2, -0.5, map.W / 2, 3, 0.5);
    this.box(map.W / 2, map.H + 0.5, map.W / 2, 3, 0.5);
    this.box(-0.5, map.H / 2, 0.5, 3, map.H / 2);
    this.box(map.W + 0.5, map.H / 2, 0.5, 3, map.H / 2);
  }

  box(x: number, z: number, hx: number, hy: number, hz: number) {
    const body = new CANNON.Body({ mass: 0, material: this.groundMat, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
    body.position.set(x, hy, z);
    this.world.addBody(body);
  }

  cylinder(x: number, z: number, r: number, h: number) {
    const body = new CANNON.Body({ mass: 0, material: this.groundMat, shape: new CANNON.Cylinder(r, r, h * 2, 10) });
    body.position.set(x, h, z);
    this.world.addBody(body);
    return body;
  }

  /** Add a dynamic body that drives a mesh's transform. */
  dynamic(mesh: THREE.Object3D, shape: CANNON.Shape, mass: number, offset?: THREE.Vector3): CANNON.Body {
    const body = new CANNON.Body({ mass, material: this.propMat, shape, linearDamping: 0.25, angularDamping: 0.35 });
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
    body.sleepSpeedLimit = 0.15;
    this.world.addBody(body);
    this.linked.push({ body, mesh, offset });
    return body;
  }

  /** Knock every pushable within `r` of `center` away along `dir` (sword hits). Returns how many were hit. */
  impulseNear(center: THREE.Vector3, r: number, dir: THREE.Vector3, strength: number): number {
    let n = 0;
    for (const { body } of this.linked) {
      const dx = body.position.x - center.x, dz = body.position.z - center.z;
      const d = Math.hypot(dx, dz);
      if (d > r) continue;
      // push mostly along the swing, a bit away from the hit point, and up
      const away = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(0.5).add(dir).normalize();
      const k = strength * (1 - d / r * 0.5) * body.mass;
      body.wakeUp();
      body.applyImpulse(new CANNON.Vec3(away.x * k, k * 0.55, away.z * k));
      body.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      n++;
    }
    return n;
  }

  setPropSolid(p: Prop, solid: boolean) {
    const b = this.propBodies.get(p);
    if (!b) return;
    const inWorld = this.world.bodies.includes(b);
    if (solid && !inWorld) this.world.addBody(b);
    if (!solid && inWorld) this.world.removeBody(b);
  }

  step(dt: number) {
    this.world.step(1 / 60, dt, 4);
    for (const { body, mesh } of this.linked) {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      // anything knocked out of the world respawns gently from the sky
      if (body.position.y < -5) {
        body.position.y = 6;
        body.velocity.setZero();
      }
    }
  }
}
