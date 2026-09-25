// Дорожная сеть города: перекрёстки (узлы), улицы (рёбра), полосы и связки
// через перекрёстки, переходы, знаки. Чистые данные без графики — ими
// пользуются город (отрисовка), правила, ИИ-машины и экзамен.
//
// Оси: N = +Z, S = −Z, E = +X, W = −X. Движение правостороннее.

import {
  makePath, pointAt, projectOnPath, sampleLine, sampleArc, joinPts,
  rightOf, dot, turnSign, TAU,
} from './geometry.js';

export const GRID = [-180, -60, 60, 180];
export const ROAD_HALF = 3.5;
export const LANE = 1.75;               // центр полосы от оси дороги
export const CORNER_R = 7;              // скругление бордюра на обычном перекрёстке
export const SIDEWALK = 3.2;
export const CURB_H = 0.15;
export const CROSSWALK_LEN = 4;
export const DEFAULT_SPEED = 50;        // населённый пункт
// Кольцо: остров, внешний край, радиус полосы движения, скругление углов кварталов,
// линия «уступи» от центра, радиус дуг въезда/съезда.
export const RONDO = { inner: 5.5, outer: 12, lane: 8.75, cornerR: 19, yieldDist: 14, entryR: 8 };

export const ARMS = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
const ARM_NAMES = ['N', 'E', 'S', 'W'];

// Что стоит на внутренних перекрёстках (индексы сетки i — по X, j — по Z)
const INNER = {
  '1,1': { kind: 'signals', crosswalks: ['N', 'S', 'E', 'W'], arrows: ['N', 'S'] },
  '2,1': { kind: 'roundabout', crosswalks: ['N', 'S', 'E', 'W'] },
  '1,2': { kind: 'stop', main: ['N', 'S'], crosswalks: [] },
  '2,2': { kind: 'equal', crosswalks: ['N', 'S'] },
};
// Примыкания к кольцу: на второстепенной (внутренней) дороге — «уступи» или STOP
const TEE_STEM = { '1,3': 'stop' };

// Ограничения скорости на участках (ключ — пара узлов), км/ч
const SPEED = {
  '1,2|2,2': 30,   // «школьная зона»
  '3,1|3,2': 40,
};
// Переходы посреди квартала: участок → расстояние от первого узла, м
const MID_CROSSWALKS = {
  '1,2|2,2': [60],
  '1,0|1,1': [60],
};

const key = (i, j) => `${i},${j}`;
const edgeKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

// Боковое смещение бордюра от оси дороги на расстоянии d от центра перекрёстка
export function curbOffset(cornerR, d) {
  const start = ROAD_HALF + cornerR;
  if (d >= start) return ROAD_HALF;
  const u = start - d;
  if (u >= cornerR) return ROAD_HALF + cornerR;
  return start - Math.sqrt(cornerR * cornerR - u * u);
}

