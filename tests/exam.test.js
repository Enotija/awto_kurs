// Тесты экзамена: задания площадки, маршрут экзаменатора, подсчёт ошибок
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork } from '../src/world/roadNetwork.js';
import { pointAt } from '../src/world/geometry.js';
import { LUK, HILL, PARKING, heightAt } from '../src/exam/yardLayout.js';
import { LukTask, HillTask, ParkTask } from '../src/exam/yardTasks.js';
import { planRoute, RouteTracker, instructionFor } from '../src/exam/route.js';
import { ExamController } from '../src/exam/exam.js';
import { VIOLATIONS } from '../src/rules/violations.js';

const DT = 1 / 30;
const net = buildNetwork();
const base = { handbrake: false, running: true, stalled: false, collided: null };

// Машина центром на пути łuk в точке s (+ боковое смещение), курс вдоль пути
function lukState(s, v, lat = 0) {
  const p = pointAt(LUK.path, s);
  return { ...base, x: p.x - p.dz * lat, z: p.z + p.dx * lat, heading: Math.atan2(p.dx, p.dz), v };
}

// Проехать по łuk от s0 до s1 со скоростью v (знак — направление), потом постоять
function lukMove(task, s0, s1, lat = 0) {
  const dir = Math.sign(s1 - s0);
  let r;
  for (let s = s0; dir > 0 ? s < s1 : s > s1; s += dir * 2 * DT) {
    r = task.update(DT, lukState(s, dir * 2, lat));
    if (r.status !== 'running') return r;
  }
  for (let i = 0; i < 40; i++) {
    r = task.update(DT, lukState(s1, 0, lat));
    if (r.status !== 'running') return r;
  }
  return r;
}

test('łuk: вперёд до зоны, задом в стартовую зону — зачёт', () => {
  const t = new LukTask();
  const len = LUK.path.len;
  let r = lukMove(t, 2.9, len - 1.975 - 0.7);
  assert.equal(t.phase, 'reverse', 'после остановки в зоне — фаза «назад»');
  r = lukMove(t, len - 1.975 - 0.7, 2.6);
  assert.equal(r.status, 'pass', JSON.stringify(r));
});

test('łuk: колесо на линии — ошибка', () => {
  const t = new LukTask();
  const r = lukMove(t, 2.9, 15, 0.7);
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /linię/);
});

test('łuk: проехал конечную линию — ошибка', () => {
  const t = new LukTask();
  const r = lukMove(t, 2.9, LUK.path.len);
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /końcowej/);
});

test('горка: откат больше 20 см — ошибка, меньше — зачёт', () => {
  for (const [back, expect] of [[0.3, 'fail'], [0.1, 'pass']]) {
    const t = new HillTask();
    const stopZ = HILL.zStart + 8 - 1.975;  // передний бампер в зоне 7–9 м
    const st = (z, v) => ({ ...base, x: HILL.x, z, heading: 0, v });
    let r;
    for (let z = HILL.start.z; z < stopZ; z += 0.05) r = t.update(DT, st(z, 1.5));
    for (let i = 0; i < 30; i++) r = t.update(DT, st(stopZ, 0));
    assert.equal(t.phase, 'start');
    for (let z = stopZ; z > stopZ - back; z -= 0.01) { r = t.update(DT, st(z, -0.3)); if (r.status !== 'running') break; }
    if (r.status === 'running') for (let z = stopZ - back; z < HILL.zStart + HILL.up + HILL.top; z += 0.05) { r = t.update(DT, st(z, 1.5)); if (r.status !== 'running') break; }
    assert.equal(r.status, expect, `откат ${back} м: ${JSON.stringify(r)}`);
  }
});

test('рельеф горки: подъём 12 %, площадка, спуск', () => {
  assert.equal(heightAt(HILL.x, HILL.zStart - 1), 0);
  assert.ok(Math.abs(heightAt(HILL.x, HILL.zStart + 10) - 1.2) < 1e-9);
  assert.ok(Math.abs(heightAt(HILL.x, HILL.zStart + HILL.up + 3) - HILL.up * HILL.grade) < 1e-9);
  assert.equal(heightAt(HILL.x + 10, HILL.zStart + 10), 0);
});

test('парковки: машина внутри места с ручником — зачёт, на линии — ошибка', () => {
  for (const kind of ['perpendicular', 'parallel', 'angled']) {
    const bay = PARKING[kind].bay;
    const [cx, cz] = [bay.corners.reduce((a, p) => a + p[0], 0) / 4, bay.corners.reduce((a, p) => a + p[1], 0) / 4];
    // Для параллельной машина стоит вдоль бордюра, для остальных — вглубь места
    const heading = kind === 'parallel' ? Math.PI / 2 : Math.atan2(bay.dir[0], bay.dir[1]);
    const ok = new ParkTask(kind);
    let r;
    for (let i = 0; i < 40; i++) r = ok.update(DT, { ...base, x: cx, z: cz, heading, v: 0, handbrake: true });
    assert.equal(r.status, 'pass', `${kind}: ${JSON.stringify(r)}`);
    const bad = new ParkTask(kind);
    // Сдвиг поперёк машины на 0.5 м — колесо на боковой линии (для параллельной — вдоль, на торцевую)
    const sx = kind === 'parallel' ? 1.9 : 0.55;
    const ax = kind === 'parallel' ? [1, 0] : [-bay.dir[1], bay.dir[0]];
    r = bad.update(DT, { ...base, x: cx + ax[0] * sx, z: cz + ax[1] * sx, heading, v: 0, handbrake: true });
    assert.equal(r.status, 'fail', `${kind} со сдвигом: ${JSON.stringify(r)}`);
  }
});

