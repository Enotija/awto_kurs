// Тесты дорожной сети: полосы связаны, траектории поворотов не задевают бордюры
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, locate, movementBetween, RONDO } from '../src/world/roadNetwork.js';
import { pointInConvex, distToSegment } from '../src/world/geometry.js';

const net = buildNetwork();

function distToPoly(poly, x, z) {
  if (pointInConvex(poly, x, z)) return -1;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(x, z, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

test('узлы: 16 перекрёстков, есть светофор, rondo, STOP и равнозначный', () => {
  assert.equal(net.nodes.length, 16);
  const kinds = net.nodes.map((n) => n.kind);
  for (const k of ['signals', 'roundabout', 'stop', 'equal', 'tee', 'bend']) assert.ok(kinds.includes(k), k);
});

test('каждая полоса улицы ведёт хотя бы в одну связку, а связка — в улицу', () => {
  for (const l of net.lanes) {
    assert.ok(l.next.length > 0, `полоса ${l.id} (${l.kind}) тупиковая`);
    for (const n of l.next) assert.ok(net.laneById[n], 'ссылка на несуществующую полосу');
  }
});

test('траектории поворотов не заезжают на бордюр и остров rondo (с запасом на ширину машины)', () => {
  const margin = 0.85 + 0.15;
  for (const l of net.lanes) {
    for (const [x, z] of l.pts) {
      for (const b of net.blocks) {
        const d = distToPoly(b.poly, x, z);
        assert.ok(d >= margin, `полоса ${l.id} (${l.kind} ${l.movement || ''} узел ${l.node ?? l.to}) у бордюра: ${d.toFixed(2)} м в (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
      const rondo = net.nodes.find((n) => n.kind === 'roundabout');
      const dr = Math.hypot(x - rondo.x, z - rondo.z);
      assert.ok(dr >= RONDO.inner + margin, `полоса ${l.id} задевает остров: ${dr.toFixed(2)}`);
    }
  }
});

test('траектории поворотов плавные (радиус не меньше разворота машины)', () => {
  const minR = 4.2; // радиус задней оси при полном выкручивании ~3.8 м
  for (const l of net.lanes) {
    if (l.kind !== 'turn') continue;
    const p = l.pts;
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1], b = p[i], c = p[i + 1];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (area2 < 1e-6) continue;
      const R = (ab * bc * ac) / (2 * area2);
      assert.ok(R >= minR, `связка ${l.id} (${l.movement}) слишком крутая: R=${R.toFixed(2)}`);
    }
  }
});

test('направление поворота: с юга направо — на запад, налево — на восток', () => {
  assert.equal(movementBetween('S', 'W'), 'right');
  assert.equal(movementBetween('S', 'E'), 'left');
  assert.equal(movementBetween('S', 'N'), 'straight');
});

test('rondo: съезды считаются по порядку, направо — 1-й, прямо — 2-й, налево — 3-й', () => {
  const rondo = net.nodes.find((n) => n.kind === 'roundabout');
  const ex = (a, b) => net.laneById[rondo.connectors[`${a}>${b}`]].exitIndex;
  assert.equal(ex('S', 'W'), 1);
  assert.equal(ex('S', 'N'), 2);
  assert.equal(ex('S', 'E'), 3);
  assert.equal(ex('S', 'S'), 4);
});

test('locate: правая полоса по ходу движения и встречная', () => {
  // Улица x = −60 между z = −180 и −60, едем на север по правой полосе (x = −61.75)
  const onRight = locate(net, -61.75, -120, 0);
  assert.equal(onRight.type, 'lane');
  assert.equal(onRight.lane.to, '1,1');
  assert.equal(onRight.wrongWay, false);
  const onLeft = locate(net, -58.25, -120, 0);
  assert.equal(onLeft.wrongWay, true);
  const inNode = locate(net, -60, -60, 0);
  assert.equal(inNode.type, 'node');
  assert.equal(inNode.node.kind, 'signals');
});

test('ограничения скорости: школьная зона 30, по умолчанию 50', () => {
  const school = locate(net, 0, 58.25, Math.PI / 2); // едем на восток по z = 60
  assert.equal(school.lane.speed, 30);
  const normal = locate(net, -61.75, -120, 0);
  assert.equal(normal.lane.speed, 50);
});

test('у каждого подхода к светофору есть сигнализатор; STOP и «уступи» стоят где надо', () => {
  const sigLanes = net.lanes.filter((l) => l.kind === 'road' && l.control.type === 'signals');
  assert.equal(sigLanes.length, 4);
  for (const l of sigLanes) assert.ok(net.lights.some((s) => s.lane === l.id));
  assert.ok(net.signs.some((s) => s.code === 'B-20'));
  assert.ok(net.signs.some((s) => s.code === 'A-7'));
  assert.ok(net.signs.some((s) => s.code === 'D-1'));
  assert.ok(net.signs.some((s) => s.code === 'C-12'));
  assert.ok(net.signs.some((s) => s.code === 'B-33' && s.value === 30));
});
