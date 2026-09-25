import * as THREE from 'three';
import { CarPhysics } from './physics/carPhysics.js';
import { Signals } from './signals.js';
import { buildCarBody } from './carBody.js';
import { Cockpit, EYE } from './cockpit.js';
import { Mirrors } from './mirrors.js';
import { DriverView } from './driverView.js';

const PHYS_DT = 1 / 300;
const PAINT = 0xeeeeea;

// Машина игрока: физика + графика + свет + столкновения.
export class PlayerCar {
  constructor(scene) {
    this.physics = new CarPhysics();
    this.signals = new Signals();
    this.events = [];
    this.acc = 0;
    this.collisionCooldown = 0;
    this.time = 0;
    this.lastCollisionAt = -Infinity;

    this.group = new THREE.Group();
    this.group.name = 'playerCar';
    scene.add(this.group);
    this.group.add(buildCarBody({ paint: PAINT }));
    this.cockpit = new Cockpit(this.group, { paint: PAINT });
    this.mirrors = new Mirrors(this.group, EYE, { paint: PAINT });
    this.view = new DriverView(this.group, EYE);
    this.buildHeadlights();
  }

  buildHeadlights() {
    this.beams = [];
    for (const x of [0.6, -0.6]) {
      const light = new THREE.SpotLight(0xfff3dd, 0, 90, 0.55, 0.55, 1.6);
      light.position.set(x, 0.7, 1.95);
      light.target.position.set(x * 1.4, 0, 22);
      this.group.add(light, light.target);
      this.beams.push(light);
    }
  }

  applyHeadlights() {
    const mode = this.signals.headlights;
    for (const l of this.beams) {
      if (mode === 0) { l.intensity = 0; continue; }
      const high = mode === 2;
      l.intensity = high ? 220 : 110;
      l.distance = high ? 180 : 70;
      l.angle = high ? 0.42 : 0.6;
      l.target.position.z = high ? 60 : 20;
    }
  }

  reset({ x, z, heading }) {
    const p = this.physics;
    p.setPose(x, z, heading);
    p.v = 0;
    p.engine.stop();
    p.engine.omega = 0;
    p.gearbox.gear = 0;
    p.handbrake = true;
    this.signals.turn = null;
    this.signals.hazard = false;
    this.syncTransform();
  }

  get position() { return this.group.position; }
  get speedKmh() { return this.physics.speedKmh; }

  // Разовые команды от игрока. Возвращает текст для сообщения или null.
  action(name, controls, time) {
    const p = this.physics;
    const s = this.signals;
    const clutch = controls.clutch;
    const shift = (r) => {
      if (r.ok) return null;
      this.events.push({ type: 'grind', reason: r.reason });
      return null;
    };
    switch (name) {
      case 'gearUp': return shift(p.shiftUp(clutch));
      case 'gearDown': return shift(p.shiftDown(clutch));
      case 'reverse': return shift(p.shiftReverse(clutch));
      case 'handbrake':
        p.handbrake = !p.handbrake;
        this.events.push({ type: 'handbrake', on: p.handbrake });
        return null;
      case 'signalLeft': s.toggleTurn('left', time); return null;
      case 'signalRight': s.toggleTurn('right', time); return null;
      case 'hazard': s.toggleHazard(); this.events.push({ type: 'hazard', on: s.hazard }); return null;
      case 'lights':
        s.cycleHeadlights();
        this.applyHeadlights();
        this.events.push({ type: 'lights', mode: s.headlights });
        return null;
      case 'start': {
        const r = p.startEngine(clutch);
        if (!r.ok) this.events.push({ type: 'startDenied', reason: r.reason });
        else this.events.push({ type: 'cranking' });
        return null;
      }
      default: return null;
    }
  }

