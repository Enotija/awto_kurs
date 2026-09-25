// Небольшие геометрические утилиты для плоскости XZ (без three.js — работают в тестах).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const TAU = Math.PI * 2;
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

// Правый вектор для направления движения (d.x, d.z). Смотрим вдоль +Z — справа −X.
export const rightOf = ([dx, dz]) => [-dz, dx];
export const leftOf = ([dx, dz]) => [dz, -dx];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
// Знак: > 0 — поворот направо, < 0 — налево (для направлений движения)
export const turnSign = (a, b) => a[0] * b[1] - a[1] * b[0];

// Полилиния: точки [[x, z], ...] + накопленные длины
export function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

function segIndex(path, s) {
  const { cum } = path;
  if (s <= 0) return 0;
  if (s >= path.len) return cum.length - 2;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  return lo;
}

// Точка и направление на расстоянии s от начала пути
export function pointAt(path, s) {
  const i = segIndex(path, s);
  const a = path.pts[i], b = path.pts[i + 1];
  const segLen = path.cum[i + 1] - path.cum[i] || 1e-9;
  const t = clamp((s - path.cum[i]) / segLen, 0, 1);
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[1] + (b[1] - a[1]) * t,
    dx: (b[0] - a[0]) / segLen,
    dz: (b[1] - a[1]) / segLen,
  };
}

// Проекция точки на путь: s вдоль, lateral (+ вправо от направления), расстояние
export function projectOnPath(path, x, z) {
  let best = { s: 0, lateral: 0, dist: Infinity, dx: 0, dz: 1 };
  const { pts, cum } = path;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
    const px = ax + ex * t, pz = az + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist) {
      const l = Math.sqrt(l2);
      const dx = ex / l, dz = ez / l;
      // правый вектор (−dz, dx)
      const lateral = (x - px) * -dz + (z - pz) * dx;
      best = { s: cum[i] + t * l, lateral, dist: d, dx, dz };
    }
  }
  return best;
}

export function sampleLine(a, b, step = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return out;
}

export function sampleArc(c, r, a0, a1, step = 1) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  return out;
}

export function sampleBezier(p0, p1, p2, p3, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// Склеить куски полилиний, убрав повторяющиеся точки на стыках
export function joinPts(...parts) {
  const out = [];
  for (const p of parts) {
    for (const q of p) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-3) out.push(q);
    }
  }
  return out;
}

// Точка внутри выпуклого многоугольника (обход против или по часовой)
export function pointInConvex(poly, x, z) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// Расстояние от точки до отрезка
export function distToSegment(x, z, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez || 1e-9;
  const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / l2, 0, 1);
  return Math.hypot(x - (a[0] + ex * t), z - (a[1] + ez * t));
}

// Углы прямоугольника машины: центр, направление вперёд, полуширина, полудлина
export function boxCorners(cx, cz, heading, hw, hl) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const rx = -fz, rz = fx; // вправо
  return [
    [cx + fx * hl + rx * hw, cz + fz * hl + rz * hw],
    [cx + fx * hl - rx * hw, cz + fz * hl - rz * hw],
    [cx - fx * hl - rx * hw, cz - fz * hl - rz * hw],
    [cx - fx * hl + rx * hw, cz - fz * hl + rz * hw],
  ];
}
