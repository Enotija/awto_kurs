// Тесты правил: светофор, зелёная стрелка, STOP, поворотники, зеркала, скорость, rondo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork } from '../src/world/roadNetwork.js';
import { RulesEngine } from '../src/rules/rules.js';
import { SignalController } from '../src/rules/lights.js';
import { laneBetween, connector, joinLanes, drive, codes } from './helpers.js';

const net = buildNetwork();

// Светофор: NS зелёный в [0,14) цикла 38 с, красный в [17, 36.5)
function engineAt() {
  const e = new RulesEngine(net, new SignalController());
  e.reset({ parked: false });
  return e;
}

// Подъезд с юга к светофору (1,1) и выезд в нужную сторону
function viaSignals(outArm, outNode) {
  const a = laneBetween(net, '1,0', '1,1');
  return { ...joinLanes([a, connector(net, '1,1', 'S', outArm), laneBetween(net, '1,1', outNode)]), first: a };
}

test('светофор: цикл красный → красный+жёлтый → зелёный → жёлтый', () => {
  const l = new SignalController();
  assert.equal(l.state('NS', 1), 'green');
  assert.equal(l.state('NS', 15), 'yellow');
  assert.equal(l.state('NS', 20), 'red');
  assert.equal(l.state('NS', 37), 'redYellow');
  assert.equal(l.state('EW', 1), 'red');
  assert.equal(l.state('EW', 20), 'green');
  assert.equal(l.pedestrian('EW', 20), 'walk');
  assert.equal(l.pedestrian('NS', 20), 'stop');
});

test('прямо на зелёный — без нарушений', () => {
  const e = engineAt();
  const { path, ends } = viaSignals('N', '1,2');
  // На полосе 120 м — въезд примерно через 10 с при 45 км/ч: зелёный NS в [38,52)
  drive(e, path, { speed: 45, t0: 38 - 9, startS: ends[0] - 110, endS: ends[1] + 20 });
  assert.deepEqual(codes(e), []);
});

test('прямо на красный — нарушение', () => {
  const e = engineAt();
  const { path, ends } = viaSignals('N', '1,2');
  drive(e, path, { speed: 45, t0: 12, startS: ends[0] - 110, endS: ends[1] + 20 });
  assert.ok(codes(e).includes('RED_LIGHT'), codes(e).join());
});

test('зелёная стрелка: направо на красный после полной остановки — можно', () => {
  const e = engineAt();
  const { path, ends } = viaSignals('W', '0,1');
  drive(e, path, {
    speed: 30, t0: 10, startS: ends[0] - 60, endS: ends[1] + 20,
    stopAt: ends[0] - 1, stopFor: 2,
    turn: () => 'right', look: (s) => (s > ends[0] - 20 && s < ends[0] - 15 ? 'mirrorRight' : null),
  });
  assert.deepEqual(codes(e), []);
});

test('зелёная стрелка без остановки — нарушение', () => {
  const e = engineAt();
  const { path, ends } = viaSignals('W', '0,1');
  drive(e, path, {
    speed: 30, t0: 13, startS: ends[0] - 60, endS: ends[1] + 20,
    turn: () => 'right', look: (s) => (s > ends[0] - 20 && s < ends[0] - 15 ? 'mirrorRight' : null),
  });
  assert.ok(codes(e).includes('ARROW_NO_STOP'), codes(e).join());
});

test('налево без поворотника и без зеркала — два нарушения', () => {
  const e = engineAt();
  const { path, ends } = viaSignals('E', '2,1');
  drive(e, path, { speed: 30, t0: 38 - 7, startS: ends[0] - 60, endS: ends[1] + 20 });
  const c = codes(e);
  assert.ok(c.includes('NO_SIGNAL'), c.join());
  assert.ok(c.includes('NO_MIRROR'), c.join());
});

test('налево с поворотником и взглядом в левое зеркало — без нарушений', () => {
  const e = engineAt();
  const { path, ends } = viaSignals('E', '2,1');
  drive(e, path, {
    speed: 30, t0: 38 - 7, startS: ends[0] - 60, endS: ends[1] + 20,
    turn: (s) => (s > ends[0] - 40 && s < ends[0] + 5 ? 'left' : null),
    look: (s) => (s > ends[0] - 25 && s < ends[0] - 22 ? 'mirrorLeft' : null),
  });
  assert.deepEqual(codes(e), []);
});