  update(dt, controls, colliders, time, input) {
    const p = this.physics;
    this.time = time;
    this.acc += dt;
    while (this.acc >= PHYS_DT) {
      p.step(PHYS_DT, controls);
      this.acc -= PHYS_DT;
    }
    this.collisionCooldown -= dt;
    this.collide(colliders);
    this.syncTransform();

    if (this.signals.update(dt, controls.steer)) this.events.push({ type: 'tick', on: this.signals.blinkOn });

    this.view.update(dt, input, time, p.accel);
    this.cockpit.update(dt, { steer: controls.steer, gear: p.gearbox.gear, handbrake: p.handbrake }, {
      rpm: p.rpm,
      speedKmh: p.speedKmh,
      gear: p.gearbox.label,
      left: this.signals.leftLamp,
      right: this.signals.rightLamp,
      lowBeam: this.signals.headlights >= 1,
      highBeam: this.signals.headlights === 2,
      handbrake: p.handbrake,
      engineOn: p.engine.running,
      cranking: p.engine.cranking > 0,
    }, p.p.steeringWheelTurns);
  }

  syncTransform() {
    const p = this.physics;
    this.group.position.set(p.centerX, 0, p.centerZ);
    this.group.rotation.set(0, p.heading, 0);
    this.group.updateMatrixWorld();
  }

  // Машина — прямоугольник; препятствия — прямоугольники и круги (углы бордюров)
  collide(colliders) {
    const p = this.physics;
    const hw = p.p.width / 2, hl = p.p.length / 2;
    for (let iter = 0; iter < 3; iter++) {
      let hit = null;
      const cx = p.centerX, cz = p.centerZ;
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading); // вперёд
      const rx = Math.cos(p.heading), rz = -Math.sin(p.heading); // вбок
      for (const c of colliders) {
        const res = c.type === 'box'
          ? obbVsBox(cx, cz, fx, fz, rx, rz, hw, hl, c)
          : obbVsCircle(cx, cz, fx, fz, rx, rz, hw, hl, c);
        if (res && (!hit || res.depth > hit.depth)) hit = { ...res, kind: c.kind };
      }
      if (!hit) break;
      p.translate(hit.nx * (hit.depth + 0.001), hit.nz * (hit.depth + 0.001));
      // Скорость в сторону препятствия гасим
      const vn = (fx * hit.nx + fz * hit.nz) * p.v;
      if (vn < 0) {
        this.lastCollisionAt = this.time;
        if (Math.abs(p.v) > 0.5 && this.collisionCooldown <= 0) {
          this.events.push({ type: 'collision', kind: hit.kind, speed: Math.abs(p.v) });
          this.collisionCooldown = 1.0;
        }
        p.v = 0;
      }
    }
  }
}

function obbVsBox(cx, cz, fx, fz, rx, rz, hw, hl, b) {
  const bx = (b.minX + b.maxX) / 2, bz = (b.minZ + b.maxZ) / 2;
  const bhx = (b.maxX - b.minX) / 2, bhz = (b.maxZ - b.minZ) / 2;
  const dx = bx - cx, dz = bz - cz;
  let best = Infinity, nx = 0, nz = 0;
  for (const [ax, az] of [[1, 0], [0, 1], [fx, fz], [rx, rz]]) {
    const pa = hl * Math.abs(fx * ax + fz * az) + hw * Math.abs(rx * ax + rz * az);
    const pb = bhx * Math.abs(ax) + bhz * Math.abs(az);
    const d = dx * ax + dz * az;
    const overlap = pa + pb - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < best) {
      best = overlap;
      const s = d > 0 ? -1 : 1; // выталкиваем машину от препятствия
      nx = ax * s; nz = az * s;
    }
  }
  return { depth: best, nx, nz };
}

function obbVsCircle(cx, cz, fx, fz, rx, rz, hw, hl, c) {
  const dx = c.x - cx, dz = c.z - cz;
  const lx = dx * rx + dz * rz, lz = dx * fx + dz * fz;
  const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hl, Math.min(hl, lz));
  const px = cx + rx * qx + fx * qz, pz = cz + rz * qx + fz * qz;
  const ex = c.x - px, ez = c.z - pz;
  const dist = Math.hypot(ex, ez);
  if (dist >= c.r) return null;
  if (dist < 1e-6) {
    const l = Math.hypot(dx, dz) || 1;
    return { depth: c.r, nx: -dx / l, nz: -dz / l };
  }
  return { depth: c.r - dist, nx: -ex / dist, nz: -ez / dist };
}