export function buildNetwork() {
  const net = {
    nodes: [], nodeById: {}, edges: [], lanes: [], laneById: {},
    blocks: [], crosswalks: [], signs: [], lights: [],
  };

  // ---------- Узлы ----------
  for (let i = 0; i < GRID.length; i++) {
    for (let j = 0; j < GRID.length; j++) {
      const arms = [];
      if (j < GRID.length - 1) arms.push('N');
      if (i < GRID.length - 1) arms.push('E');
      if (j > 0) arms.push('S');
      if (i > 0) arms.push('W');
      const spec = INNER[key(i, j)];
      let kind = spec ? spec.kind : arms.length === 3 ? 'tee' : 'bend';
      const node = {
        id: key(i, j), i, j, x: GRID[i], z: GRID[j], kind, arms,
        control: {}, armDist: {}, crosswalkArms: spec?.crosswalks || [],
        cornerR: kind === 'roundabout' ? RONDO.cornerR : CORNER_R,
      };
      for (const a of arms) {
        let c;
        if (kind === 'signals') c = { type: 'signals', group: a === 'N' || a === 'S' ? 'NS' : 'EW', arrow: spec.arrows.includes(a) };
        else if (kind === 'roundabout') c = { type: 'roundabout' };
        else if (kind === 'stop') c = { type: spec.main.includes(a) ? 'priority' : 'stop' };
        else if (kind === 'equal') c = { type: 'equal' };
        else if (kind === 'tee') {
          const missing = ARM_NAMES.find((n) => !arms.includes(n));
          const stem = OPPOSITE[missing];
          c = { type: a === stem ? (TEE_STEM[node.id] || 'yield') : 'priority' };
        } else c = { type: 'none' };
        node.control[a] = c;
        if (kind === 'roundabout') node.armDist[a] = RONDO.yieldDist;
        else node.armDist[a] = node.crosswalkArms.includes(a) ? ROAD_HALF + CORNER_R + 0.5 + CROSSWALK_LEN + 1 : ROAD_HALF + CORNER_R + 0.5;
      }
      net.nodes.push(node);
      net.nodeById[node.id] = node;
    }
  }
  const nodeAt = (i, j) => net.nodeById[key(i, j)];

  // ---------- Кварталы (выпуклые многоугольники со скруглёнными углами) ----------
  for (let i = 0; i < GRID.length - 1; i++) {
    for (let j = 0; j < GRID.length - 1; j++) {
      const x0 = GRID[i] + ROAD_HALF, x1 = GRID[i + 1] - ROAD_HALF;
      const z0 = GRID[j] + ROAD_HALF, z1 = GRID[j + 1] - ROAD_HALF;
      const r = {
        sw: nodeAt(i, j).cornerR, se: nodeAt(i + 1, j).cornerR,
        nw: nodeAt(i, j + 1).cornerR, ne: nodeAt(i + 1, j + 1).cornerR,
      };
      net.blocks.push({ x0, z0, x1, z1, r, poly: roundedRectPoly(x0, z0, x1, z1, r) });
    }
  }

  // ---------- Рёбра и полосы ----------
  const addLane = (lane) => {
    lane.id = net.lanes.length;
    Object.assign(lane, makePath(lane.pts));
    lane.next = [];
    lane.crosswalks = [];
    net.lanes.push(lane);
    net.laneById[lane.id] = lane;
    return lane;
  };
  const armToward = (from, to) => {
    if (to.x > from.x) return 'E';
    if (to.x < from.x) return 'W';
    return to.z > from.z ? 'N' : 'S';
  };

  for (const a of net.nodes) {
    for (const [ni, nj] of [[a.i + 1, a.j], [a.i, a.j + 1]]) {
      const b = nodeAt(ni, nj);
      if (!b) continue;
      const ek = edgeKey(a, b);
      const edge = {
        id: net.edges.length, a: a.id, b: b.id, key: ek,
        axis: a.z === b.z ? 'x' : 'z',
        speed: SPEED[ek] || DEFAULT_SPEED,
        length: Math.hypot(b.x - a.x, b.z - a.z),
        lanes: {},
      };
      net.edges.push(edge);
      for (const [from, to] of [[a, b], [b, a]]) {
        const armFrom = armToward(from, to);
        const armTo = armToward(to, from);
        const d = ARMS[armFrom];
        const r = rightOf(d);
        const s0 = from.armDist[armFrom], s1 = edge.length - to.armDist[armTo];
        const p0 = [from.x + d[0] * s0 + r[0] * LANE, from.z + d[1] * s0 + r[1] * LANE];
        const p1 = [from.x + d[0] * s1 + r[0] * LANE, from.z + d[1] * s1 + r[1] * LANE];
        const lane = addLane({
          kind: 'road', pts: sampleLine(p0, p1, 4), edge: edge.id, from: from.id, to: to.id,
          depArm: armFrom, arm: armTo, dir: d, speed: edge.speed,
          control: to.control[armTo], offsetFromNode: s0,
        });
        edge.lanes[`${from.id}>${to.id}`] = lane.id;
      }
    }
  }

  // ---------- Связки через перекрёстки ----------
  for (const node of net.nodes) {
    node.connectors = {};
    const incoming = net.lanes.filter((l) => l.kind === 'road' && l.to === node.id);
    const outgoing = net.lanes.filter((l) => l.kind === 'road' && l.from === node.id);
    for (const inL of incoming) {
      for (const outL of outgoing) {
        if (outL.depArm === inL.arm && node.kind !== 'roundabout') continue; // разворот только на rondo
        const conn = node.kind === 'roundabout'
          ? rondoConnector(node, inL.arm, outL.depArm)
          : turnConnector(node, inL.arm, outL.depArm);
        const lane = addLane({
          kind: 'turn', pts: conn.pts, node: node.id, arm: inL.arm, outArm: outL.depArm,
          movement: conn.movement, exitIndex: conn.exitIndex, speed: inL.speed,
          prev: inL.id, nextRoad: outL.id,
        });
        lane.next = [outL.id];
        inL.next.push(lane.id);
        node.connectors[`${inL.arm}>${outL.depArm}`] = lane.id;
      }
    }
  }

  // ---------- Пешеходные переходы ----------
  const addCrosswalk = (cw) => {
    cw.id = net.crosswalks.length;
    net.crosswalks.push(cw);
    return cw;
  };
  for (const node of net.nodes) {
    for (const a of node.crosswalkArms) {
      const d = ARMS[a];
      const c0 = node.kind === 'roundabout' ? RONDO.cornerR + ROAD_HALF + 1 : ROAD_HALF + CORNER_R + 0.5;
      const mid = c0 + CROSSWALK_LEN / 2;
      addCrosswalk({
        x: node.x + d[0] * mid, z: node.z + d[1] * mid,
        roadAxis: d[0] !== 0 ? 'x' : 'z', halfWidth: ROAD_HALF, len: CROSSWALK_LEN,
        node: node.id, arm: a,
        signal: node.kind === 'signals' ? (a === 'N' || a === 'S' ? 'EW' : 'NS') : null,
      });
    }
  }
  for (const [ek, list] of Object.entries(MID_CROSSWALKS)) {
    const edge = net.edges.find((e) => e.key === ek);
    const a = net.nodeById[edge.a], b = net.nodeById[edge.b];
    for (const s of list) {
      const t = s / edge.length;
      addCrosswalk({
        x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        roadAxis: edge.axis, halfWidth: ROAD_HALF, len: CROSSWALK_LEN,
        node: null, edge: edge.id, signal: null,
      });
    }
  }
  // Какие переходы лежат на каждой полосе (s — середина перехода вдоль полосы)
  for (const lane of net.lanes) {
    for (const cw of net.crosswalks) {
      const pr = projectOnPath(lane, cw.x, cw.z);
      if (pr.dist < ROAD_HALF + 0.5 && pr.s > 0.5 && pr.s < lane.len - 0.5) {
        lane.crosswalks.push({ id: cw.id, s: pr.s });
      }
    }
    lane.crosswalks.sort((p, q) => p.s - q.s);
  }

  // Какие связки на перекрёстке пересекаются или сливаются (для приоритета и ИИ)
  for (const node of net.nodes) {
    node.conflicts = {};
    const conns = Object.values(node.connectors).map((id) => net.laneById[id]);
    for (const a of conns) {
      node.conflicts[a.id] = new Set();
      for (const b of conns) {
        if (a === b || a.arm === b.arm) continue;
        if (pathsConflict(a, b)) node.conflicts[a.id].add(b.id);
      }
    }
  }

  buildSigns(net);
  return net;
}

