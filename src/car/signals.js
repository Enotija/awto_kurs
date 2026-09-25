// Поворотники, аварийка, фары. Поворотник выключается сам,
// когда руль возвращается после поворота в ту же сторону.

const BLINK_PERIOD = 0.8; // с — примерно 75 миганий в минуту

export class Signals {
  constructor() {
    this.turn = null;     // 'left' | 'right' | null
    this.hazard = false;
    this.headlights = 0;  // 0 — выкл, 1 — ближний, 2 — дальний
    this.phase = 0;
    this.blinkOn = false;
    this.armed = false;
    this.turnOnSince = 0; // когда включили текущий поворотник (время игры)
  }

  get blinking() { return this.hazard || this.turn !== null; }
  get leftLamp() { return this.blinkOn && (this.hazard || this.turn === 'left'); }
  get rightLamp() { return this.blinkOn && (this.hazard || this.turn === 'right'); }

  toggleTurn(side, time) {
    if (this.turn === side) {
      this.turn = null;
    } else {
      this.turn = side;
      this.armed = false;
      this.turnOnSince = time;
      if (!this.hazard) this.restartBlink();
    }
  }

  toggleHazard() {
    this.hazard = !this.hazard;
    this.restartBlink();
  }

  cycleHeadlights() {
    this.headlights = (this.headlights + 1) % 3;
    return this.headlights;
  }

  restartBlink() {
    this.phase = 0;
    this.blinkOn = false;
  }

  // steer — положение руля −1..1 (+ влево). Возвращает true на каждом щелчке реле.
  update(dt, steer) {
    // Самовыключение
    if (this.turn === 'left') {
      if (steer > 0.3) this.armed = true;
      else if (this.armed && steer < 0.08) { this.turn = null; this.armed = false; }
    } else if (this.turn === 'right') {
      if (steer < -0.3) this.armed = true;
      else if (this.armed && steer > -0.08) { this.turn = null; this.armed = false; }
    }

    if (!this.blinking) {
      const wasOn = this.blinkOn;
      this.blinkOn = false;
      this.phase = 0;
      return wasOn;
    }
    const before = this.blinkOn;
    this.phase = (this.phase + dt) % BLINK_PERIOD;
    this.blinkOn = this.phase < BLINK_PERIOD / 2;
    return before !== this.blinkOn;
  }
}