test('маршрут экзаменатора проходит светофор, rondo, STOP и равнозначный перекрёсток', () => {
  const start = net.edges.find((e) => e.key === '1,0|1,1').lanes['1,0>1,1'];
  let seed = 5;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const route = planRoute(net, start, rand, { steps: 8 });
  const kinds = new Set(route.map((r) => r.kind));
  for (const k of ['signals', 'roundabout', 'stop', 'equal']) assert.ok(kinds.has(k), `нет ${k}: ${[...kinds]}`);
  // Шаги связаны: выезд одного — подъезд к следующему
  let lane = net.laneById[start];
  for (const step of route) {
    const conn = net.laneById[step.conn];
    assert.ok(lane.next.includes(conn.id), 'шаг не продолжает маршрут');
    lane = net.laneById[conn.next[0]];
  }
  for (const step of route) if (step.kind !== 'bend') assert.ok(instructionFor(step).pl.length > 10);
});

test('команда для rondo называет номер съезда', () => {
  assert.match(instructionFor({ kind: 'roundabout', exitIndex: 2 }).pl, /drugim zjazdem/);
  assert.match(instructionFor({ kind: 'signals', movement: 'left' }).pl, /w lewo/);
});

test('экзамен: вторая одинаковая ошибка — «не сдал», первая — нет', () => {
  const c = new ExamController({ net, cityStart: { x: 0, z: 0, heading: 0 }, cityStartLane: 0, rand: () => 0.3 });
  c.begin();
  c.startCity();
  const v = (code) => ({ type: 'violation', violation: { code, ...VIOLATIONS[code], detail: '' } });
  c.onRulesEvent(v('NO_SIGNAL'));
  assert.equal(c.phase, 'city');
  c.onRulesEvent(v('NO_MIRROR'));
  assert.equal(c.phase, 'city');
  c.onRulesEvent(v('NO_SIGNAL'));
  assert.equal(c.phase, 'done');
  assert.equal(c.passed, false);
});

test('экзамен: критическое нарушение — сразу «не сдал»', () => {
  const c = new ExamController({ net, cityStart: { x: 0, z: 0, heading: 0 }, cityStartLane: 0, rand: () => 0.3 });
  c.begin();
  c.startCity();
  c.onRulesEvent({ type: 'violation', violation: { code: 'RED_LIGHT', ...VIOLATIONS.RED_LIGHT } });
  assert.equal(c.passed, false);
  const res = c.takeCommands().find((x) => x.type === 'result');
  assert.match(res.reason.pl, /Przerwanie/);
});

test('экзамен: два провала одного задания на площадке — «не сдал»; в тренировке — продолжаем', () => {
  const hit = { ...base, ...lukState(3, 0), collided: 'cone' };
  const exam = new ExamController({ net, mode: 'exam', cityStartLane: 0, rand: () => 0.3 });
  exam.begin();
  exam.update(DT, hit);
  assert.equal(exam.phase, 'yard');
  assert.equal(exam.attempt, 2);
  exam.update(DT, hit);
  assert.equal(exam.phase, 'done');
  assert.equal(exam.passed, false);

  const yard = new ExamController({ net, mode: 'yard', cityStartLane: 0, rand: () => 0.3 });
  yard.begin();
  yard.update(DT, hit);
  yard.update(DT, hit);
  assert.equal(yard.phase, 'yard');
  assert.equal(yard.taskIdx, 1, 'перешли ко второму заданию');
});

test('экзамен: маршрут пройден и остановка с ручником — «сдал»', () => {
  const c = new ExamController({ net, cityStart: { x: 0, z: 0, heading: 0 }, cityStartLane: 0, rand: () => 0.3, steps: 2 });
  c.begin();
  c.startCity();
  // Проходим все шаги маршрута «правильно»
  for (const step of c.tracker.route.slice()) {
    c.onRulesEvent({ type: 'nodeExit', node: net.nodeById[step.node], armIn: step.armIn, armOut: step.armOut });
  }
  assert.ok(c.tracker.done);
  for (let i = 0; i < 60; i++) c.update(DT, { ...base, x: 0, z: 0, heading: 0, v: 0, handbrake: true, lowBeam: true, laneId: 3 });
  assert.equal(c.passed, true);
});
