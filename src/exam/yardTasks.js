// Задания площадки (без графики). Каждое задание получает состояние машины:
// s = { x, z, heading, v (м/с, + вперёд), handbrake, running, stalled, collided, time }
// и возвращает { status: 'running' | 'pass' | 'fail', reason?, hint? }.

import { projectOnPath, pointInConvex, distToSegment } from '../world/geometry.js';
import { LUK, HILL, PARKING, LINE_W, TIRE_HALF, CAR_HL, wheelPoints } from './yardLayout.js';

const STOPPED = 0.05;        // м/с
const TOUCH = LINE_W / 2 + TIRE_HALF;

function collisionFail(s) {
  if (s.collided === 'cone') return { status: 'fail', reason: 'Potrącenie pachołka', ru: 'Задел пачоук (конус)' };
  if (s.collided) return { status: 'fail', reason: 'Kolizja / najechanie na krawężnik', ru: 'Столкновение или наезд на бордюр' };
  return null;
}

// ---------- Łuk ----------
export class LukTask {
  constructor() {
    this.name = 'Łuk — jazda pasem ruchu do przodu i do tyłu';
    this.ru = 'Łuk: вперёд по полосе до жёлтой зоны, затем задом обратно в стартовую зону';
    this.start = LUK.start;
    this.reset();
  }

  reset() {
    this.phase = 'forward';
    this.stopT = 0;
  }

  get instruction() {
    return this.phase === 'forward'
      ? { pl: 'Proszę jechać pasem do przodu i zatrzymać się w strefie końcowej.', ru: 'Езжай вперёд по полосе и остановись так, чтобы передний бампер был в жёлтой зоне у конечной линии.' }
      : { pl: 'Proszę wrócić tyłem do strefy startowej.', ru: 'Теперь задним ходом по дуге обратно — остановись целиком в стартовой зоне (до жёлтой линии).' };
  }

  update(dt, s) {
    const c = collisionFail(s);
    if (c) return c;
    const L = LUK;
    const halfFree = L.width / 2 - TOUCH;
    for (const [wx, wz] of wheelPoints(s.x, s.z, s.heading)) {
      const pr = projectOnPath(L.path, wx, wz);
      if (pr.s > 0.05 && pr.s < L.path.len - 0.05 && Math.abs(pr.lateral) > halfFree) {
        return { status: 'fail', reason: 'Najechanie kołem na linię', ru: 'Колесо наехало на линию полосы' };
      }
    }
    const sc = projectOnPath(L.path, s.x, s.z).s;
    const front = sc + CAR_HL, rear = sc - CAR_HL;
    const still = Math.abs(s.v) < STOPPED;
    this.stopT = still ? this.stopT + dt : 0;

    if (this.phase === 'forward') {
      if (front > L.path.len + 0.02) return { status: 'fail', reason: 'Przekroczenie linii końcowej', ru: 'Пересёк конечную линию' };
      if (this.stopT > 0.6 && front >= L.path.len - L.endZone) {
        this.phase = 'reverse';
        this.stopT = 0;
        return { status: 'running', hint: 'phase' };
      }
      return { status: 'running' };
    }
    if (rear < -0.02) return { status: 'fail', reason: 'Przekroczenie linii startowej', ru: 'Задним ходом пересёк стартовую линию' };
    if (front > L.path.len + 0.02) return { status: 'fail', reason: 'Przekroczenie linii końcowej', ru: 'Пересёк конечную линию' };
    if (this.stopT > 0.8 && rear >= 0 && front <= L.startBox) return { status: 'pass' };
    return { status: 'running' };
  }
}

// ---------- Трогание в горку ----------
export class HillTask {
  constructor() {
    this.name = 'Ruszanie z miejsca do przodu na wzniesieniu';
    this.ru = 'Горка: остановись в жёлтой зоне на подъёме и тронься, не откатившись назад больше 20 см';
    this.start = HILL.start;
    this.reset();
  }

  reset() {
    this.phase = 'approach';
    this.stopT = 0;
    this.stopU = null;
  }