// Две траектории конфликтуют, если где-то сближаются меньше чем на 2.4 м
function pathsConflict(a, b) {
  for (const p of a.pts) {
    for (const q of b.pts) {
      if (Math.abs(p[0] - q[0]) < 2.4 && Math.abs(p[1] - q[1]) < 2.4 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 2.4) return true;
    }
  }
  return false;
}

// Рука справа: с какого подъезда машина окажется справа от въезжающего с arm
export const RIGHT_ARM = { S: 'W', W: 'N', N: 'E', E: 'S' };

// ---------- Геометрия связок ----------

function classify(hin, hout) {
  const t = turnSign(hin, hout);
  if (Math.abs(t) < 0.5) return dot(hin, hout) > 0 ? 'straight' : 'uturn';
  return t > 0 ? 'right' : 'left';
}

// Обычный перекрёсток: прямо — отрезок, поворот — дуга вокруг угла бордюра
function turnConnector(node, armIn, armOut) {
  const A = ARMS[armIn], B = ARMS[armOut];
  const hin = [-A[0], -A[1]], hout = B;
  const rin = rightOf(hin), rout = rightOf(hout);
  const dIn = node.armDist[armIn], dOut = node.armDist[armOut];
  const P0 = [node.x + A[0] * dIn + rin[0] * LANE, node.z + A[1] * dIn + rin[1] * LANE];
  const P1 = [node.x + B[0] * dOut + rout[0] * LANE, node.z + B[1] * dOut + rout[1] * LANE];
  const movement = classify(hin, hout);
  if (movement === 'straight') return { pts: sampleLine(P0, P1, 2), movement };

  const k = ROAD_HALF + node.cornerR;
  const C = [node.x + (A[0] + B[0]) * k, node.z + (A[1] + B[1]) * k];
  const R = movement === 'right' ? node.cornerR + LANE : node.cornerR + ROAD_HALF + LANE;
  const T0 = [P0[0] + hin[0] * dot([C[0] - P0[0], C[1] - P0[1]], hin), P0[1] + hin[1] * dot([C[0] - P0[0], C[1] - P0[1]], hin)];
  const T1 = [P1[0] + hout[0] * dot([C[0] - P1[0], C[1] - P1[1]], hout), P1[1] + hout[1] * dot([C[0] - P1[0], C[1] - P1[1]], hout)];
  let a0 = Math.atan2(T0[1] - C[1], T0[0] - C[0]);
  let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= TAU;
  while (da < -Math.PI) da += TAU;
  const pts = joinPts(sampleLine(P0, T0, 2), sampleArc(C, R, a0, a0 + da, 1), sampleLine(T1, P1, 2));
  return { pts, movement };
}

