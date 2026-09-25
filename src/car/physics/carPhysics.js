import { CAR, ENGINE, G } from './params.js';
import { Engine } from './engine.js';
import { Gearbox, CLUTCH_DISENGAGED } from './gearbox.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Педаль сцепления (0 — отпущена, 1 — в пол) → доля передаваемого момента.
// Точка схватывания около 0.65, полностью замкнуто ниже 0.25.
export function clutchEngagement(pedal) {
  const t = clamp((0.8 - pedal) / 0.55, 0, 1);
  return t * t;
}

// Физика машины без графики: продольная динамика с двигателем, сцеплением
// и тормозами (метод последовательных импульсов) + кинематическая
// «велосипедная» модель поворота. Можно гонять в Node для тестов.
export class CarPhysics {
  constructor(p = CAR, engineParams = ENGINE) {
    this.p = p;
    this.engine = new Engine(engineParams);
    this.gearbox = new Gearbox();
    this.handbrake = true;
    this.x = 0;          // положение задней оси, м
    this.z = 0;
    this.heading = 0;    // рад; 0 — смотрим вдоль +Z, положительный — влево
    this.v = 0;          // скорость вдоль кузова, м/с (минус — назад)
    this.yawRate = 0;
    this.accel = 0;      // продольное ускорение, м/с² (для покачивания камеры)
    this.grade = 0;      // синус уклона дороги по ходу (+ в горку)
    this.clutchSlip = 0; // |обороты двигателя − обороты коробки|, рад/с
    this.clutchTorque = 0;
    this.lastControls = { throttle: 0, brake: 0, clutch: 0, steer: 0 };
    this.events = [];
  }

  get speedKmh() { return this.v * 3.6; }
  get rpm() { return this.engine.rpm; }

  // Передаточное число от колёс к коленвалу (0 — нейтраль)
  get totalRatio() {
    return this.p.gearRatios[this.gearbox.gear] * this.p.finalDrive;
  }

  shiftUp(clutch) { return this.gearbox.up(clutch, this.v); }
  shiftDown(clutch) { return this.gearbox.down(clutch, this.v); }
  shiftReverse(clutch) { return this.gearbox.reverse(clutch, this.v); }

  startEngine(clutch) {
    const canCrank = this.gearbox.gear === 0 || clutch >= CLUTCH_DISENGAGED;
    return this.engine.startRequest(canCrank);
  }

  // c = { throttle 0..1, brake 0..1, clutch 0..1, steer -1..1 (+ влево) }
  step(dt, c) {
    const p = this.p;
    const E = this.engine;
    const m = p.mass;
    this.lastControls = c;
    const v0 = this.v;

    const ev = E.update(dt);
    if (ev) this.events.push(ev);

    const ratio = this.totalRatio;
    const k = ratio / p.wheelRadius; // рад/с коленвала на 1 м/с машины
    const clutchCap = ratio !== 0 ? clutchEngagement(c.clutch) * p.clutchMaxTorque * dt : 0;

    // 1) Свободные силы: момент двигателя, аэродинамика, уклон
    const Te = E.torque(c.throttle);
    E.omega += Te / E.p.inertia * dt;
    const F = -p.dragArea * this.v * Math.abs(this.v) - m * G * this.grade;
    this.v += F / m * dt;

    // 2) Связи с трением: сцепление, тормоза, «двигатель не крутится назад»
    const brakeCap = (c.brake * p.brakeForceMax
      + (this.handbrake ? p.handbrakeForce : 0)
      + p.rollingResistance * m * G) * dt;
    const invI = 1 / E.p.inertia;
    const invM = 1 / m;
    const kEff = invI + k * k * invM;
    let Jc = 0, Jb = 0, Je = 0;

    for (let i = 0; i < 12; i++) {
      if (clutchCap > 0) {
        const rel = E.omega - this.v * k;
        const old = Jc;
        Jc = clamp(old + rel / kEff, -clutchCap, clutchCap);
        const d = Jc - old;
        E.omega -= d * invI;
        this.v += d * k * invM;
      }
      {
        const old = Jb;
        Jb = clamp(old - this.v * m, -brakeCap, brakeCap);
        this.v += (Jb - old) * invM;
      }
      {
        const old = Je;
        Je = Math.max(0, old - E.omega * E.p.inertia);
        E.omega += (Je - old) * invI;
      }
    }
    this.clutchTorque = Jc / dt;
    this.clutchSlip = clutchCap > 0 ? Math.abs(E.omega - this.v * k) : 0;
    this.accel = (this.v - v0) / dt;

    if (E.checkStall()) this.events.push({ type: 'stall', gear: this.gearbox.gear, speed: this.v });
    if (E.rpm > 7300) this.events.push({ type: 'overrev' });

    // 3) Поворот: кинематика + ограничение по сцеплению шин
    const delta = c.steer * p.maxWheelAngle;
    let yawRate = this.v * Math.tan(delta) / p.wheelbase;
    const aLat = Math.abs(this.v * yawRate);
    if (aLat > p.maxLateralAccel) yawRate *= p.maxLateralAccel / aLat;
    this.yawRate = yawRate;
    this.heading += yawRate * dt;
    this.x += this.v * Math.sin(this.heading) * dt;
    this.z += this.v * Math.cos(this.heading) * dt;
  }

  // Центр кузова (для графики и столкновений)
  get centerX() { return this.x + Math.sin(this.heading) * this.p.rearAxleToCenter; }
  get centerZ() { return this.z + Math.cos(this.heading) * this.p.rearAxleToCenter; }

  setPose(cx, cz, heading) {
    this.heading = heading;
    this.x = cx - Math.sin(heading) * this.p.rearAxleToCenter;
    this.z = cz - Math.cos(heading) * this.p.rearAxleToCenter;
  }

  // Сдвинуть машину (выталкивание из препятствия) — в координатах центра
  translate(dx, dz) { this.x += dx; this.z += dz; }
}
