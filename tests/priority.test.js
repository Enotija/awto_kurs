// Тесты приоритета: помеха справа, главная дорога, STOP, налево, rondo, зелёная стрелка
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork } from '../src/world/roadNetwork.js';
import { mustYield } from '../src/rules/priority.js';

const net = buildNetwork();
const node = (kind) => net.nodes.find((n) => n.kind === kind);
const who = (n, arm, out, extra = {}) => ({ arm, conn: n.connectors[`${arm}>${out}`], ...extra });

test('равнозначный перекрёсток: уступаешь тому, кто справа', () => {
  const n = node('equal');
  // Я еду с юга прямо на север, другой — с запада (справа от меня) прямо на восток
  const me = who(n, 'S', 'N'), other = who(n, 'W', 'E');
  assert.equal(mustYield(n, me, other, net), true);
  assert.equal(mustYield(n, other, me, net), false);
});

test('равнозначный: слева — у меня приоритет', () => {
  const n = node('equal');
  const me = who(n, 'S', 'N'), fromLeft = who(n, 'E', 'W');
  assert.equal(mustYield(n, me, fromLeft, net), false);
  assert.equal(mustYield(n, fromLeft, me, net), true);
});

test('налево уступаешь встречному, едущему прямо', () => {
  const n = node('equal');
  const me = who(n, 'S', 'E'), oncoming = who(n, 'N', 'S');
  assert.equal(mustYield(n, me, oncoming, net), true);
  assert.equal(mustYield(n, oncoming, me, net), false);
});

test('направо и встречный прямо — траектории не пересекаются, никто не уступает', () => {
  const n = node('equal');
  const me = who(n, 'S', 'W'), oncoming = who(n, 'N', 'S');
  assert.equal(mustYield(n, me, oncoming, net), false);
  assert.equal(mustYield(n, oncoming, me, net), false);
});

test('STOP на второстепенной: уступаешь главной дороге даже если она слева', () => {
  const n = node('stop'); // главная — N/S, STOP — на E/W
  const me = who(n, 'W', 'E');          // со второстепенной прямо
  const mainFromLeft = who(n, 'N', 'S'); // с главной, для меня — слева
  assert.equal(mustYield(n, me, mainFromLeft, net), true);
  assert.equal(mustYield(n, mainFromLeft, me, net), false);
});

test('примыкание к кольцевой улице: со второстепенной уступаешь', () => {
  const n = net.nodes.find((x) => x.kind === 'tee' && x.control.N?.type === 'yield');
  const stemArm = Object.keys(n.control).find((a) => n.control[a].type === 'yield');
  const ringArms = n.arms.filter((a) => a !== stemArm);
  const me = who(n, stemArm, ringArms[0]);
  const onRing = who(n, ringArms[1], ringArms[0]);
  assert.equal(mustYield(n, me, onRing, net), true);
});

test('rondo: въезжающий уступает тому, кто уже на кольце', () => {
  const n = node('roundabout');
  const me = who(n, 'S', 'N'), ring = who(n, 'W', 'E', { onRing: true });
  assert.equal(mustYield(n, me, ring, net), true);
  assert.equal(mustYield(n, ring, me, net), false);
});

test('светофор: по зелёной стрелке уступаешь всем; налево — встречным', () => {
  const n = node('signals');
  const arrow = who(n, 'S', 'W', { onArrow: true });
  const cross = who(n, 'E', 'W');
  assert.equal(mustYield(n, arrow, cross, net), true);
  const left = who(n, 'S', 'E'), oncoming = who(n, 'N', 'S');
  assert.equal(mustYield(n, left, oncoming, net), true);
  assert.equal(mustYield(n, oncoming, left, net), false);
});
