// Нарушения игрока по отношению к другим участникам (без графики):
// не уступил дорогу, не пропустил пешехода, опасный обгон велосипедиста.

import { mustYield, pathsCross } from './priority.js';
import { TAU } from '../world/geometry.js';

export const PRIORITY_ETA = 2.8;   // с — если машина с приоритетом подъедет быстрее, ты ей помешал
export const CYCLIST_MIN_GAP = 1.0;

export class TrafficRules {
  constructor(net, traffic, rules) {
    this.net = net;
    this.traffic = traffic;
    this.rules = rules;
    rules.hooks.push(this);
    this.reset();
  }

  reset() {
    this.cwPrev = new Map();
    this.passing = new Map();
  }

  // Въезд игрока на перекрёсток: запоминаем, кто в этот момент подъезжал или уже ехал через него
  onEnter(node, lane, s, entry) {
    entry.witnesses = [];
    for (const o of this.traffic.vehicles) {
      const info = this.traffic.approachInfo(o, node);
      if (!info) continue;
      if (node.kind === 'roundabout') {
        if (!info.onRing || info.v < 1) continue;
        const any = Object.keys(node.connectors).find((k) => k.startsWith(`${lane.arm}>`));
        const conn = this.net.laneById[node.connectors[any]];
        const phi = Math.atan2(o.z - node.z, o.x - node.x);
        const d = ((phi - conn.phiIn) % TAU + TAU) % TAU;
        if (d < 1.4) entry.witnesses.push({ ...info, rondo: true });
        continue;
      }
      if (info.inNode || (info.eta < PRIORITY_ETA && info.v > 1)) entry.witnesses.push(info);
    }
  }

  // Выезд: теперь известно, куда поехал игрок — проверяем, кому он был обязан уступить
  onExit(node, outLane, e, s) {
    if (!e.witnesses?.length) return;
    const conn = node.connectors[`${e.arm}>${outLane.depArm}`];
    const me = { arm: e.arm, conn, onArrow: !!e.pendingArrow, onRing: false };
    for (const w of e.witnesses) {
      if (w.rondo) { this.rules.report('PRIORITY', e.time, 'на въезде на rondo'); return; }
      if (w.inNode && !pathsCross(node, me, w)) continue;
      if (mustYield(node, me, w, this.net)) {
        this.rules.report('PRIORITY', e.time, whyText(node));
        return;
      }
    }
  }

  // pl: { x, z, heading, v, hl, hw }
  update(dt, pl, time) {
    const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading);
    const rx = -fz, rz = fx;

    // Пешеходы: въехал передним бампером на переход, где идёт пешеход
    const front = [pl.x + fx * pl.hl, pl.z + fz * pl.hl];
    for (const cw of this.net.crosswalks) {
      if (Math.hypot(cw.x - pl.x, cw.z - pl.z) > 14) { this.cwPrev.delete(cw.id); continue; }
      const { along, across } = this.traffic.crosswalkFrame(cw);
      const acr = (pl.x - cw.x) * across[0] + (pl.z - cw.z) * across[1];
      const dirAlong = Math.sign(fx * along[0] + fz * along[1]);
      if (Math.abs(acr) > cw.halfWidth + 0.5 || dirAlong === 0) { this.cwPrev.delete(cw.id); continue; }
      const f = ((front[0] - cw.x) * along[0] + (front[1] - cw.z) * along[1]) * dirAlong;
      const prev = this.cwPrev.get(cw.id);
      if (prev !== undefined && prev < -cw.len / 2 && f >= -cw.len / 2 && pl.v > 0.3) {
        if (this.traffic.pedBlocks(cw.id, acr)) this.rules.report('PEDESTRIAN', time);
      }
      this.cwPrev.set(cw.id, f);
    }

    // Велосипедисты: обгон ближе 1 м
    for (const b of this.traffic.vehicles) {
      if (b.kind !== 'bike') continue;
      const dx = b.x - pl.x, dz = b.z - pl.z;
      if (dx * dx + dz * dz > 15 * 15) { this.passing.delete(b.id); continue; }
      const lon = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      const sameDir = Math.sin(b.heading) * fx + Math.cos(b.heading) * fz > 0.7;
      const alongside = Math.abs(lon) < pl.hl + b.hl + 0.3;
      const st = this.passing.get(b.id) || { reported: false };
      if (alongside && sameDir && pl.v > b.v + 0.8) {
        const gap = Math.abs(lat) - pl.hw - b.hw;
        if (gap < CYCLIST_MIN_GAP && !st.reported) {
          st.reported = true;
          this.rules.report('CYCLIST_GAP', time, `${gap.toFixed(1)} м`);
        }
      }
      if (lon < -(pl.hl + b.hl + 3)) st.reported = false;
      this.passing.set(b.id, st);
    }
  }
}

function whyText(node) {
  if (node.kind === 'equal') return 'помеха справа';
  if (node.kind === 'signals') return 'поворот налево — уступи встречным';
  return 'уступи главной дороге';
}
