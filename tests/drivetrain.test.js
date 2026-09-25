// Автотесты механики: запуск, трогание, заглохание, переключения.
// Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CarPhysics } from '../src/car/physics/carPhysics.js';

const DT = 1 / 300;

// Прогнать симуляцию: controls(t) → {throttle, brake, clutch, steer}
function run(car, seconds, controls) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    car.step(DT, { throttle: 0, brake: 0, clutch: 0, steer: 0, ...controls(i * DT) });
  }
}

// Машина с заведённым двигателем на нейтрали, ручник опущен
function runningCar() {
  const car = new CarPhysics();
  car.handbrake = false;
  car.startEngine(1);
  run(car, 3, () => ({ clutch: 1 }));
  assert.equal(car.engine.running, true, 'двигатель должен завестись');
  return car;
}

const pedalRelease = (t, t0, duration) => Math.max(0, 1 - Math.max(0, t - t0) / duration);
const stalled = (car) => car.events.some((e) => e.type === 'stall');

test('двигатель заводится и держит холостые ~800 об/мин', () => {
  const car = runningCar();
  run(car, 3, () => ({}));
  assert.ok(Math.abs(car.rpm - 800) < 60, `обороты ${car.rpm.toFixed(0)}`);
});

test('без выжатого сцепления на передаче стартер не крутит', () => {
  const car = new CarPhysics();
  car.gearbox.gear = 1;
  const r = car.startEngine(0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'clutch');
});

test('трогание на 1-й с газом: едем, не глохнем', () => {
  const car = runningCar();
  assert.equal(car.shiftUp(1).ok, true);
  run(car, 4, (t) => ({ throttle: Math.min(0.35, t * 1.6), clutch: pedalRelease(t, 0.3, 0.7) }));
  assert.equal(stalled(car), false, 'не должен заглохнуть');
  assert.ok(car.speedKmh > 8, `скорость ${car.speedKmh.toFixed(1)} км/ч`);
});

test('резко бросить сцепление на 1-й без газа — глохнет', () => {
  const car = runningCar();
  car.shiftUp(1);
  run(car, 2, (t) => ({ clutch: pedalRelease(t, 0.2, 0.15) }));
  assert.equal(stalled(car), true);
});

test('отпускание сцепления за 0.7 с без газа — глохнет', () => {
  const car = runningCar();
  car.shiftUp(1);
  run(car, 3, (t) => ({ clutch: pedalRelease(t, 0.2, 0.7) }));
  assert.equal(stalled(car), true);
});

test('очень плавное отпускание на 1-й без газа — трогается на холостых', () => {
  const car = runningCar();
  car.shiftUp(1);
  // держим педаль около точки схватывания 3 с, потом отпускаем
  run(car, 8, (t) => ({ clutch: t < 1 ? 1 - t * 0.3 : t < 5 ? 0.7 - (t - 1) * 0.05 : Math.max(0, 0.5 - (t - 5)) }));
  assert.equal(stalled(car), false, `обороты ${car.rpm.toFixed(0)}`);
  assert.ok(car.speedKmh > 3, `скорость ${car.speedKmh.toFixed(1)} км/ч`);
});

test('трогание с 3-й передачи — глохнет', () => {
  const car = runningCar();
  car.shiftUp(1); car.shiftUp(1); car.shiftUp(1);
  assert.equal(car.gearbox.gear, 3);
  run(car, 3, (t) => ({ throttle: 0.3, clutch: pedalRelease(t, 0.2, 0.7) }));
  assert.equal(stalled(car), true);
});

// Разогнаться до ~speed км/ч на 2-й
function driveOff(targetKmh) {
  const car = runningCar();
  car.shiftUp(1);
  run(car, 3, (t) => ({ throttle: Math.min(0.4, t * 1.6), clutch: pedalRelease(t, 0.2, 0.8) }));
  assert.equal(car.shiftUp(1).ok, true);
  run(car, 1.2, (t) => ({ clutch: pedalRelease(t, 0.3, 0.6) }));
  run(car, 10, () => ({ throttle: car.speedKmh < targetKmh ? 0.5 : 0 }));
  assert.equal(stalled(car), false, 'разгон без заглохания');
  return car;
}

test('остановка на передаче без сцепления — глохнет', () => {
  const car = driveOff(25);
  run(car, 5, () => ({ brake: 0.8 }));
  assert.ok(Math.abs(car.speedKmh) < 0.5);
  assert.equal(stalled(car), true);
});

test('остановка с выжатым сцеплением — двигатель работает', () => {
  const car = driveOff(25);
  run(car, 5, () => ({ brake: 0.8, clutch: 1 }));
  assert.ok(Math.abs(car.speedKmh) < 0.5);
  assert.equal(stalled(car), false);
  assert.ok(Math.abs(car.rpm - 800) < 100, `обороты ${car.rpm.toFixed(0)}`);
});

test('переключение без сцепления не проходит', () => {
  const car = runningCar();
  const r = car.shiftUp(0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'clutch');
  assert.equal(car.gearbox.gear, 0);
});

test('задняя на ходу не включается', () => {
  const car = driveOff(20);
  const r = car.shiftReverse(1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'reverseMoving');
});

test('задний ход: едем назад', () => {
  const car = runningCar();
  assert.equal(car.shiftReverse(1).ok, true);
  run(car, 3, (t) => ({ throttle: Math.min(0.3, t), clutch: pedalRelease(t, 0.2, 0.8) }));
  assert.equal(stalled(car), false);
  assert.ok(car.speedKmh < -3, `скорость ${car.speedKmh.toFixed(1)} км/ч`);
});

test('ручник держит машину на холостых на 1-й (двигатель глохнет, машина стоит)', () => {
  const car = runningCar();
  car.handbrake = true;
  car.shiftUp(1);
  run(car, 3, (t) => ({ clutch: pedalRelease(t, 0.2, 2.5) }));
  assert.ok(Math.abs(car.speedKmh) < 1, `скорость ${car.speedKmh.toFixed(1)}`);
});

test('разгон 0–100 и максималка разумные', () => {
  const car = runningCar();
  car.shiftUp(1);
  let t100 = null, time = 0;
  let shiftTimer = -1, shifted = false;
  for (let i = 0; i < 300 * 60; i++) {
    time += DT;
    let clutch = 0, throttle = 1;
    // Переключение как у водителя: сбросить газ, выжать, включить, отпустить
    if (shiftTimer < 0 && car.rpm > 5800 && car.gearbox.gear < 5) { shiftTimer = 0.35; shifted = false; }
    if (shiftTimer >= 0) {
      shiftTimer -= DT;
      clutch = 1;
      throttle = 0;
      if (shiftTimer < 0.2 && !shifted) { car.shiftUp(1); shifted = true; }
      if (shiftTimer < 0) shiftTimer = -1;
    }
    const launch = time < 1.2 ? pedalRelease(time, 0.2, 0.8) : 0;
    car.step(DT, { throttle, brake: 0, clutch: Math.max(clutch, launch), steer: 0 });
    if (t100 === null && car.speedKmh >= 100) t100 = time;
  }
  assert.equal(stalled(car), false);
  assert.ok(t100 !== null && t100 > 8 && t100 < 16, `0-100 за ${t100?.toFixed(1)} с`);
  assert.ok(car.speedKmh > 160 && car.speedKmh < 210, `максималка ${car.speedKmh.toFixed(0)} км/ч`);
});
