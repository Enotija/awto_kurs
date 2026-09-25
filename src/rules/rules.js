// Движок правил (без графики): следит за машиной игрока относительно дорожной сети
// и записывает нарушения. На вход каждый кадр — состояние игрока:
// { x, z, heading, speedKmh, time, turn: 'left'|'right'|null, checks: {mirrorLeft, ...} }

import { locate, movementBetween, LANE } from '../world/roadNetwork.js';
import { VIOLATIONS, MANEUVER_RU } from './violations.js';

export const STOP_SPEED = 0.6;     // км/ч — ниже считаем полной остановкой
export const SPEED_TOL = 3;        // км/ч — допуск спидометра
export const MIRROR_WINDOW = 10;   // с — зеркало надо проверить не раньше, чем за столько до манёвра
const STOP_ZONE = 12;              // м до стоп-линии, где засчитывается остановка

const SIDE_CHECKS = {
  left: ['mirrorLeft', 'shoulderLeft'],
  right: ['mirrorRight', 'shoulderRight'],
};

export class RulesEngine {
  constructor(net, lights) {
    this.net = net;
    this.lights = lights;
    this.reset();
  }

  // parked — машина стоит у края: при трогании нужен поворотник и зеркало
  reset({ parked = true } = {}) {
    this.log = [];
    this.events = [];
    this.cooldown = {};
    this.prev = null;
    this.loc = null;
    this.approach = null;
    this.entry = null;
    this.parked = parked;
    this.limit = 50;
    this.over = { t: 0, reported: false, hard: false };
    this.wrong = { t: 0, reported: false };
  }

  get count() { return this.log.length; }

  report(code, time, detail = '') {
    if (time - (this.cooldown[code] ?? -Infinity) < 3) return;
    this.cooldown[code] = time;
    const v = { code, time, detail, ...VIOLATIONS[code] };
    this.log.push(v);
    this.events.push({ type: 'violation', violation: v });
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  lastCheck(side, checks) {
    return Math.max(...SIDE_CHECKS[side].map((k) => checks[k] ?? -Infinity));
  }

  update(dt, s) {
    const loc = locate(this.net, s.x, s.z, s.heading);
    this.loc = loc;
    const v = Math.abs(s.speedKmh);

    // Трогание от края дороги
    if (this.parked && v > 3) {
      this.parked = false;
      if (s.turn !== 'left') this.report('NO_SIGNAL', s.time, MANEUVER_RU.start);
      if (this.lastCheck('left', s.checks) < s.time - MIRROR_WINDOW) this.report('NO_MIRROR', s.time, MANEUVER_RU.start);
    }

    if (loc?.type === 'lane') this.limit = loc.lane.speed;
    this.checkSpeed(dt, s, v);

    // Встречная полоса
    if (loc?.type === 'lane' && loc.lateral < -(LANE + 0.6) && v > 5) {
      this.wrong.t += dt;
      if (this.wrong.t > 2.5 && !this.wrong.reported) {
        this.wrong.reported = true;
        this.report('WRONG_SIDE', s.time);
      }
    } else {
      this.wrong.t = 0;
      this.wrong.reported = false;
    }

    // Подъезд к перекрёстку, въезд, выезд
    const prev = this.prev;
    if (loc?.type === 'lane') {
      if (!this.approach || this.approach.lane !== loc.lane) this.approach = { lane: loc.lane, stopped: false };
      if (loc.toEnd < STOP_ZONE && loc.toEnd > -1 && v < STOP_SPEED) this.approach.stopped = true;
      if (prev?.type === 'node' && loc.lane.from === prev.node.id) this.exitNode(prev.node, loc.lane, s);
    } else if (loc?.type === 'node') {
      if (prev?.type === 'lane' && prev.lane.to === loc.node.id && s.speedKmh > 0) this.enterNode(loc.node, prev.lane, s);
      if (this.entry && s.turn === 'right') this.entry.rightSignalAt = s.time;
    }
    this.prev = loc;
  }

  checkSpeed(dt, s, v) {
    const over = v - this.limit;
    if (over > SPEED_TOL) {
      this.over.t += dt;
      const detail = `${Math.round(v)} км/ч при ограничении ${this.limit}`;
      if (over > 10 && this.over.t > 1.0 && !this.over.hard) {
        this.over.hard = true;
        this.report('SPEEDING_HARD', s.time, detail);
      } else if (this.over.t > 1.5 && !this.over.reported && !this.over.hard) {
        this.over.reported = true;
        this.report('SPEEDING', s.time, detail);
      }
    } else if (v <= this.limit) {
      this.over = { t: 0, reported: false, hard: false };
    }
  }

  enterNode(node, lane, s) {
    const c = lane.control;
    const e = {
      node, lane, arm: lane.arm, time: s.time,
      stopped: this.approach?.lane === lane && this.approach.stopped,
      turn: s.turn, checks: { ...s.checks },
      rightSignalAt: s.turn === 'right' ? s.time : -Infinity,
    };
    if (c.type === 'signals') {
      e.light = this.lights.state(c.group, s.time);
      if (e.light === 'red' || e.light === 'redYellow') {
        if (c.arrow) e.pendingArrow = true;
        else this.report('RED_LIGHT', s.time);
      }
    }
    if (c.type === 'stop' && !e.stopped) this.report('STOP_SIGN', s.time);
    this.entry = e;
    this.events.push({ type: 'nodeEnter', node, arm: lane.arm, control: c, time: s.time });
  }

  exitNode(node, outLane, s) {
    const e = this.entry;
    this.entry = null;
    if (!e || e.node !== node) return;
    const armOut = outLane.depArm;
    const movement = movementBetween(e.arm, armOut) || 'uturn';
    const connector = this.net.laneById[node.connectors[`${e.arm}>${armOut}`]];
    const exitIndex = connector?.exitIndex;
    this.events.push({ type: 'nodeExit', node, armIn: e.arm, armOut, movement: e.arm === armOut ? 'uturn' : movement, exitIndex, time: s.time });

    if (e.pendingArrow) {
      if (movement !== 'right') this.report('RED_LIGHT', e.time);
      else if (!e.stopped) this.report('ARROW_NO_STOP', e.time);
    }
    if (node.kind === 'bend') return;

    if (node.kind === 'roundabout') {
      if (s.time - e.rightSignalAt > 3 && s.turn !== 'right') this.report('NO_SIGNAL', s.time, MANEUVER_RU.roundabout);
      if (this.lastCheck('right', s.checks) < e.time - 2) this.report('NO_MIRROR', s.time, MANEUVER_RU.roundabout);
      return;
    }
    if (movement === 'left' || movement === 'right') {
      if (e.turn !== movement) this.report('NO_SIGNAL', s.time, MANEUVER_RU[movement]);
      const before = this.lastCheck(movement, e.checks);
      const now = this.lastCheck(movement, s.checks);
      const ok = before >= e.time - MIRROR_WINDOW || (now >= e.time - MIRROR_WINDOW && now <= e.time + 1.5);
      if (!ok) this.report('NO_MIRROR', s.time, MANEUVER_RU[movement]);
    }
  }
}