// Направление движения по кольцу в точке с углом phi: остров остаётся слева
const ringTangent = (phi) => [Math.sin(phi), -Math.cos(phi)];

function rondoConnector(node, armIn, armOut) {
  const A = ARMS[armIn], B = ARMS[armOut];
  const hin = [-A[0], -A[1]], hout = B;
  const rin = rightOf(hin), rout = rightOf(hout);
  const c = [node.x, node.z];
  const Rl = RONDO.lane, Re = RONDO.entryR;
  // Дуга въезда касается полосы подъезда и кольца; d0 — где она начинается
  const d0 = Math.sqrt((Re + Rl) ** 2 - (Re + LANE) ** 2);
  const at = (arm, r, d, off) => [c[0] + arm[0] * d + r[0] * off, c[1] + arm[1] * d + r[1] * off];
  const P0 = at(A, rin, RONDO.yieldDist, LANE);
  const T0 = at(A, rin, d0, LANE);
  const E0 = at(A, rin, d0, LANE + Re);          // центр дуги въезда
  const P1 = at(B, rout, RONDO.yieldDist, LANE);
  const T1 = at(B, rout, d0, LANE);
  const E1 = at(B, rout, d0, LANE + Re);         // центр дуги съезда
  const phiIn = Math.atan2(E0[1] - c[1], E0[0] - c[0]);
  const phiOut = Math.atan2(E1[1] - c[1], E1[0] - c[0]);
  const Q0 = [c[0] + Math.cos(phiIn) * Rl, c[1] + Math.sin(phiIn) * Rl];
  const Q1 = [c[0] + Math.cos(phiOut) * Rl, c[1] + Math.sin(phiOut) * Rl];
  const arcShort = (C, R, from, to) => {
    const a0 = Math.atan2(from[1] - C[1], from[0] - C[0]);
    let da = Math.atan2(to[1] - C[1], to[0] - C[0]) - a0;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    return sampleArc(C, R, a0, a0 + da, 1);
  };
  let sweep = ((phiIn - phiOut) % TAU + TAU) % TAU;
  if (sweep < 0.3) sweep += TAU;
  const pts = joinPts(
    sampleLine(P0, T0, 1), arcShort(E0, Re, T0, Q0),
    sampleArc(c, Rl, phiIn, phiIn - sweep, 1),
    arcShort(E1, Re, Q1, T1), sampleLine(T1, P1, 1),
  );
  // Номер съезда: сколько съездов проезжаем, включая свой
  const joinAngle = phiOut - Math.atan2(B[1], B[0]);
  let exitIndex = 0;
  for (const name of ARM_NAMES) {
    if (!node.arms.includes(name)) continue;
    const phiX = Math.atan2(ARMS[name][1], ARMS[name][0]) + joinAngle;
    const along = ((phiIn - phiX) % TAU + TAU) % TAU;
    if (along > 1e-6 && along <= sweep + 1e-6) exitIndex++;
  }
  const movement = armIn === armOut ? 'uturn' : classify(hin, hout);
  return { pts, movement, exitIndex, ringSweep: sweep };
}

