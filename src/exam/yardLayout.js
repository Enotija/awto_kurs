// Разметка площадки (plac manewrowy) — чистые данные без графики:
// łuk, горка, три парковки, стоящие машины, пачоуки, ограждение, рельеф.

import { makePath, sampleLine, sampleArc, joinPts, pointAt } from '../world/geometry.js';

export const YARD = { x0: 225, x1: 345, z0: -75, z1: 75 };
export const LINE_W = 0.12;       // ширина линии разметки
export const TIRE_HALF = 0.1;     // полуширина шины
// Колёса машины игрока в её системе координат (+X — влево, +Z — вперёд, от центра кузова)
export const WHEELS = [[0.76, 1.25], [-0.76, 1.25], [0.76, -1.3], [-0.76, -1.3]];
export const CAR_HL = 1.975;

export function wheelPoints(x, z, heading) {
  const fx = Math.sin(heading), fz = Math.cos(heading), lx = Math.cos(heading), lz = -Math.sin(heading);
  return WHEELS.map(([a, b]) => [x + lx * a + fx * b, z + lz * a + fz * b]);
}

// ---------- Łuk: прямая 18 м, дуга R = 10 м налево, прямая 4 м ----------
export const LUK = (() => {
  const width = 3.0;
  const x = 240, z0 = -68;
  const straight = sampleLine([x, z0], [x, z0 + 18], 1);
  const c = [x + 10, z0 + 18];
  const arc = sampleArc(c, 10, Math.PI, Math.PI / 2, 0.5);
  const tail = sampleLine([x + 10, z0 + 28], [x + 14, z0 + 28], 1);
  const path = makePath(joinPts(straight, arc, tail));
  return {
    width, path,
    startBox: 5.5,              // длина стартовой зоны от стартовой линии
    endZone: 1.5,               // зона остановки перед конечной линией
    start: { x, z: z0 + 2.9, heading: 0 },
  };
})();

// ---------- Горка: подъём 12 % на 14 м, площадка 8 м, спуск 14 м ----------
export const HILL = {
  x: 285, width: 3.0, rampHalf: 2.5, zStart: -54, up: 14, top: 8, down: 14, grade: 0.12,
  zone: [7, 9],                 // где должен остановиться передний бампер (м от начала подъёма)
  get start() { return { x: this.x, z: this.zStart - 11, heading: 0 }; },
  get length() { return this.up + this.top + this.down; },
};

export function heightAt(x, z) {
  const H = HILL;
  if (Math.abs(x - H.x) > H.rampHalf) return 0;
  const u = z - H.zStart;
  if (u <= 0) return 0;
  const peak = H.up * H.grade;
  if (u < H.up) return u * H.grade;
  if (u < H.up + H.top) return peak;
  if (u < H.length) return peak - (u - H.up - H.top) * H.grade;
  return 0;
}

// ---------- Парковки ----------
// Место: центр, направление «вглубь» (единичный вектор), ширина и длина.
// forbidden — линии, на которые нельзя наезжать (стороны и задняя линия).
function bayRect(cx, cz, dir, width, length) {
  const [dx, dz] = dir;
  const rx = -dz, rz = dx;
  const hw = width / 2, hl = length / 2;
  const P = (a, b) => [cx + rx * a + dx * b, cz + rz * a + dz * b];
  // углы: вход-лево, вход-право, зад-право, зад-лево (вход — сторона, противоположная dir)
  const corners = [P(-hw, -hl), P(hw, -hl), P(hw, hl), P(-hw, hl)];
  return { cx, cz, dir, width, length, corners };
}

function sidesAndBack(b) {
  const [a, bb, c, d] = b.corners;
  return [[bb, c], [c, d], [d, a]];
}

export const PARKING = (() => {
  // Перпендикулярная: ряд мест вдоль проезда z = 10, места уходят на север (+Z)
  const perpRow = [];
  for (let k = -3; k <= 3; k++) perpRow.push(bayRect(250 + k * 2.5, 16.5, [0, 1], 2.5, 5.0));
  const perp = perpRow[3];

  // Параллельная: вдоль бордюра z = 34, место 6 м
  const parallel = bayRect(285, 32.75, [0, 1], 6.0, 2.5);
  // для параллельного «вглубь» — к бордюру; длинная сторона вдоль X
  parallel.corners = [[282, 31.5], [288, 31.5], [288, 34], [282, 34]];
  const parallelForbidden = [[[282, 31.5], [282, 34]], [[288, 31.5], [288, 34]]];

  // Под углом 60°: ряд вдоль проезда z = 44, места смотрят на север-восток
  const ang = Math.PI / 3;
  const angDir = [Math.cos(ang), Math.sin(ang)];
  const angRow = [];
  for (let k = -2; k <= 2; k++) {
    const along = k * 2.5 / Math.sin(ang);
    angRow.push(bayRect(300 + along, 51, angDir, 2.5, 5.0));
  }
  const angled = angRow[2];

  return {
    perpendicular: {
      name: 'Parkowanie prostopadłe', ru: 'Перпендикулярная парковка',
      bay: perp, row: perpRow, forbidden: sidesAndBack(perp),
      start: { x: 234, z: 10.5, heading: Math.PI / 2 },
      parked: perpRow.filter((b, i) => i !== 3 && i !== 0),
    },
    parallel: {
      name: 'Parkowanie równoległe', ru: 'Параллельная парковка',
      bay: parallel, forbidden: parallelForbidden, curb: { minX: 262, maxX: 308, minZ: 34, maxZ: 37 },
      start: { x: 268, z: 29, heading: Math.PI / 2 },
      parked: [
        { cx: 279, cz: 32.75, dir: [1, 0] },
        { cx: 291, cz: 32.75, dir: [1, 0] },
      ],
    },
    angled: {
      name: 'Parkowanie skośne', ru: 'Парковка под углом',
      bay: angled, row: angRow, forbidden: sidesAndBack(angled),
      start: { x: 284, z: 44.5, heading: Math.PI / 2 },
      parked: angRow.filter((b, i) => i !== 2 && i !== 4),
    },
  };
})();