  get instruction() {
    return this.phase === 'approach'
      ? { pl: 'Proszę wjechać na wzniesienie i zatrzymać się w wyznaczonym miejscu.', ru: 'Заезжай на подъём и остановись: передний бампер — между жёлтыми линиями.' }
      : { pl: 'Proszę ruszyć do przodu.', ru: 'Трогайся вверх. Откат назад больше 20 см — ошибка (ручник поможет).' };
  }

  update(dt, s) {
    const c = collisionFail(s);
    if (c) return c;
    const H = HILL;
    const halfFree = H.width / 2 - TOUCH;
    for (const [wx, wz] of wheelPoints(s.x, s.z, s.heading)) {
      if (wz > H.zStart - 15 && wz < H.zStart + H.length + 4 && Math.abs(wx - H.x) > halfFree) {
        return { status: 'fail', reason: 'Najechanie kołem na linię', ru: 'Колесо наехало на линию' };
      }
    }
    // Положение вдоль подъёма: центр и передний бампер
    const u = s.z - H.zStart;
    const front = u + CAR_HL * Math.cos(s.heading);
    const still = Math.abs(s.v) < STOPPED;
    this.stopT = still ? this.stopT + dt : 0;

    if (this.phase === 'approach') {
      if (front > H.zone[1] + 0.3) return { status: 'fail', reason: 'Niezatrzymanie się w wyznaczonym miejscu', ru: 'Не остановился в жёлтой зоне' };
      if (this.stopT > 0.6 && front >= H.zone[0] && front <= H.zone[1]) {
        this.phase = 'start';
        this.stopU = u;
        return { status: 'running', hint: 'phase' };
      }
      return { status: 'running' };
    }
    if (u < this.stopU - 0.2) return { status: 'fail', reason: 'Stoczenie się pojazdu do tyłu (ponad 20 cm)', ru: 'Машина откатилась назад больше чем на 20 см' };
    if (s.stalled) return { status: 'fail', reason: 'Zgaśnięcie silnika przy ruszaniu', ru: 'Двигатель заглох при трогании' };
    if (front > H.up + H.top - 1) return { status: 'pass' };
    return { status: 'running' };
  }
}

// ---------- Парковки ----------
export class ParkTask {
  constructor(kind) {
    const P = PARKING[kind];
    this.kind = kind;
    this.P = P;
    this.name = P.name;
    this.ru = P.ru;
    this.start = P.start;
    this.reset();
  }

  reset() { this.stopT = 0; }

  get instruction() {
    const how = {
      perpendicular: 'Поставь машину в место с жёлтой линией между стоящими машинами (передом или задом).',
      parallel: 'Задним ходом встань в место у бордюра между двумя машинами.',
      angled: 'Поставь машину в место под углом с жёлтой линией.',
    }[this.kind];
    return { pl: `${this.name}: proszę zaparkować na wyznaczonym miejscu.`, ru: `${how} Все четыре колеса — внутри линий, затем ручник.` };
  }

  // Все колёса внутри места (с учётом ширины линии и шины)
  wheelsInside(s) {
    const poly = this.P.bay.corners;
    const cx = poly.reduce((a, p) => a + p[0], 0) / 4, cz = poly.reduce((a, p) => a + p[1], 0) / 4;
    const shrink = poly.map(([x, z]) => {
      const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz);
      return [x + dx / l * TOUCH * 1.42, z + dz / l * TOUCH * 1.42];
    });
    return wheelPoints(s.x, s.z, s.heading).every(([x, z]) => pointInConvex(shrink, x, z));
  }

  update(dt, s) {
    const c = collisionFail(s);
    if (c) return c;
    for (const [wx, wz] of wheelPoints(s.x, s.z, s.heading)) {
      for (const [a, b] of this.P.forbidden) {
        if (distToSegment(wx, wz, a, b) < TOUCH) return { status: 'fail', reason: 'Najechanie kołem na linię', ru: 'Колесо наехало на линию места' };
      }
    }
    const still = Math.abs(s.v) < STOPPED;
    this.stopT = still ? this.stopT + dt : 0;
    if (this.stopT > 0.8 && s.handbrake && this.wheelsInside(s)) return { status: 'pass' };
    return { status: 'running' };
  }
}