export function roundedRectPoly(x0, z0, x1, z1, r) {
  const pts = [];
  const corner = (cx, cz, rad, a0) => {
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (Math.PI / 2) * (k / 8);
      pts.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
    }
  };
  // обход против часовой стрелки (в координатах x, z)
  corner(x1 - r.se, z0 + r.se, r.se, -Math.PI / 2);
  corner(x1 - r.ne, z1 - r.ne, r.ne, 0);
  corner(x0 + r.nw, z1 - r.nw, r.nw, Math.PI / 2);
  corner(x0 + r.sw, z0 + r.sw, r.sw, Math.PI);
  return pts;
}

// ---------- Знаки ----------
// Знак ставится на тротуаре справа от полосы. facing — направление, куда смотрит лицевая сторона
// (навстречу водителю). code: B-20 STOP, A-7 уступи, D-1 главная, A-5 равнозначный,
// C-12 круговое, B-33 ограничение, D-6 переход, D-42 населённый пункт.
function buildSigns(net) {
  const signAt = (lane, sFromEnd, code, extra = {}) => {
    const s = Math.max(1, lane.len - sFromEnd);
    const p = pointAt(lane, s);
    const r = rightOf([p.dx, p.dz]);
    const node = net.nodeById[lane.to];
    const dNode = Math.hypot(p.x - node.x, p.z - node.z) - LANE * 0;
    const off = curbOffset(node.cornerR, dNode) + 0.7 - LANE;
    net.signs.push({
      code, x: p.x + r[0] * off, z: p.z + r[1] * off,
      facing: Math.atan2(-p.dx, -p.dz), lane: lane.id, ...extra,
    });
  };

  for (const lane of net.lanes) {
    if (lane.kind !== 'road') continue;
    const c = lane.control;
    if (c.type === 'stop') signAt(lane, 0.3, 'B-20');
    else if (c.type === 'yield') signAt(lane, 0.3, 'A-7');
    else if (c.type === 'roundabout') { signAt(lane, 0.3, 'C-12'); signAt(lane, 0.3, 'A-7'); } // A-7 над C-12
    else if (c.type === 'priority' && lane.len > 40) signAt(lane, 30, 'D-1');
    else if (c.type === 'equal' && lane.len > 50) signAt(lane, 40, 'A-5');
    if (lane.speed !== DEFAULT_SPEED) {
      const s = Math.min(10, lane.len * 0.2);
      const p = pointAt(lane, s);
      const r = rightOf([p.dx, p.dz]);
      const off = ROAD_HALF + 0.7 - LANE;
      net.signs.push({ code: 'B-33', value: lane.speed, x: p.x + r[0] * off, z: p.z + r[1] * off, facing: Math.atan2(-p.dx, -p.dz), lane: lane.id });
    }
    // D-6 у каждого перехода на этой полосе
    for (const cw of lane.crosswalks) {
      const p = pointAt(lane, cw.s - CROSSWALK_LEN / 2 - 0.3);
      const r = rightOf([p.dx, p.dz]);
      const node = net.nodeById[lane.to];
      const dNode = Math.hypot(p.x - node.x, p.z - node.z);
      const off = curbOffset(node.cornerR, dNode) + 0.7 - LANE;
      net.signs.push({ code: 'D-6', x: p.x + r[0] * off, z: p.z + r[1] * off, facing: Math.atan2(-p.dx, -p.dz), lane: lane.id });
    }
  }
  // Переходы внутри регулируемого перекрёстка обозначает сам светофор; у остальных узлов — D-6
  // на связках не ставим, их видно по разметке.

  // Светофоры: для каждой полосы, подходящей к регулируемому перекрёстку, —
  // ближний сигнализатор у стоп-линии справа и повторитель за перекрёстком.
  for (const lane of net.lanes) {
    if (lane.kind !== 'road' || lane.control.type !== 'signals') continue;
    const node = net.nodeById[lane.to];
    const end = pointAt(lane, lane.len);
    const h = [end.dx, end.dz];
    const r = rightOf(h);
    const off = ROAD_HALF + 0.6 - LANE;
    const facing = Math.atan2(-h[0], -h[1]);
    net.lights.push({
      node: node.id, group: lane.control.group, arrow: lane.control.arrow, lane: lane.id,
      x: end.x + r[0] * off, z: end.z + r[1] * off, facing, overhang: 0,
    });
    // Повторитель на дальней правой стороне, чуть за перекрёстком
    const far = node.armDist[lane.arm] + 0.5;
    const cx = node.x + h[0] * far + r[0] * (ROAD_HALF + 0.6);
    const cz = node.z + h[1] * far + r[1] * (ROAD_HALF + 0.6);
    net.lights.push({ node: node.id, group: lane.control.group, arrow: lane.control.arrow, lane: lane.id, x: cx, z: cz, facing, far: true });
  }
}

