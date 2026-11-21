import * as THREE from 'three';

interface Heart { g: THREE.Group; x: number; z: number; vy: number; y: number; life: number }

export class Hearts {
  group = new THREE.Group();
  private list: Heart[] = [];
  private geo: THREE.BufferGeometry;
  private mat = new THREE.MeshStandardMaterial({ color: '#ff4a6a', emissive: '#ff2a4a', emissiveIntensity: 0.9, roughness: 0.3 });

  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.18);
    shape.bezierCurveTo(-0.05, -0.12, -0.22, -0.02, -0.2, 0.08);
    shape.bezierCurveTo(-0.18, 0.2, -0.04, 0.2, 0, 0.1);
    shape.bezierCurveTo(0.04, 0.2, 0.18, 0.2, 0.2, 0.08);
    shape.bezierCurveTo(0.22, -0.02, 0.05, -0.12, 0, -0.18);
    this.geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 10 });
    this.geo.center();
  }

  drop(x: number, z: number) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.geo, this.mat);
    m.castShadow = true;
    g.add(m);
    this.group.add(g);
    this.list.push({ g, x, z, vy: 4, y: 0.6, life: 25 });
  }

  update(dt: number, t: number, heroX: number, heroZ: number, amount = 25): { healed: number; at: THREE.Vector3 | null } {
    let healed = 0;
    let at: THREE.Vector3 | null = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      h.life -= dt;
      h.vy -= 14 * dt;
      h.y = Math.max(0.45 + Math.sin(t * 3 + h.x) * 0.06, h.y + h.vy * dt);
      if (h.y <= 0.52 && h.vy < 0) h.vy = 0;
      h.g.position.set(h.x, h.y, h.z);
      h.g.rotation.y = t * 2.5;
      h.g.visible = h.life > 5 || Math.floor(h.life * 8) % 2 === 0;
      const picked = Math.hypot(h.x - heroX, h.z - heroZ) < 0.75;
      if (picked || h.life <= 0) {
        if (picked) { healed += amount; at = h.g.position.clone(); }
        this.group.remove(h.g);
        this.list.splice(i, 1);
      }
    }
    return { healed, at };
  }
}
