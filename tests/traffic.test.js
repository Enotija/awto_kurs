// Тесты живого города: ИИ-машины соблюдают правила, держат дистанцию и не въезжают в игрока
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork } from '../src/world/roadNetwork.js';
import { SignalController } from '../src/rules/lights.js';
import { Traffic } from '../src/traffic/traffic.js';
import { laneBetween, connector } from './helpers.js';

const net = buildNetwork();
const DT = 1 / 30;

function emptyTraffic() {
  return new Traffic(net, new SignalController(), { cars: 0, bikes: 0, pedsPerCrosswalk: 0 });
}

// Поставить машину на полосу с заданным маршрутом
function put(tr, kind, lane, s, plan, v = 0) {
  const a = tr.makeVehicle(kind, lane.id, s);
  a.plan = plan.map((l) => l.id);
  tr.ensurePlan(a);
  a.v = v;
  tr.place(a);
  tr.vehicles.push(a);
  return a;
}

function run(tr, t0, seconds, player = null, each = null) {
  let t = t0;
  for (let i = 0; i < seconds / DT; i++) {
    t += DT;
    tr.update(DT, t, typeof player === 'function' ? player(t) : player);
    each?.(t);
  }
  return t;
}

// Пересекаются ли прямоугольники двух машин
function overlap(a, b) {
  const corners = (o) => {
    const fx = Math.sin(o.heading), fz = Math.cos(o.heading), rx = -fz, rz = fx;
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, r]) => [o.x + fx * o.hl * f + rx * o.hw * r, o.z + fz * o.hl * f + rz * o.hw * r]);
  };
  const A = corners(a), B = corners(b);
  const axes = [a, b].flatMap((o) => [[Math.sin(o.heading), Math.cos(o.heading)], [-Math.cos(o.heading), Math.sin(o.heading)]]);
  for (const [ax, az] of axes) {
    const pa = A.map(([x, z]) => x * ax + z * az), pb = B.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

const lanes = {
  southToSignals: laneBetween(net, '1,0', '1,1'),
  signalsNorth: laneBetween(net, '1,1', '1,2'),
};

test('ИИ стоит на красный у стоп-линии и едет на зелёный', () => {
  const tr = emptyTraffic();
  const lane = lanes.southToSignals;
  const car = put(tr, 'car', lane, 20, [connector(net, '1,1', 'S', 'N'), lanes.signalsNorth], 12);
  run(tr, 18, 15); // NS красный с 17 до 36.5
  const front = car.s + car.hl;
  assert.equal(car.lane, lane.id, 'должен стоять на своей полосе');
  assert.ok(car.v < 0.05, `стоит, v=${car.v}`);
  assert.ok(front <= lane.len + 0.05 && front > lane.len - 3, `у линии: до линии ${(lane.len - front).toFixed(2)} м`);
  run(tr, 33, 12); // зелёный с 38
  assert.notEqual(car.lane, lane.id, 'после зелёного уехал');
});

test('ИИ держит дистанцию до стоящей впереди машины', () => {
  const tr = emptyTraffic();
  const lane = lanes.southToSignals;
  const plan = [connector(net, '1,1', 'S', 'N'), lanes.signalsNorth];
  const lead = put(tr, 'car', lane, 50, plan, 10);
  const follow = put(tr, 'car', lane, 10, plan, 14);
  run(tr, 18, 15);
  const gap = (lead.s - lead.hl) - (follow.s + follow.hl);
  assert.ok(lead.v < 0.05 && follow.v < 0.05);
  assert.ok(gap > 1.2 && gap < 5, `зазор ${gap.toFixed(2)} м`);
});

test('ИИ не въезжает в стоящую машину игрока, почти останавливается и объезжает её, когда встречка свободна', () => {
  const tr = emptyTraffic();
  const lane = laneBetween(net, '1,2', '1,3'); // длинная полоса без перекрёстков по пути
  const car = put(tr, 'car', lane, 5, [connector(net, '1,3', 'S', 'E')], 12);
  const pl = { x: -60 - 1.75 - 0.6, z: 60 + 60, heading: 0, v: 0, hl: 1.975, hw: 0.85, turn: null, loc: null };
  let minDist = Infinity, stoppedBehind = false;
  run(tr, 100, 20, pl, () => {
    const d = Math.hypot(car.x - pl.x, car.z - pl.z);
    minDist = Math.min(minDist, d);
    if (car.v < 1.2 && car.z < pl.z - 5) stoppedBehind = true;
    assert.ok(!overlap(car, { ...pl }), 'ИИ въехал в игрока');
  });
  assert.ok(stoppedBehind, 'сначала сбросил скорость позади');
  assert.ok(car.z > pl.z + 5, `объехал: z=${car.z.toFixed(1)}`);
});

test('равнозначный перекрёсток: машина справа проезжает первой', () => {
  const tr = emptyTraffic();
  // A — с юга прямо на север; B — с запада (справа от A) прямо на восток
  const aLane = laneBetween(net, '2,1', '2,2');
  const bLane = laneBetween(net, '1,2', '2,2');
  const A = put(tr, 'car', aLane, aLane.len - 30, [connector(net, '2,2', 'S', 'N'), laneBetween(net, '2,2', '2,3')], 8);
  const B = put(tr, 'car', bLane, bLane.len - 30, [connector(net, '2,2', 'W', 'E'), laneBetween(net, '2,2', '3,2')], 8);
  let entA = null, entB = null;
  run(tr, 100, 25, null, (t) => {
    if (entA === null && tr.L(A.lane).kind === 'turn') entA = t;
    if (entB === null && tr.L(B.lane).kind === 'turn') entB = t;
    assert.ok(!overlap(A, B), 'столкновение');
  });
  assert.ok(entA !== null && entB !== null, 'оба проехали');
  assert.ok(entB < entA, `B (справа) первым: B=${entB?.toFixed(1)} A=${entA?.toFixed(1)}`);
});

test('STOP: ИИ полностью останавливается у линии', () => {
  const tr = emptyTraffic();
  const lane = laneBetween(net, '0,2', '1,2');
  const car = put(tr, 'car', lane, 30, [connector(net, '1,2', 'W', 'E'), laneBetween(net, '1,2', '2,2')], 12);
  let minV = Infinity;
  run(tr, 100, 25, null, () => {
    if (car.lane === lane.id && lane.len - (car.s + car.hl) < 4) minV = Math.min(minV, car.v);
  });
  assert.ok(minV < 0.05, `мин. скорость у линии ${minV.toFixed(2)}`);
  assert.notEqual(car.lane, lane.id, 'после остановки поехал');
});

test('rondo: въезжающий ждёт машину на кольце', () => {
  const tr = emptyTraffic();
  const rondo = net.nodes.find((n) => n.kind === 'roundabout');
  const ringConn = net.laneById[rondo.connectors['W>E']];
  // Машина на кольце, чуть выше по кругу от въезда с юга
  const onRing = put(tr, 'car', ringConn, 16, [laneBetween(net, '2,1', '3,1')], 4);
  const enterLane = laneBetween(net, '2,0', '2,1');
  const entering = put(tr, 'car', enterLane, enterLane.len - 12, [connector(net, '2,1', 'S', 'N'), laneBetween(net, '2,1', '2,2')], 4);
  let enteredWhileClose = false;
  run(tr, 100, 20, null, () => {
    if (tr.L(entering.lane).kind === 'turn' && tr.L(onRing.lane).kind === 'turn') {
      const d = Math.hypot(entering.x - onRing.x, entering.z - onRing.z);
      if (d < 6) enteredWhileClose = true;
    }
    assert.ok(!overlap(entering, onRing), 'столкновение на кольце');
  });
  assert.ok(!enteredWhileClose, 'въехал прямо перед машиной на кольце');
});

test('ИИ пропускает пешехода на переходе', () => {
  const tr = emptyTraffic();
  const lane = lanes.southToSignals; // на ней переход посреди квартала
  const cw = net.crosswalks[lane.crosswalks[0].id];
  const car = put(tr, 'car', lane, 5, [connector(net, '1,1', 'S', 'N'), lanes.signalsNorth], 13);
  const ped = tr.spawnPed(cw, 1);
  ped.state = 'cross';
  ped.u = 0.5;
  ped.speed = 0.0001; // стоит посреди перехода
  run(tr, 40, 15);
  const cwS = lane.crosswalks[0].s;
  assert.ok(car.s + car.hl < cwS - 2, `остановился перед переходом (перед: ${(cwS - car.s - car.hl).toFixed(1)} м)`);
  assert.ok(car.v < 0.05);
});

test('велосипедиста ИИ обгоняет с интервалом не меньше 1 м', () => {
  const tr = emptyTraffic();
  const lane = laneBetween(net, '1,2', '1,3');
  const bike = put(tr, 'bike', lane, 20, [connector(net, '1,3', 'S', 'E')], 4);
  const car = put(tr, 'car', lane, 2, [connector(net, '1,3', 'S', 'E')], 12);
  let minGap = Infinity;
  run(tr, 100, 25, null, () => {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const lon = (bike.x - car.x) * fx + (bike.z - car.z) * fz;
    if (Math.abs(lon) < car.hl + bike.hl) {
      const lat = Math.abs((bike.x - car.x) * -fz + (bike.z - car.z) * fx);
      minGap = Math.min(minGap, lat - car.hw - bike.hw);
    }
  });
  assert.ok(minGap < Infinity, 'обгон состоялся');
  assert.ok(minGap >= 1.0, `боковой интервал ${minGap.toFixed(2)} м`);
});

test('город 4 минуты: машины не сталкиваются и не встают намертво', () => {
  const tr = new Traffic(net, new SignalController(), { cars: 24, bikes: 6, pedsPerCrosswalk: 2, seed: 3 });
  let collisions = 0, moved = 0, samples = 0;
  const start = new Map(tr.vehicles.map((v) => [v.id, 0]));
  run(tr, 0, 240, null, () => {
    samples++;
    const vs = tr.vehicles;
    for (const v of vs) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.v), 'NaN');
      start.set(v.id, (start.get(v.id) ?? 0) + v.v * DT);
    }
    if (samples % 5 === 0) {
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
        if (Math.hypot(vs[i].x - vs[j].x, vs[i].z - vs[j].z) < 5 && overlap(vs[i], vs[j])) collisions++;
      }
    }
  });
  for (const d of start.values()) if (d > 150) moved++;
  const avg = [...start.values()].reduce((a, b) => a + b, 0) / start.size / 240;
  assert.ok(collisions === 0, `пересечений машин: ${collisions}`);
  assert.ok(avg > 3, `средняя скорость ${(avg * 3.6).toFixed(1)} км/ч`);
  assert.ok(moved >= start.size * 0.8, `проехали больше 150 м: ${moved} из ${start.size}`);
});