// ---------- Запросы ----------

// Где находится точка: на полосе (с учётом направления движения) или на перекрёстке.
// heading — курс машины (0 — вдоль +Z). Возвращает
// { type: 'lane', lane, s, lateral, toEnd, wrongWay } | { type: 'node', node } | null
export function locate(net, x, z, heading) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  for (const edge of net.edges) {
    const a = net.nodeById[edge.a], b = net.nodeById[edge.b];
    const ex = (b.x - a.x) / edge.length, ez = (b.z - a.z) / edge.length;
    const s = (x - a.x) * ex + (z - a.z) * ez;
    const lat = (x - a.x) * -ez + (z - a.z) * ex;
    if (s < 0 || s > edge.length || Math.abs(lat) > ROAD_HALF + 1.2) continue;
    const armA = edge.axis === 'x' ? 'E' : 'N';
    const armB = OPPOSITE[armA];
    if (s < a.armDist[armA] || s > edge.length - b.armDist[armB]) continue;
    const forward = fx * ex + fz * ez >= 0;
    const lane = net.laneById[edge.lanes[forward ? `${a.id}>${b.id}` : `${b.id}>${a.id}`]];
    const pr = projectOnPath(lane, x, z);
    return {
      type: 'lane', lane, s: pr.s, lateral: pr.lateral, toEnd: lane.len - pr.s,
      // центр машины за осью дороги (на встречной половине)
      wrongWay: pr.lateral < -LANE,
    };
  }
  let best = null, bestD = Infinity;
  for (const node of net.nodes) {
    const d = Math.max(Math.abs(x - node.x), Math.abs(z - node.z));
    const lim = Math.max(...Object.values(node.armDist)) + 1;
    if (d < lim && d < bestD) { best = node; bestD = d; }
  }
  return best ? { type: 'node', node: best } : null;
}

// Для какой полосы игрок едет «правильно» — ближайшая полоса с похожим курсом
export function nearestLane(net, x, z, heading, maxDist = 4) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  let best = null;
  for (const lane of net.lanes) {
    const pr = projectOnPath(lane, x, z);
    if (pr.dist > maxDist) continue;
    if (pr.dx * fx + pr.dz * fz < 0.5) continue;
    if (!best || pr.dist < best.dist) best = { lane, ...pr };
  }
  return best;
}

export function movementBetween(armIn, armOut) {
  return classify([-ARMS[armIn][0], -ARMS[armIn][1]], ARMS[armOut]);
}
