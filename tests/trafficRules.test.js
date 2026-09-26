// Нарушения игрока относительно других участников: приоритет, пешеходы, велосипедисты
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork } from '../src/world/roadNetwork.js';
import { SignalController } from '../src/rules/lights.js';
import { RulesEngine } from '../src/rules/rules.js';
import { TrafficRules } from '../src/rules/trafficRules.js';
import { Traffic } from '../src/traffic/traffic.js';
import { laneBetween, connector, joinLanes, drive, codes } from './helpers.js';

const net = buildNetwork();

function setup() {
  const lights = new SignalController();
  const traffic = new Traffic(net, lights, { cars: 0, bikes: 0, pedsPerCrosswalk: 0 });
  const rules = new RulesEngine(net, lights);
  rules.reset({ parked: false });
  const tr = new TrafficRules(net, traffic, rules);
  // Каждый шаг игрока — двигаем город
  const step = (state, dt) => {
    const pl = { x: state.x, z: state.z, heading: state.heading, v: state.speedKmh / 3.6, hl: 1.975, hw: 0.85, turn: state.turn, loc: rules.loc, entryArm: rules.entry?.arm };
    traffic.update(dt, state.time, pl);
    tr.update(dt, pl, state.time);
  };
  return { traffic, rules, tr, step };
}

function put(traffic, kind, lane, s, plan, v) {
  const a = traffic.makeVehicle(kind, lane.id, s);
  a.plan = plan.map((l) => l.id);
  traffic.ensurePlan(a);
  a.v = v;
  traffic.place(a);
  traffic.vehicles.push(a);
  return a;
}

// Игрок едет с юга прямо через равнозначный перекрёсток (2,2)
const playerRoute = joinLanes([laneBetween(net, '2,1', '2,2'), connector(net, '2,2', 'S', 'N'), laneBetween(net, '2,2', '2,3')]);

test('помеха справа: въехал, когда справа подъезжала машина, — нарушение', () => {
  const { traffic, rules, step } = setup();
  const bLane = laneBetween(net, '1,2', '2,2'); // с запада — справа от игрока
  // Машина справа окажется у перекрёстка примерно одновременно с игроком
  put(traffic, 'car', bLane, bLane.len - 35, [connector(net, '2,2', 'W', 'E'), laneBetween(net, '2,2', '3,2')], 9);
  drive(rules, playerRoute.path, { speed: 32, startS: playerRoute.ends[0] - 40, endS: playerRoute.ends[1] + 10, t0: 100, after: step });
  assert.ok(codes(rules).includes('PRIORITY'), codes(rules).join());
});

test('машина справа далеко — нарушения нет', () => {
  const { traffic, rules, step } = setup();
  const bLane = laneBetween(net, '1,2', '2,2');
  put(traffic, 'car', bLane, 5, [connector(net, '2,2', 'W', 'E'), laneBetween(net, '2,2', '3,2')], 3);
  drive(rules, playerRoute.path, { speed: 32, startS: playerRoute.ends[0] - 40, endS: playerRoute.ends[1] + 10, t0: 100, after: step });
  assert.ok(!codes(rules).includes('PRIORITY'), codes(rules).join());
});

test('машина слева (у неё нет приоритета) — нарушения нет', () => {
  const { traffic, rules, step } = setup();
  const cLane = laneBetween(net, '3,2', '2,2'); // с востока — слева от игрока
  put(traffic, 'car', cLane, cLane.len - 35, [connector(net, '2,2', 'E', 'W'), laneBetween(net, '2,2', '1,2')], 9);
  drive(rules, playerRoute.path, { speed: 32, startS: playerRoute.ends[0] - 40, endS: playerRoute.ends[1] + 10, t0: 100, after: step });
  assert.ok(!codes(rules).includes('PRIORITY'), codes(rules).join());
});

test('пешеход на переходе: проехал, не пропустив, — нарушение', () => {
  const { traffic, rules, step } = setup();
  const lane = laneBetween(net, '1,0', '1,1');
  const cw = net.crosswalks[lane.crosswalks[0].id];
  const ped = traffic.spawnPed(cw, 1);
  ped.state = 'cross'; ped.u = 1.0; ped.speed = 0.0001;
  const { path } = joinLanes([lane]);
  drive(rules, path, { speed: 30, startS: 5, endS: lane.crosswalks[0].s + 10, t0: 100, after: step });
  assert.ok(codes(rules).includes('PEDESTRIAN'), codes(rules).join());
});

test('пешеход ещё ждёт на тротуаре — нарушения нет', () => {
  const { traffic, rules, step } = setup();
  const lane = laneBetween(net, '1,0', '1,1');
  const cw = net.crosswalks[lane.crosswalks[0].id];
  const ped = traffic.spawnPed(cw, 1);
  ped.state = 'wait'; ped.timer = 999;
  const { path } = joinLanes([lane]);
  drive(rules, path, { speed: 30, startS: 5, endS: lane.crosswalks[0].s + 10, t0: 100, after: step });
  assert.ok(!codes(rules).includes('PEDESTRIAN'), codes(rules).join());
});

test('обгон велосипедиста ближе 1 м — нарушение, с интервалом 1.5 м — нет', () => {
  const lane = laneBetween(net, '1,2', '1,3');
  const { path } = joinLanes([lane]);
  for (const [lat, expect] of [[0.2, true], [-1.8, false]]) {
    const { traffic, rules, step } = setup();
    // Велосипедист у правого края, игрок обгоняет со смещением lat от центра полосы
    const bike = put(traffic, 'bike', lane, 40, [connector(net, '1,3', 'S', 'E')], 4);
    bike.bypass = null;
    drive(rules, path, { speed: 30, startS: 10, endS: 80, t0: 100, after: step, lateral: () => lat });
    assert.equal(codes(rules).includes('CYCLIST_GAP'), expect, `lat ${lat}: ${codes(rules).join()}`);
  }
});
