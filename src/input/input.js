// Клавиатура + геймпад → педали, руль, взгляд и разовые команды.
// Клавиши берём по физическому коду (e.code), поэтому раскладка не важна.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, rate, dt) =>
  v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);

// Разовые команды по клавишам
const ACTIONS = {
  KeyE: 'gearUp',
  KeyQ: 'gearDown',
  KeyR: 'reverse',
  Space: 'handbrake',
  KeyZ: 'signalLeft',
  KeyC: 'signalRight',
  KeyH: 'hazard',
  KeyL: 'lights',
  KeyK: 'start',
  KeyM: 'mute',
  KeyN: 'night',
  KeyJ: 'journal',
  KeyV: 'voice',
  Backspace: 'reset',
};

// Кнопки стандартного геймпада (Xbox-раскладка)
const PAD_ACTIONS = {
  5: 'gearUp',      // RB
  4: 'gearDown',    // LB
  3: 'reverse',     // Y
  2: 'handbrake',   // X
  14: 'signalLeft', // крестовина влево
  15: 'signalRight',// крестовина вправо
  13: 'hazard',     // крестовина вниз
  12: 'lights',     // крестовина вверх
  1: 'start',       // B
  9: 'help',        // Start
};

export const PEDAL_RATES = {
  throttleUp: 1.6, throttleDown: 3.5,
  brakeUp: 2.0, brakeDown: 5.0,
  clutchDown: 4.0,          // выжать до пола ~0.25 с
  clutchUp: 1 / 0.7,        // отпускается сама за ~0.7 с
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.actions = [];
    this.throttle = 0;
    this.brake = 0;
    this.clutch = 0;
    this.steer = 0;          // положение руля −1..1 (+ влево)
    this.look = { left: 0, right: 0, up: 0 }; // сколько секунд держим стрелку
    this.mouseLook = { yaw: 0, pitch: 0, active: false };
    this.gamepadConnected = false;
    this.padPrev = [];
    this.padLookX = 0;
    this.anyInput = false;

    target.addEventListener('keydown', (e) => {
      this.anyInput = true;
      const action = ACTIONS[e.code];
      if (action || e.code.startsWith('Arrow') || e.code.startsWith('Shift') || ['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat && action) this.actions.push(action);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());

    // Свободный взгляд: зажать правую кнопку мыши и двигать
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('mousedown', (e) => {
      this.anyInput = true;
      if (e.button === 2) this.mouseLook.active = true;
    });
    target.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.mouseLook.active = false;
    });
    target.addEventListener('mousemove', (e) => {
      if (!this.mouseLook.active) return;
      this.mouseLook.yaw = clamp(this.mouseLook.yaw - e.movementX * 0.004, -2.4, 2.4);
      this.mouseLook.pitch = clamp(this.mouseLook.pitch - e.movementY * 0.004, -0.9, 0.7);
    });
  }

  down(code) { return this.keys.has(code); }

  takeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  // speed — скорость машины, м/с (руль сам возвращается в центр на ходу)
  update(dt, speed) {
    const pad = this.readGamepad();
    const k = (c) => this.keys.has(c);
    const R = PEDAL_RATES;

    // Педали с клавиатуры нарастают плавно
    this.throttle = approach(this.throttle, k('KeyW') ? 1 : 0, k('KeyW') ? R.throttleUp : R.throttleDown, dt);
    this.brake = approach(this.brake, k('KeyS') ? 1 : 0, k('KeyS') ? R.brakeUp : R.brakeDown, dt);
    const clutchKey = k('ShiftLeft') || k('ShiftRight');
    this.clutch = approach(this.clutch, clutchKey ? 1 : 0, clutchKey ? R.clutchDown : R.clutchUp, dt);

    let throttle = this.throttle, brake = this.brake, clutch = this.clutch;
    if (pad) {
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      clutch = Math.max(clutch, pad.clutch);
    }

    // Руль
    const v = Math.abs(speed);
    const dir = (k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0);
    if (pad && Math.abs(pad.steer) > 0.08) {
      const target = pad.steer * Math.abs(pad.steer); // точнее около центра
      this.steer = approach(this.steer, target, 2.5, dt);
    } else if (dir !== 0) {
      const rate = 1.1 / (1 + v / 8);
      // Возврат через центр быстрее — как перехват руля
      const back = Math.sign(this.steer) === -dir ? 1.6 : 1;
      this.steer += dir * rate * back * dt;
    } else {
      // Самовозврат руля на ходу; на месте руль остаётся где был
      this.steer = approach(this.steer, 0, 1.8 * Math.min(1, v / 4), dt);
    }
    this.steer = clamp(this.steer, -1, 1);

    // Взгляд: сколько держим стрелку
    this.look.left = k('ArrowLeft') ? this.look.left + dt : 0;
    this.look.right = k('ArrowRight') ? this.look.right + dt : 0;
    this.look.up = k('ArrowUp') ? this.look.up + dt : 0;
    if (pad) {
      this.padLookX = pad.lookX;
      if (pad.lookX < -0.5) this.look.left = Math.max(this.look.left, this.padLookTimeL = (this.padLookTimeL || 0) + dt);
      else this.padLookTimeL = 0;
      if (pad.lookX > 0.5) this.look.right = Math.max(this.look.right, this.padLookTimeR = (this.padLookTimeR || 0) + dt);
      else this.padLookTimeR = 0;
    }

    return { throttle, brake, clutch, steer: this.steer };
  }

  readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    this.gamepadConnected = !!gp;
    if (!gp) return null;
    const btn = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const pressed = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);
    for (const [i, action] of Object.entries(PAD_ACTIONS)) {
      const now = pressed(+i);
      if (now && !this.padPrev[i]) { this.actions.push(action); this.anyInput = true; }
      this.padPrev[i] = now;
    }
    const dz = (x, d = 0.12) => (Math.abs(x) < d ? 0 : (x - Math.sign(x) * d) / (1 - d));
    return {
      steer: -dz(gp.axes[0] || 0),
      throttle: btn(7),
      brake: btn(6),
      clutch: clamp(dz(gp.axes[3] || 0, 0.15), 0, 1), // правый стик вниз
      lookX: dz(gp.axes[2] || 0, 0.3),
    };
  }
}
