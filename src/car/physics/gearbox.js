// Механическая коробка 5+R. Передача включается только при выжатом сцеплении,
// задняя — только когда машина стоит.

export const CLUTCH_DISENGAGED = 0.85; // педаль нажата дальше этой точки — диски разомкнуты

export class Gearbox {
  constructor() {
    this.gear = 0; // -1 = R, 0 = N, 1..5
  }

  get label() {
    return this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
  }

  // target — желаемая передача; clutchPedal — 0..1; speed — м/с
  request(target, clutchPedal, speed) {
    if (target === this.gear) return { ok: true, changed: false };
    // В нейтраль можно выйти и без сцепления, если не под нагрузкой
    if (target !== 0 && clutchPedal < CLUTCH_DISENGAGED) {
      return { ok: false, reason: 'clutch' };
    }
    if (target === -1 && Math.abs(speed) > 0.4) {
      return { ok: false, reason: 'reverseMoving' };
    }
    if (target > 0 && speed < -1.0) {
      return { ok: false, reason: 'forwardRollingBack' };
    }
    this.gear = target;
    return { ok: true, changed: true };
  }

  up(clutchPedal, speed) {
    const target = this.gear === -1 ? 0 : Math.min(this.gear + 1, 5);
    return this.request(target, clutchPedal, speed);
  }

  down(clutchPedal, speed) {
    const target = this.gear === -1 ? 0 : Math.max(this.gear - 1, 0);
    return this.request(target, clutchPedal, speed);
  }

  reverse(clutchPedal, speed) {
    return this.request(-1, clutchPedal, speed);
  }
}
