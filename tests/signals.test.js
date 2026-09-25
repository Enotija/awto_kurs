// Тесты поворотников и аварийки
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signals } from '../src/car/signals.js';

test('поворотник мигает ~75 раз в минуту', () => {
  const s = new Signals();
  s.toggleTurn('left', 0);
  let ticks = 0;
  for (let i = 0; i < 600; i++) if (s.update(0.01, 0)) ticks++;
  // 6 с → 7.5 циклов → 15 переключений
  assert.ok(ticks >= 14 && ticks <= 16, `переключений: ${ticks}`);
});

test('левый поворотник выключается сам, когда руль вернулся после поворота налево', () => {
  const s = new Signals();
  s.toggleTurn('left', 0);
  s.update(0.1, 0.1);
  assert.equal(s.turn, 'left');
  s.update(0.1, 0.6);      // повернули руль налево
  assert.equal(s.turn, 'left');
  s.update(0.1, 0.02);     // руль вернулся
  assert.equal(s.turn, null);
});

test('поворотник не выключается от поворота руля в другую сторону', () => {
  const s = new Signals();
  s.toggleTurn('right', 0);
  s.update(0.1, 0.6);
  s.update(0.1, 0.0);
  assert.equal(s.turn, 'right');
});

test('повторное нажатие выключает поворотник', () => {
  const s = new Signals();
  s.toggleTurn('right', 0);
  s.toggleTurn('right', 1);
  assert.equal(s.turn, null);
});

test('аварийка мигает обеими сторонами', () => {
  const s = new Signals();
  s.toggleHazard();
  s.update(0.05, 0);
  assert.equal(s.leftLamp, true);
  assert.equal(s.rightLamp, true);
});

test('фары: выкл → ближний → дальний → выкл', () => {
  const s = new Signals();
  assert.deepEqual([s.cycleHeadlights(), s.cycleHeadlights(), s.cycleHeadlights()], [1, 2, 0]);
});