test('STOP: проезд без остановки — нарушение, с остановкой — нет', () => {
  const a = laneBetween(net, '0,2', '1,2'); // с запада к перекрёстку со STOP
  assert.equal(a.control.type, 'stop');
  const route = joinLanes([a, connector(net, '1,2', 'W', 'E'), laneBetween(net, '1,2', '2,2')]);
  const e1 = engineAt();
  drive(e1, route.path, { speed: 25, startS: route.ends[0] - 50, endS: route.ends[1] + 15 });
  assert.ok(codes(e1).includes('STOP_SIGN'));
  const e2 = engineAt();
  drive(e2, route.path, { speed: 25, startS: route.ends[0] - 50, endS: route.ends[1] + 15, stopAt: route.ends[0] - 0.8 });
  assert.ok(!codes(e2).includes('STOP_SIGN'), codes(e2).join());
});

test('скорость: 58 при 50 — превышение, 65 — сильное, 45 в школьной зоне (30) — сильное', () => {
  const a = laneBetween(net, '1,0', '1,1');
  const { path } = joinLanes([a]);
  const e1 = engineAt();
  drive(e1, path, { speed: 58, t0: 100, endS: path.len - 5 });
  assert.ok(codes(e1).includes('SPEEDING'));
  const e2 = engineAt();
  drive(e2, path, { speed: 65, t0: 100, endS: path.len - 5 });
  assert.ok(codes(e2).includes('SPEEDING_HARD'));
  assert.ok(!codes(e2).includes('SPEEDING'));
  const school = laneBetween(net, '1,2', '2,2');
  const e3 = engineAt();
  drive(e3, joinLanes([school]).path, { speed: 45, endS: school.len - 5 });
  assert.ok(codes(e3).includes('SPEEDING_HARD'));
});

test('rondo: съезд без правого поворотника — нарушение; с поворотником и зеркалом — нет', () => {
  const a = laneBetween(net, '1,1', '2,1'); // с запада на кольцо
  const route = joinLanes([a, connector(net, '2,1', 'W', 'E'), laneBetween(net, '2,1', '3,1')]);
  const e1 = engineAt();
  drive(e1, route.path, { speed: 25, startS: route.ends[0] - 40, endS: route.ends[1] + 15 });
  assert.ok(codes(e1).includes('NO_SIGNAL'));
  const e2 = engineAt();
  const ringStart = route.ends[0];
  drive(e2, route.path, {
    speed: 25, startS: route.ends[0] - 40, endS: route.ends[1] + 15,
    turn: (s) => (s > route.ends[1] - 12 ? 'right' : null),
    look: (s) => (s > ringStart + 10 && s < ringStart + 13 ? 'mirrorRight' : null),
  });
  assert.deepEqual(codes(e2), []);
});

test('встречная полоса дольше 2.5 с — нарушение', () => {
  const a = laneBetween(net, '1,0', '1,1');
  const e = engineAt();
  drive(e, joinLanes([a]).path, { speed: 30, endS: a.len - 10, lateral: () => -3.5 });
  assert.ok(codes(e).includes('WRONG_SIDE'));
});

test('трогание от края без поворотника и зеркала — два нарушения', () => {
  const a = laneBetween(net, '1,0', '1,1');
  const e = new RulesEngine(net, new SignalController());
  e.reset({ parked: true });
  drive(e, joinLanes([a]).path, { speed: 20, endS: 30 });
  const c = codes(e);
  assert.ok(c.includes('NO_SIGNAL') && c.includes('NO_MIRROR'), c.join());
});

test('события выезда с перекрёстка сообщают манёвр и номер съезда с кольца', () => {
  const a = laneBetween(net, '1,1', '2,1');
  const route = joinLanes([a, connector(net, '2,1', 'W', 'S'), laneBetween(net, '2,1', '2,0')]);
  const e = engineAt();
  drive(e, route.path, { speed: 25, startS: route.ends[0] - 30, endS: route.ends[1] + 10 });
  const exit = e.takeEvents().find((ev) => ev.type === 'nodeExit');
  assert.equal(exit.node.kind, 'roundabout');
  assert.equal(exit.exitIndex, 3);
});
