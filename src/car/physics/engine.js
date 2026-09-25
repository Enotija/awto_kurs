import { ENGINE, RAD_TO_RPM } from './params.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// Двигатель: обороты, крутящий момент, холостой ход, стартер, заглохание.
export class Engine {
  constructor(p = ENGINE) {
    this.p = p;
    this.omega = 0;          // рад/с
    this.running = false;
    this.cranking = 0;       // сколько ещё крутить стартером, с
    this.crankElapsed = 0;
    this.sinceStart = 99;    // с момента запуска, с
    this.throttleEff = 0;    // фактическая заслонка с учётом холостого хода (для звука)
  }

  get rpm() { return this.omega * RAD_TO_RPM; }

  // Потери на трение и насосные потери — это и есть торможение двигателем
  friction(rpm) { return 15 + 0.006 * Math.max(rpm, 0); }

  fullTorque(rpm) { return interpolate(this.p.torqueCurve, rpm); }

  // Педаль газа → доля максимального момента. На низких оборотах уже
  // небольшое открытие заслонки даёт почти полный момент, как в жизни.
  pedalMap(pedal, rpm) {
    if (pedal <= 0) return 0;
    const a = 1 + 2.5 * clamp(1 - rpm / 6000, 0, 1);
    return 1 - Math.pow(1 - clamp(pedal, 0, 1), a);
  }

  // Запрос на запуск стартером. canCrank — выжато сцепление или нейтраль.
  startRequest(canCrank) {
    if (this.running) return { ok: false, reason: 'running' };
    if (this.cranking > 0) return { ok: false, reason: 'cranking' };
    if (!canCrank) return { ok: false, reason: 'clutch' };
    this.cranking = this.p.crankTime + 0.6;
    this.crankElapsed = 0;
    return { ok: true };
  }

  stop() {
    this.running = false;
    this.cranking = 0;
  }

  // Момент двигателя на коленвале (Нм) при заданной педали газа 0..1
  torque(throttle) {
    const p = this.p;
    const rpm = this.rpm;
    const fric = this.friction(rpm);
    let t;
    if (this.running) {
      const gross = this.fullTorque(rpm) + fric;
      let th = this.pedalMap(throttle, rpm);
      if (rpm < p.limiterRpm) {
        // ЭБУ держит холостые: подаёт ровно столько, чтобы компенсировать
        // трение, плюс добавка, если обороты проседают под нагрузкой.
        const cold = this.sinceStart < p.coldIdleTime;
        const target = cold ? p.coldIdleRpm : p.idleRpm;
        const maxIdle = cold ? 0.7 : p.maxIdleThrottle;
        const idle = clamp(fric / gross + p.idleGain * (target - rpm), 0, maxIdle);
        th = Math.max(th, idle);
      } else {
        th = 0; // отсечка топлива
      }
      this.throttleEff = th;
      t = th * gross - fric;
    } else {
      this.throttleEff = 0;
      // Трение гасит вращение, но не раскручивает назад
      t = -fric * Math.min(1, this.omega / 5);
      if (this.cranking > 0) {
        t += 45 * clamp((this.p.crankRpm + 10 - rpm) / 60, 0, 1);
      }
    }
    return t;
  }

  // Таймеры стартера и прогрева. Возвращает событие или null.
  update(dt) {
    let event = null;
    this.sinceStart += dt;
    if (this.cranking > 0) {
      this.cranking -= dt;
      this.crankElapsed += dt;
      if (this.crankElapsed >= this.p.crankTime && this.rpm > 150) {
        this.running = true;
        this.cranking = 0;
        this.sinceStart = 0;
        event = { type: 'started' };
      } else if (this.cranking <= 0) {
        this.cranking = 0;
        event = { type: 'startFailed' };
      }
    }
    return event;
  }

  // Проверка на заглохание — вызывается после расчёта шага
  checkStall() {
    if (!this.running) return false;
    // Первые полсекунды после запуска обороты ещё набираются
    const threshold = this.sinceStart < 0.6 ? 120 : this.p.stallRpm;
    if (this.rpm < threshold) {
      this.running = false;
      return true;
    }
    return false;
  }
}