// Линии разметки (для отрисовки): полилинии [[x, z], ...] + цвет
export function yardLines() {
  const lines = [];
  const L = LUK;
  const off = (sgn) => L.path.pts.map((_, i) => {
    const p = pointAt(L.path, L.path.cum[i]);
    return [p.x - p.dz * sgn * L.width / 2, p.z + p.dx * sgn * L.width / 2];
  });
  lines.push({ pts: off(1), color: 'white' }, { pts: off(-1), color: 'white' });
  const across = (s, color) => {
    const p = pointAt(L.path, s);
    const hw = L.width / 2;
    lines.push({ pts: [[p.x - p.dz * hw, p.z + p.dx * hw], [p.x + p.dz * hw, p.z - p.dx * hw]], color, width: color === 'yellow' ? 0.25 : undefined });
  };
  across(0, 'white');
  across(L.startBox, 'yellow');
  across(L.path.len - L.endZone, 'yellow');
  across(L.path.len, 'white');

  const H = HILL;
  const z0 = H.zStart - 15, z1 = H.zStart + H.length + 4;
  for (const sgn of [1, -1]) lines.push({ pts: sampleLine([H.x + sgn * H.width / 2, z0], [H.x + sgn * H.width / 2, z1], 1), color: 'white', onRamp: true });
  for (const u of H.zone) lines.push({ pts: [[H.x - H.width / 2, H.zStart + u], [H.x + H.width / 2, H.zStart + u]], color: 'yellow', onRamp: true, width: 0.3 });

  const bayLines = (b, color = 'white') => {
    const [a, bb, c, d] = b.corners;
    lines.push({ pts: [bb, c], color }, { pts: [c, d], color }, { pts: [d, a], color });
  };
  for (const b of PARKING.perpendicular.row) bayLines(b);
  for (const b of PARKING.angled.row) bayLines(b);
  const pb = PARKING.parallel.bay.corners;
  lines.push({ pts: [pb[0], pb[1]], color: 'white' }, { pts: [pb[0], pb[3]], color: 'white' }, { pts: [pb[1], pb[2]], color: 'white' });
  // Целевые места выделены жёлтым контуром
  for (const k of ['perpendicular', 'angled']) {
    const [a, bb, c, d] = PARKING[k].bay.corners;
    lines.push({ pts: [a, bb], color: 'yellow', width: 0.25 });
  }
  return lines;
}

// Пачоуки (конусы) — у углов зон łuk
export function yardCones() {
  const L = LUK;
  const cones = [];
  for (const s of [0, L.path.len]) {
    const p = pointAt(L.path, s);
    const hw = L.width / 2 + 0.35;
    cones.push([p.x - p.dz * hw, p.z + p.dx * hw], [p.x + p.dz * hw, p.z - p.dx * hw]);
  }
  return cones;
}

// Коллайдеры площадки: ограждение, бордюр параллельной парковки, стенки горки, машины, конусы
export function yardColliders() {
  const c = [];
  const Y = YARD, t = 1;
  c.push(
    { type: 'box', minX: Y.x0 - t, maxX: Y.x1 + t, minZ: Y.z0 - t, maxZ: Y.z0, kind: 'curb' },
    { type: 'box', minX: Y.x0 - t, maxX: Y.x1 + t, minZ: Y.z1, maxZ: Y.z1 + t, kind: 'curb' },
    { type: 'box', minX: Y.x0 - t, maxX: Y.x0, minZ: Y.z0, maxZ: Y.z1, kind: 'curb' },
    { type: 'box', minX: Y.x1, maxX: Y.x1 + t, minZ: Y.z0, maxZ: Y.z1, kind: 'curb' },
    { type: 'box', ...PARKING.parallel.curb, kind: 'curb' },
  );
  const H = HILL;
  for (const sgn of [1, -1]) {
    const x = H.x + sgn * (H.rampHalf + 0.15);
    c.push({ type: 'box', minX: x - 0.15, maxX: x + 0.15, minZ: H.zStart + 0.5, maxZ: H.zStart + H.length - 0.5, kind: 'curb' });
  }
  for (const car of parkedCars()) {
    const fx = car.dir[0], fz = car.dir[1], rx = -fz, rz = fx, hw = 0.88, hl = 2.1;
    const poly = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, r]) => [car.cx + fx * hl * f + rx * hw * r, car.cz + fz * hl * f + rz * hw * r]);
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    c.push({ type: 'poly', poly, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), kind: 'vehicle' });
  }
  for (const [x, z] of yardCones()) c.push({ type: 'circle', x, z, r: 0.2, kind: 'cone' });
  return c;
}

// Стоящие машины на соседних местах
export function parkedCars() {
  const cars = [];
  for (const b of PARKING.perpendicular.parked) cars.push({ cx: b.cx, cz: b.cz, dir: b.dir });
  for (const p of PARKING.parallel.parked) cars.push(p);
  for (const b of PARKING.angled.parked) cars.push({ cx: b.cx, cz: b.cz, dir: b.dir });
  return cars;
}
