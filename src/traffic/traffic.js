// Живой город без графики: ИИ-машины, велосипедисты, пешеходы.
// ИИ соблюдает те же правила, что и игрок: светофоры, STOP, «уступи», помеху справа,
// rondo, зелёную стрелку, пешеходов; держит дистанцию (модель IDM) и никогда не
// въезжает в то, что у него на пути, включая машину игрока.

import { pointAt, projectOnPath, distToSegment, TAU } from '../world/geometry.js';
import { RONDO } from '../world/roadNetwork.js';
import { mustYield, pathsCross } from '../rules/priority.js';

export const CAR = { L: 4.2, W: 1.75, accel: 1.7, decel: 2.8, s0: 2.2, T: 1.2 };
export const BIKE = { L: 1.8, W: 0.7, accel: 0.9, decel: 2.2, s0: 1.6, T: 1.0, lateral: 1.0, maxV: 18 / 3.6 };
const LOOK = 55;           // м — насколько вперёд смотрит ИИ
const CURVE_ACC = 2.2;     // м/с² — комфортное боковое ускорение в повороте
const PED_WAIT_OFF = 1.0;  // м от бордюра, где пешеход ждёт
const SIGNAL_DIST = 45;    // м до перекрёстка, когда ИИ включает поворотник

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Модель IDM: ускорение при скорости v, желаемой v0, зазоре gap до лидера со скоростью vl
export function idm(v, v0, gap, vl, p) {
  const free = 1 - Math.pow(Math.max(v, 0) / Math.max(v0, 0.1), 4);
  if (!isFinite(gap)) return p.accel * free;
  const dv = v - vl;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.accel * p.decel)));
  return p.accel * (free - (sStar / Math.max(gap, 0.1)) ** 2);
}

const PALETTE = [0xc0392b, 0x2e86de, 0xf1f2f6, 0x2d3436, 0x7f8c8d, 0x27ae60, 0xe1b12c, 0x8e44ad, 0xd35400, 0x1e272e, 0xdfe6e9, 0x0a3d62];
const PED_COLORS = [0x2d6cdf, 0xd64541, 0x2ecc71, 0xf39c12, 0x8e44ad, 0x34495e, 0xe67e22, 0x16a085, 0xecf0f1];

export class Traffic {
  constructor(net, lights, { cars = 24, bikes = 6, pedsPerCrosswalk = 2, seed = 7, avoid = null } = {}) {
    this.net = net;
    this.lights = lights;
    this.rand = mulberry(seed);
    this.vehicles = [];
    this.peds = [];
    this.nextId = 1;
    this.time = 0;
    this.player = null;
    // Минимальный радиус траектории каждой связки — от него скорость в повороте
    for (const lane of net.lanes) lane.minR = lane.minR ?? minRadius(lane.pts);
    for (let i = 0; i < cars; i++) this.spawnVehicle('car', avoid);
    for (let i = 0; i < bikes; i++) this.spawnVehicle('bike', avoid);
    for (const cw of net.crosswalks) {
      for (let k = 0; k < pedsPerCrosswalk; k++) this.spawnPed(cw, k % 2 === 0 ? 1 : -1);
    }
    // Велосипедисты на велодорожке (едут по кругу, с машинами не пересекаются)
    this.pathBikes = [];
    if (bikes > 0) {
      for (const path of net.bikePaths) {
        for (let k = 0; k < 3; k++) {
          this.pathBikes.push({
            path, s: this.rand() * path.len, dir: k % 2 ? -1 : 1, v: 4 + this.rand() * 1.5,
            x: 0, z: 0, heading: 0, color: PALETTE[Math.floor(this.rand() * PALETTE.length)], kind: 'bike',
          });
        }
      }
    }
  }

  L(id) { return this.net.laneById[id]; }

