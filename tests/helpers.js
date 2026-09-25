// Помощники для тестов: «виртуальная машина» едет по списку полос.
import { makePath, pointAt } from '../src/world/geometry.js';

export function laneBetween(net, from, to) {
  const e = net.edges.find((ed) => (ed.a === from && ed.b === to) || (ed.a === to && ed.b === from));
  return net.laneById[e.lanes[`${from}>${to}`]];
}

export function connector(net, nodeId, armIn, armOut) {
  return net.laneById[net.nodeById[nodeId].connectors[`${armIn}>${armOut}`]];
}

// Склеить полосы в один путь; stops — глобальные s концов полос
export function joinLanes(lanes) {
  const pts = [];
  const ends = [];
  for (const l of lanes) {
    for (const p of l.pts) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-3) pts.push(p);
    }
    ends.push(makePath(pts).len);
  }
  return { path: makePath(pts), ends };
}

// Проехать путь. opts:
//   speed — км/ч (число или функция (s, t) → км/ч)
//   stopAt — глобальное s, где остановиться на stopFor секунд
//   turn(s, t) — какой поворотник включён
//   look(s, t) — какое зеркало проверяем в этот момент (имя из checks) или null
//   t0 — время старта; dt — шаг; startS / endS
export function drive(engine, path, opts = {}) {
  const dt = opts.dt ?? 0.05;
  let t = opts.t0 ?? 0;
  let s = opts.startS ?? 0;
  const endS = opts.endS ?? path.len;
  let v = 0;
  let stopTimer = opts.stopFor ?? 2;
  let stopped = false;
  const checks = { mirrorLeft: -Infinity, mirrorRight: -Infinity, mirrorInner: -Infinity, shoulderLeft: -Infinity, shoulderRight: -Infinity, ...(opts.checks || {}) };
  while (s < endS) {
    let target = typeof opts.speed === 'function' ? opts.speed(s, t) : (opts.speed ?? 30);
    if (opts.stopAt !== undefined && !stopped) {
      const dist = opts.stopAt - s;
      if (dist < 0.5) {
        target = 0;
        if (v < 0.01) { stopTimer -= dt; if (stopTimer <= 0) stopped = true; }
      } else {
        target = Math.min(target, Math.sqrt(2 * 3 * Math.max(0, dist - 0.5)) * 3.6);
      }
    }
    const tv = target / 3.6;
    v = v < tv ? Math.min(tv, v + 3 * dt) : Math.max(tv, v - 6 * dt);
    s += v * dt;
    t += dt;
    const look = opts.look?.(s, t);
    if (look) checks[look] = t;
    const p = pointAt(path, Math.min(s, path.len));
    const lat = opts.lateral?.(s, t) ?? 0;
    engine.update(dt, {
      x: p.x + -p.dz * lat, z: p.z + p.dx * lat, heading: Math.atan2(p.dx, p.dz),
      speedKmh: v * 3.6, time: t, turn: opts.turn?.(s, t) ?? null, checks,
    });
  }
  return t;
}

export const codes = (engine) => engine.log.map((v) => v.code);