  // ---------- Появление ----------
  spawnVehicle(kind, avoid, tries = 60) {
    const roads = this.net.lanes.filter((l) => l.kind === 'road' && l.len > 30);
    for (let t = 0; t < tries; t++) {
      const lane = roads[Math.floor(this.rand() * roads.length)];
      const s = 8 + this.rand() * (lane.len - 20);
      const p = pointAt(lane, s);
      if (avoid && Math.hypot(p.x - avoid.x, p.z - avoid.z) < (avoid.r ?? 45)) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 14)) continue;
      const v = this.makeVehicle(kind, lane.id, s);
      this.vehicles.push(v);
      return v;
    }
    return null;
  }

  makeVehicle(kind, laneId, s) {
    const spec = kind === 'car' ? CAR : BIKE;
    const lane = this.L(laneId);
    const a = {
      id: this.nextId++, kind, spec, lane: laneId, s,
      L: spec.L, W: spec.W, hl: spec.L / 2, hw: spec.W / 2,
      baseLat: kind === 'bike' ? BIKE.lateral : 0, lat: kind === 'bike' ? BIKE.lateral : 0,
      factor: kind === 'bike' ? 0.85 + this.rand() * 0.25 : 0.88 + this.rand() * 0.14,
      v: 0, acc: 0, plan: [], waitT: 0, stoppedAtLine: false, stopTime: 0, cleared: false, gateOpen: true,
      signal: null, braking: false, bypass: null, x: 0, z: 0, heading: 0, stuckT: 0,
      color: PALETTE[Math.floor(this.rand() * PALETTE.length)],
    };
    a.v = Math.min(lane.speed / 3.6, kind === 'bike' ? BIKE.maxV : 99) * 0.6;
    this.ensurePlan(a);
    this.place(a);
    return a;
  }

  spawnPed(cw, side) {
    const p = {
      id: this.nextId++, cw: cw.id, side, u: side * (cw.halfWidth + PED_WAIT_OFF),
      w: (this.rand() - 0.5) * 2.6, state: 'wait', timer: 1 + this.rand() * 8,
      speed: 1.15 + this.rand() * 0.4, x: 0, z: 0, heading: 0, phase: this.rand() * 6,
      color: PED_COLORS[Math.floor(this.rand() * PED_COLORS.length)],
      hl: 0.3, hw: 0.3,
    };
    this.placePed(p);
    this.peds.push(p);
    return p;
  }

  // ---------- Маршрут ----------
  chooseNext(a, lane) {
    const opts = lane.next.map((id) => this.L(id));
    if (opts.length === 1) return opts[0].id;
    const w = opts.map((c) => {
      const m = c.movement;
      if (a.kind === 'bike') return m === 'straight' ? 6 : m === 'right' ? 4 : m === 'uturn' ? 0 : 0.5;
      return m === 'straight' ? 5 : m === 'uturn' ? 0.15 : 2.5;
    });
    let r = this.rand() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i].id; }
    return opts[0].id;
  }

  ensurePlan(a) {
    while (a.plan.length < 3) {
      const last = this.L(a.plan.length ? a.plan[a.plan.length - 1] : a.lane);
      a.plan.push(this.chooseNext(a, last));
    }
  }

  place(a) {
    const lane = this.L(a.lane);
    const p = pointAt(lane, a.s);
    // Сглаженное направление — по точкам чуть впереди и позади
    const f = this.pointOnPlan(a, a.s + 1.5), b = pointAt(lane, Math.max(0, a.s - 1.5));
    const hx = f.x - b.x, hz = f.z - b.z;
    const h = Math.hypot(hx, hz) > 1e-3 ? Math.atan2(hx, hz) : Math.atan2(p.dx, p.dz);
    a.heading = h;
    a.x = p.x + -p.dz * a.lat;
    a.z = p.z + p.dx * a.lat;
  }

  pointOnPlan(a, s) {
    let lane = this.L(a.lane), i = 0;
    while (s > lane.len && i < a.plan.length) { s -= lane.len; lane = this.L(a.plan[i++]); }
    return pointAt(lane, s);
  }

  // Точки пути впереди (от переднего бампера), каждые 2 м
  lookahead(a, maxDist = LOOK) {
    const out = [];
    let lane = this.L(a.lane), s = a.s + a.hl, i = 0, d = 0;
    while (d <= maxDist) {
      while (s > lane.len) {
        s -= lane.len;
        if (i >= a.plan.length) return out;
        lane = this.L(a.plan[i++]);
      }
      const p = pointAt(lane, s);
      const lat = d < 12 ? a.lat : a.baseLat + (a.lat - a.baseLat) * Math.max(0, 1 - (d - 12) / 10);
      out.push({ x: p.x - p.dz * lat, z: p.z + p.dx * lat, d, lane: lane.id });
      s += 2; d += 2;
    }
    return out;
  }

  // ---------- Кто и где ----------
  // Все участники движения (машины, велосипеды, игрок) в едином виде
  movers() {
    const list = this.vehicles.slice();
    if (this.player) list.push(this.player);
    return list;
  }

  // Что участник делает относительно перекрёстка node (для приоритета)
  approachInfo(o, node) {
    if (o.kind === 'player') return this.playerInfo(o, node);
    const lane = this.L(o.lane);
    if (lane.kind === 'turn' && lane.node === node.id) {
      return {
        inNode: true, arm: lane.arm, conn: lane.id, x: o.x, z: o.z, v: o.v, id: o.id,
        onRing: node.kind === 'roundabout' && onRingBand(node, o.x, o.z),
      };
    }
    if (lane.kind === 'road' && lane.to === node.id) {
      const toEnd = lane.len - (o.s + o.hl);
      if (toEnd > LOOK) return null;
      const waiting = o.v < 0.5;
      const eta = waiting ? (o.gateOpen && toEnd < 3 ? 0.5 : Infinity) : toEnd / o.v;
      return { inNode: false, arm: lane.arm, conn: o.plan[0], eta, waiting, x: o.x, z: o.z, v: o.v, id: o.id };
    }
    return null;
  }

  playerInfo(pl, node) {
    const loc = pl.loc;
    const guess = (arm) => {
      if (!arm) return null;
      for (const out of node.arms) {
        const id = node.connectors[`${arm}>${out}`];
        if (id == null) continue;
        const m = this.L(id).movement;
        if (pl.turn === 'left' && m === 'left') return id;
        if (pl.turn === 'right' && m === 'right') return id;
        if (!pl.turn && m === 'straight') return id;
      }
      return null;
    };
    if (loc?.type === 'node' && loc.node.id === node.id) {
      return {
        inNode: true, arm: pl.entryArm, conn: guess(pl.entryArm), x: pl.x, z: pl.z, v: pl.v, id: pl.id,
        onRing: node.kind === 'roundabout' && onRingBand(node, pl.x, pl.z),
      };
    }
    if (loc?.type === 'lane' && loc.lane.to === node.id && loc.toEnd < LOOK) {
      const waiting = pl.v < 0.5;
      return {
        inNode: false, arm: loc.lane.arm, conn: guess(loc.lane.arm), waiting,
        eta: waiting ? Infinity : loc.toEnd / pl.v, x: pl.x, z: pl.z, v: pl.v, id: pl.id,
      };
    }
    return null;
  }

  // ---------- Решение на стоп-линии ----------
  gate(a, lane, conn, distLine) {
    const node = this.net.nodeById[lane.to];
    const c = lane.control;
    if (this.exitBlocked(conn)) return false;
    const myEta = distLine / Math.max(a.v, 1);
    switch (c.type) {
      case 'signals': {
        const st = this.lights.state(c.group, this.time);
        if (st === 'green') return this.clearToEnter(a, node, conn, myEta, false);
        if (st === 'yellow') return distLine < (a.v * a.v) / (2 * 3.0) + 1;
        if (c.arrow && conn.movement === 'right') {
          if (!a.stoppedAtLine || this.time - a.stopTime < 1.0) return false;
          return this.clearToEnter(a, node, conn, myEta, true);
        }
        return false;
      }
      case 'stop':
        if (!a.stoppedAtLine || this.time - a.stopTime < 1.0) return false;
        return this.clearToEnter(a, node, conn, 0, false);
      case 'none':
        return true;
      default:
        return this.clearToEnter(a, node, conn, myEta, false);
    }
  }

  clearToEnter(a, node, conn, myEta, onArrow) {
    const me = { arm: this.L(a.lane).arm, conn: conn.id, onArrow, onRing: false };
    for (const o of this.movers()) {
      if (o === a) continue;
      const info = this.approachInfo(o, node);
      if (!info) continue;
      if (node.kind === 'roundabout') {
        if (info.onRing && ringUpstream(node, conn, info.x, info.z) && (info.v > 0.3 || ringDist(node, conn, info.x, info.z) < 6)) return false;
        continue;
      }
      if (info.inNode) {
        if (pathsCross(node, me, info) && info.arm !== me.arm) return false;
        continue;
      }
      if (info.eta > myEta + 3.0) continue;
      if (onArrow) {
        // По стрелке уступаем всем, у кого зелёный и чьи пути пересекаются
        const oc = node.control[info.arm];
        if (oc.type === 'signals' && this.lights.state(oc.group, this.time) === 'green' && pathsCross(node, me, info)) return false;
        continue;
      }
      if (mustYield(node, me, info, this.net)) return false;
    }
    // Пешеходы на переходах, через которые проходит связка
    for (const cw of conn.crosswalks) if (this.pedOnCrosswalk(cw.id)) return false;
    return true;
  }

  // Съезд занят стоящей машиной — не въезжаем, чтобы не закупорить перекрёсток
  exitBlocked(conn) {
    const out = conn.next[0];
    return this.vehicles.some((o) => o.lane === out && o.s < 9 && o.v < 1.5)
      || (this.player && this.player.loc?.type === 'lane' && this.player.loc.lane.id === out && this.player.loc.s < 9 && this.player.v < 1.5);
  }

  // ---------- Пешеходы ----------
  crosswalkFrame(cw) {
    const along = cw.roadAxis === 'x' ? [1, 0] : [0, 1];
    const across = cw.roadAxis === 'x' ? [0, 1] : [1, 0];
    return { along, across };
  }

  pedOnCrosswalk(cwId) {
    const cw = this.net.crosswalks[cwId];
    return this.peds.some((p) => p.cw === cwId && p.state === 'cross' && Math.abs(p.u) < cw.halfWidth + 0.4);
  }

  // Пешеход мешает машине, которая пересекает переход в точке поперёк uVeh
  pedBlocks(cwId, uVeh) {
    const cw = this.net.crosswalks[cwId];
    return this.peds.some((p) => {
      if (p.cw !== cwId || p.state !== 'cross') return false;
      if (Math.abs(p.u) > cw.halfWidth + 0.4) return false;
      const dir = -p.side; // куда идёт
      const toward = (uVeh - p.u) * dir > 0;
      return Math.abs(p.u - uVeh) < 4.5 || toward;
    });
  }

  // Можно ли пешеходу выйти на нерегулируемый переход: никто не подъезжает близко
  gapForPed(cw) {
    const { along, across } = this.crosswalkFrame(cw);
    for (const o of this.movers()) {
      const dx = o.x - cw.x, dz = o.z - cw.z;
      const acr = dx * across[0] + dz * across[1];
      if (Math.abs(acr) > cw.halfWidth + 1.5) continue;
      const alg = dx * along[0] + dz * along[1];
      const hv = Math.sin(o.heading) * along[0] + Math.cos(o.heading) * along[1];
      const dist = Math.abs(alg) - cw.len / 2 - (o.hl ?? 2);
      if (dist < 1) return false;                          // уже на переходе
      if (alg * hv >= 0) continue;                         // уезжает
      if (o.v > 1 && dist / o.v < 4.0) return false;       // подъедет раньше, чем через 4 с
      if (dist < 6 && o.v > 0.3) return false;
    }
    return true;
  }

  placePed(p) {
    const cw = this.net.crosswalks[p.cw];
    const { along, across } = this.crosswalkFrame(cw);
    p.x = cw.x + across[0] * p.u + along[0] * p.w;
    p.z = cw.z + across[1] * p.u + along[1] * p.w;
    const dir = p.state === 'cross' ? -p.side : -p.side;
    p.heading = Math.atan2(across[0] * dir, across[1] * dir);
  }

  updatePeds(dt) {
    for (const p of this.peds) {
      const cw = this.net.crosswalks[p.cw];
      if (p.state === 'wait') {
        p.timer -= dt;
        if (p.timer <= 0) {
          const ok = cw.signal ? this.lights.pedestrian(cw.signal, this.time) === 'walk' : this.gapForPed(cw);
          if (ok) p.state = 'cross';
          else p.timer = 0.4;
        }
      } else {
        p.u += -p.side * p.speed * dt;
        p.phase += dt * p.speed * 5;
        if (Math.abs(p.u) >= cw.halfWidth + PED_WAIT_OFF && Math.sign(p.u) === -p.side) {
          p.u = -p.side * (cw.halfWidth + PED_WAIT_OFF);
          p.side = -p.side;
          p.state = 'wait';
          p.timer = 4 + this.rand() * 12;
        }
      }
      this.placePed(p);
    }
  }

  // ---------- Главный шаг ----------
  // player: { x, z, heading, v, hl, hw, turn, loc, entryArm } или null
  update(dt, time, player) {
    this.time = time;
    this.player = player ? { ...player, kind: 'player', id: -1 } : null;
    this.updatePeds(dt);
    for (const b of this.pathBikes) {
      b.s = ((b.s + b.dir * b.v * dt) % b.path.len + b.path.len) % b.path.len;
      const p = pointAt(b.path, b.s);
      // Держаться правой половины велодорожки
      const off = 0.4 * b.dir;
      b.x = p.x - p.dz * off; b.z = p.z + p.dx * off;
      b.heading = Math.atan2(p.dx * b.dir, p.dz * b.dir);
    }
    const movers = this.movers();
    for (const a of this.vehicles) this.stepVehicle(a, dt, movers);
  }

  stepVehicle(a, dt, movers) {
    const lane = this.L(a.lane);
    const spec = a.spec;
    let v0 = Math.min(lane.speed / 3.6 * a.factor, a.kind === 'bike' ? BIKE.maxV * a.factor : 99);
    if (lane.kind === 'turn') v0 = Math.min(v0, Math.sqrt(CURVE_ACC * lane.minR));
    if (a.bypass) v0 = Math.min(v0, 30 / 3.6);

    let gap = Infinity, vl = 0, leader = null;
    const samples = this.lookahead(a);
    // 1) Кто-то на пути (машина, велосипед, игрок)
    for (const o of movers) {
      if (o === a || o.id === a.id) continue;
      const dx = o.x - a.x, dz = o.z - a.z;
      if (dx * dx + dz * dz > (LOOK + 8) ** 2) continue;
      const ox = Math.sin(o.heading), oz = Math.cos(o.heading);
      const A = [o.x - ox * o.hl, o.z - oz * o.hl], B = [o.x + ox * o.hl, o.z + oz * o.hl];
      const lim = a.hw + o.hw + 0.3;
      for (const sp of samples) {
        if (sp.d >= gap) break;
        if (distToSegment(sp.x, sp.z, A, B) < lim) {
          gap = Math.max(0, sp.d - 0.8);
          const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
          vl = Math.max(0, o.v * (ox * fx + oz * fz));
          leader = o;
          break;
        }
      }
    }

    // 2) Следующий поворот — сбросить скорость заранее
    let ahead = lane.len - a.s;
    for (let i = 0; i < a.plan.length && ahead < LOOK; i++) {
      const nl = this.L(a.plan[i]);
      if (nl.kind === 'turn') {
        const vc = Math.sqrt(CURVE_ACC * nl.minR);
        if (vc < a.v) {
          const g = Math.max(0.1, ahead - a.hl);
          // «Виртуальный лидер» со скоростью поворота: к началу дуги как раз успеть сбросить скорость
          if (g + spec.s0 + vc * spec.T < gap) { gap = g + spec.s0 + vc * spec.T; vl = vc; }
        }
      }
      ahead += nl.len;
    }

    // 3) Стоп-линия
    a.signal = null;
    if (lane.kind === 'road' && this.L(a.plan[0])?.kind === 'turn') {
      const conn = this.L(a.plan[0]);
      const distLine = lane.len - (a.s + a.hl);
      if (distLine < SIGNAL_DIST && (conn.movement === 'left' || conn.movement === 'right') && this.net.nodeById[lane.to].kind !== 'bend'
        && this.net.nodeById[lane.to].kind !== 'roundabout') a.signal = conn.movement;
      if (a.v < 0.15 && distLine < 3.5 && !a.stoppedAtLine) { a.stoppedAtLine = true; a.stopTime = this.time; }
      if (!a.cleared && distLine < LOOK) {
        a.gateOpen = this.gate(a, lane, conn, distLine);
        // Останавливаемся у самой линии (IDM иначе держит запас s0)
        const stopGap = Math.max(0, distLine - 0.3 + spec.s0 - 0.5);
        if (!a.gateOpen && stopGap < gap) { gap = stopGap; vl = 0; }
      }
      if (distLine < -0.3) a.cleared = true;
    }
    if (lane.kind === 'turn') {
      const node = this.net.nodeById[lane.node];
      if (node.kind === 'roundabout') a.signal = lane.len - a.s < 16 ? 'right' : null;
      else if (node.kind !== 'bend' && (lane.movement === 'left' || lane.movement === 'right')) a.signal = lane.movement;
    }

    // 4) Пешеходы на переходах впереди
    {
      let offset = -(a.s + a.hl);
      const lanes = [lane, ...a.plan.map((id) => this.L(id))];
      for (const l of lanes) {
        if (offset > LOOK) break;
        for (const cw of l.crosswalks) {
          const d = offset + cw.s - 2.6;
          if (d < -2.5 || d > LOOK) continue;
          const c = this.net.crosswalks[cw.id];
          const { across } = this.crosswalkFrame(c);
          const p = pointAt(l, cw.s);
          const uVeh = (p.x - c.x) * across[0] + (p.z - c.z) * across[1];
          const stopGap = Math.max(0, d + spec.s0 - 0.8);
          if (this.pedBlocks(cw.id, uVeh) && stopGap < gap) { gap = stopGap; vl = 0; }
        }
        offset += l.len;
      }
    }

    // 5) Объезд стоящей машины игрока или велосипедиста
    this.updateBypass(a, lane, leader, gap, movers, dt);

    let acc = idm(a.v, v0, gap, vl, spec);
    acc = Math.max(-8, Math.min(spec.accel, acc));
    a.acc = acc;
    a.v = Math.max(0, a.v + acc * dt);
    if (gap < 0.3 && vl < 0.1) a.v = Math.min(a.v, 0.2);
    a.braking = acc < -0.6 || a.v < 0.2;
    a.s += a.v * dt;
    a.waitT = a.v < 0.3 ? a.waitT + dt : 0;

    // Переход на следующую полосу
    while (a.s > this.L(a.lane).len) {
      a.s -= this.L(a.lane).len;
      a.lane = a.plan.shift();
      a.stoppedAtLine = false;
      a.cleared = false;
      a.gateOpen = true;
      if (a.bypass) { a.bypass = null; }
      this.ensurePlan(a);
    }
    // Боковое смещение (объезд) — плавно
    const latTarget = a.bypass ? a.bypass.lat : a.baseLat;
    const dl = latTarget - a.lat;
    a.lat += Math.sign(dl) * Math.min(Math.abs(dl), 1.1 * dt);
    this.place(a);

    // Застрял надолго вдали от игрока — переставить в другое место
    if (a.waitT > 45 && (!this.player || Math.hypot(a.x - this.player.x, a.z - this.player.z) > 80)) {
      this.respawn(a);
    }
  }

  updateBypass(a, lane, leader, gap, movers, dt) {
    if (a.bypass) {
      const o = movers.find((m) => m.id === a.bypass.id);
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
      const passed = !o || ((o.x - a.x) * fx + (o.z - a.z) * fz) < -(a.hl + (o.hl ?? 1) + 3);
      if (passed || lane.kind !== 'road') a.bypass = null;
      return;
    }
    if (a.kind !== 'car' || !leader || lane.kind !== 'road') return;
    if (lane.len - a.s < 40 || gap > 18) return;
    const slowBike = leader.kind === 'bike';
    const stoppedPlayer = leader.kind === 'player' && leader.v < 0.3;
    if (!slowBike && !stoppedPlayer) { a.bypassWait = 0; return; }
    a.bypassWait = (a.bypassWait || 0) + dt;
    if (a.bypassWait < (stoppedPlayer ? 4 : 1.5)) return;
    // Где препятствие относительно моей полосы
    const pr = projectOnPath(lane, leader.x, leader.z);
    const leftEdge = pr.lateral - leader.hw;
    const clearance = slowBike ? 1.2 : 0.6;
    const lat = Math.max(-3.4, Math.min(0, leftEdge - clearance - a.hw));
    if (lat > -0.2) return;
    if (!this.oppositeClear(a, lane, movers)) return;
    a.bypass = { id: leader.id, lat };
    a.bypassWait = 0;
  }

  oppositeClear(a, lane, movers) {
    for (const o of movers) {
      if (o === a || o.id === a.id) continue;
      const pr = projectOnPath(lane, o.x, o.z);
      if (pr.lateral > -1.0 || pr.dist > 6) continue;
      const rel = pr.s - a.s;
      if (rel > -8 && rel < 75) return false;
    }
    return true;
  }

  respawn(a) {
    const idx = this.vehicles.indexOf(a);
    const avoid = this.player ? { x: this.player.x, z: this.player.z, r: 70 } : null;
    this.vehicles.splice(idx, 1);
    const n = this.spawnVehicle(a.kind, avoid);
    if (!n) this.vehicles.splice(idx, 0, a);
  }

  // Удар игрока: машина ИИ останавливается
  onHit(id) {
    const a = this.vehicles.find((v) => v.id === id);
    if (a) { a.v = 0; a.waitT = 0; }
  }

  // Препятствия рядом с игроком — для столкновений
  obstaclesNear(x, z, r = 14) {
    const out = [];
    for (const a of this.vehicles) {
      if (Math.hypot(a.x - x, a.z - z) > r) continue;
      if (a.kind === 'bike') {
        out.push({ type: 'circle', x: a.x, z: a.z, r: 0.55, kind: 'person', ref: a.id });
        continue;
      }
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading), rx = -fz, rz = fx;
      const poly = [
        [a.x + fx * a.hl + rx * a.hw, a.z + fz * a.hl + rz * a.hw],
        [a.x + fx * a.hl - rx * a.hw, a.z + fz * a.hl - rz * a.hw],
        [a.x - fx * a.hl - rx * a.hw, a.z - fz * a.hl - rz * a.hw],
        [a.x - fx * a.hl + rx * a.hw, a.z - fz * a.hl + rz * a.hw],
      ];
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
      out.push({ type: 'poly', poly, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), kind: 'vehicle', ref: a.id });
    }
    for (const p of this.peds) {
      if (Math.hypot(p.x - x, p.z - z) > r) continue;
      out.push({ type: 'circle', x: p.x, z: p.z, r: 0.35, kind: 'person', ref: p.id });
    }
    return out;
  }
}

function minRadius(pts) {
  let minR = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 < 1e-6) continue;
    minR = Math.min(minR, (ab * bc * ac) / (2 * area2));
  }
  return minR;
}

function onRingBand(node, x, z) {
  const d = Math.hypot(x - node.x, z - node.z);
  return d > RONDO.inner + 0.3 && d < RONDO.outer + 0.8;
}

// Находится ли точка на кольце «выше по течению» от места, где связка conn вливается в кольцо
function ringUpstream(node, conn, x, z) {
  const phi = Math.atan2(z - node.z, x - node.x);
  const d = ((phi - conn.phiIn) % TAU + TAU) % TAU;
  return d < 1.9 || d > TAU - 0.35;
}

function ringDist(node, conn, x, z) {
  const phi = Math.atan2(z - node.z, x - node.x);
  const d = ((phi - conn.phiIn) % TAU + TAU) % TAU;
  return Math.min(d, TAU - d) * RONDO.lane;
}
