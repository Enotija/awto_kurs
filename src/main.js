import './ui/hud.css';
import * as THREE from 'three';
import { City } from './world/city.js';
import { PlayerCar } from './car/playerCar.js';
import { Input } from './input/input.js';
import { Hud } from './ui/hud.js';
import { CarAudio } from './audio/carAudio.js';
import { RulesEngine } from './rules/rules.js';
import { Journal } from './ui/journal.js';
import { createAutopilot, routeHelpers } from './debug/autopilot.js';
import { Traffic } from './traffic/traffic.js';
import { TrafficView } from './traffic/trafficView.js';
import { TrafficRules } from './rules/trafficRules.js';

// ---------- Рендер и сцена ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // карта теней строится один раз за кадр
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const DAY = { sky: 0x9cc3e6, hemi: 1.9, sun: 2.7, sunColor: 0xfff2dc };
const NIGHT = { sky: 0x0a1020, hemi: 0.12, sun: 0.15, sunColor: 0x8fa8ff };
scene.background = new THREE.Color(DAY.sky);
scene.fog = new THREE.Fog(DAY.sky, 220, 850);

const hemi = new THREE.HemisphereLight(0xe2efff, 0x7a8068, DAY.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 10, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.38, 0.78, -0.5).normalize();

// ---------- Мир, машина, ввод ----------
const city = new City(scene);
const car = new PlayerCar(scene);
car.reset(city.spawn);
const input = new Input(window);
const hud = new Hud();
const journal = new Journal();
const audio = new CarAudio();
const rules = new RulesEngine(city.net, city.signals);
rules.reset({ parked: city.spawn.parked });
const traffic = new Traffic(city.net, city.signals, { avoid: { x: city.spawn.x, z: city.spawn.z, r: 50 } });
const trafficView = new TrafficView(scene);
const trafficRules = new TrafficRules(city.net, traffic, rules);

let paused = true;
let started = false;
let night = false;
let time = 0;
let droveOff = false; // уже трогался — убираем подсказки по троганию

function resume() {
  started = true;
  paused = false;
  hud.setOverlay(false, true);
  audio.init();
  audio.setMuted(audio.muted);
}
function pause() {
  paused = true;
  hud.setOverlay(true, started);
  audio.suspend();
}

// Пауза/подсказка обрабатываются прямо в обработчике клавиш —
// браузер разрешает звук только внутри действия пользователя.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1' || e.code === 'Escape') {
    e.preventDefault();
    if (paused) resume(); else pause();
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && paused) {
    resume();
  }
});
hud.el.overlay.addEventListener('click', () => { if (paused) resume(); });
window.addEventListener('blur', () => { if (!paused) pause(); });

function setNight(on) {
  night = on;
  const p = on ? NIGHT : DAY;
  scene.background.setHex(p.sky);
  scene.fog.color.setHex(p.sky);
  hemi.intensity = p.hemi;
  sun.intensity = p.sun;
  sun.color.setHex(p.sunColor);
  city.setNight(on);
  trafficView.setNight(on);
  hud.message(on ? 'Ночь. Включи фары — L' : 'День', 'info');
}

// ---------- Команды и события ----------
function handleAction(a, controls) {
  switch (a) {
    case 'help': if (paused) resume(); else pause(); return;
    case 'mute':
      audio.setMuted(!audio.muted);
      hud.message(audio.muted ? 'Звук выключен' : 'Звук включён');
      return;
    case 'night': setNight(!night); return;
    case 'journal': journal.toggle(); return;
    case 'reset':
      car.reset(city.spawn);
      rules.reset({ parked: city.spawn.parked });
      trafficRules.reset();
      journal.clear();
      droveOff = false;
      hud.message('Машина возвращена на старт', 'info');
      return;
    default: car.action(a, controls, time);
  }
}

function stallText(e) {
  const c = car.physics.lastControls;
  const v = Math.abs(e.speed);
  let why;
  if (time - car.lastCollisionAt < 0.5) why = 'удар о препятствие';
  else if (c.brake > 0.15 && c.clutch < 0.85) why = 'тормозишь на передаче — перед остановкой выжми сцепление';
  else if (e.gear >= 2 && v < 2) why = 'трогаться нужно с 1-й передачи';
  else if (v < 2.5) why = 'сцепление отпущено слишком резко или мало газа';
  else why = 'слишком низкие обороты — включи передачу ниже';
  return `Двигатель заглох: ${why}. Завести снова: Shift + K`;
}

const GRIND = {
  clutch: 'Скрежет! Выжми сцепление до конца (держи Shift), потом переключай',
  reverseMoving: 'Задняя передача — только после полной остановки',
  forwardRollingBack: 'Сначала останови машину',
};

function handleEvent(e) {
  switch (e.type) {
    case 'stall': audio.clunk(); hud.message(stallText(e), 'bad', 5); break;
    case 'started': hud.message('Двигатель заведён', 'good'); break;
    case 'startFailed': hud.message('Не завелось — попробуй ещё раз (K)', 'warn'); break;
    case 'startDenied':
      if (e.reason === 'clutch') hud.message('Чтобы завести, выжми сцепление (держи Shift) или поставь нейтраль', 'warn');
      break;
    case 'grind': audio.grind(); hud.message(GRIND[e.reason] || 'Передача не включилась', 'bad'); break;
    case 'handbrake': audio.clunk(); hud.message(e.on ? 'Ручник затянут' : 'Ручник опущен'); break;
    case 'hazard': hud.message(e.on ? 'Аварийка включена' : 'Аварийка выключена'); break;
    case 'lights': hud.message(['Фары выключены', 'Ближний свет', 'Дальний свет'][e.mode]); break;
    case 'tick': audio.tick(e.on); break;
    case 'collision':
      audio.thud(e.speed);
      if (e.kind === 'curb') rules.report('CURB', time);
      else if (e.kind === 'vehicle') { rules.report('COLLISION', time, 'с автомобилем'); traffic.onHit(e.ref); }
      else if (e.kind === 'person') rules.report('COLLISION', time, 'с пешеходом или велосипедистом');
      break;
    case 'overrev': hud.message('Перекрутка двигателя! Передача слишком низкая для этой скорости', 'bad'); break;
    default: break;
  }
}

function updateHint() {
  const p = car.physics;
  const kmh = Math.abs(p.speedKmh);
  if (kmh > 8) droveOff = true;
  if (!p.engine.running) {
    hud.setHint(p.engine.cranking > 0 ? 'Заводим…' : 'Двигатель заглушен: выжми сцепление (держи Shift) и нажми K', true);
  } else if (p.handbrake && kmh > 1) {
    hud.setHint('Ручник затянут! Опусти его — Space', true);
  } else if (!droveOff && p.gearbox.gear === 0) {
    hud.setHint('Держи Shift (сцепление) и включи 1-ю передачу — E');
  } else if (!droveOff && p.gearbox.gear >= 1 && p.handbrake) {
    hud.setHint('Опусти ручник — Space');
  } else if (!droveOff && p.gearbox.gear >= 1 && rules.parked && car.signals.turn !== 'left') {
    hud.setHint('Отъезжаешь от края: включи левый поворотник (Z) и посмотри в левое зеркало (←)');
  } else if (!droveOff && p.gearbox.gear >= 1) {
    hud.setHint('Держи W (газ) и отпусти Shift. Мягче — придерживай Shift в жёлтой зоне шкалы «С»');
  } else if (p.gearbox.gear > 0 && p.gearbox.gear < 5 && p.rpm > 5200) {
    hud.setHint('Высокие обороты — переключись выше: отпусти W, Shift + E');
  } else {
    hud.setHint('');
  }
  const look = car.view.looking;
  hud.setLook(look ? `Взгляд: ${car.view.targets[look].label}` : '');
}

// ---------- Солнце и тени следуют за машиной ----------
function updateSun() {
  const p = car.position;
  sun.position.copy(p).addScaledVector(SUN_DIR, 160);
  sun.target.position.copy(p);
  sun.target.updateMatrixWorld();
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  car.view.setAspect(window.innerWidth / window.innerHeight);
}
window.addEventListener('resize', onResize);

// ---------- Главный цикл ----------
function tick(dt) {
  if (paused) {
    input.readGamepad();
    for (const a of input.takeActions()) if (a === 'help') resume();
    return;
  }
  time += dt;
  const controls = input.update(dt, car.physics.v);
  for (const a of input.takeActions()) handleAction(a, controls);
  const p0 = car.physics;
  const pl = {
    x: p0.centerX, z: p0.centerZ, heading: p0.heading, v: Math.abs(p0.v), hl: p0.p.length / 2, hw: p0.p.width / 2,
    turn: car.signals.hazard ? null : car.signals.turn, loc: rules.loc, entryArm: rules.entry?.arm,
  };
  traffic.update(dt, time, pl);
  const colliders = city.colliders.concat(traffic.obstaclesNear(pl.x, pl.z));
  car.update(dt, controls, colliders, time, input);
  city.update(time);
  for (const e of car.physics.events.splice(0)) handleEvent(e);
  for (const e of car.events.splice(0)) handleEvent(e);
  const p = car.physics;
  rules.update(dt, {
    x: p.centerX, z: p.centerZ, heading: p.heading, speedKmh: p.speedKmh, time,
    turn: car.signals.hazard ? null : car.signals.turn, checks: car.view.checks,
  });
  trafficRules.update(dt, pl, time);
  trafficView.update(traffic, time);
  for (const e of rules.takeEvents()) {
    if (e.type !== 'violation') continue;
    const v = e.violation;
    journal.add(v);
    hud.message(`${v.ru}${v.detail ? ` — ${v.detail}` : ''}`, 'bad', 4.5);
  }
  journal.setLimit(rules.limit);
  updateHint();
  hud.update(dt, {
    speedKmh: p.speedKmh, rpm: p.rpm, gear: p.gearbox.label,
    clutch: controls.clutch, brake: controls.brake, throttle: controls.throttle,
  });
  audio.update({
    rpm: p.rpm,
    running: p.engine.running,
    cranking: p.engine.cranking > 0,
    throttle: p.engine.throttleEff,
    load: Math.min(1, Math.abs(p.clutchTorque) / 120),
  });
}

function render() {
  updateSun();
  renderer.shadowMap.needsUpdate = true;
  car.mirrors.render(renderer, scene);
  renderer.render(scene, car.view.camera);
}

let last = performance.now();
let frozen = false; // только для автопроверок: время идёт лишь через sim.advance
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!frozen) tick(dt);
  render();
}
requestAnimationFrame(frame);

// Для отладки из консоли браузера
// sim.advance(сек) — прогнать игру вперёд с шагом 1/60 с (для автопроверок)
window.sim = {
  car, city, input, hud, scene, renderer, setNight, rules, journal, traffic,
  get time() { return time; },
  freeze(on = true) { frozen = on; },
  advance(seconds, step = 1 / 60, draw = true) {
    for (let t = 0; t < seconds; t += step) tick(step);
    if (draw) render();
  },
  autopilot(laneIds, opts) { return createAutopilot(window.sim, laneIds, opts); },
  route: routeHelpers(city.net),
  key(code, down = true) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })); },
  tap(code) { this.key(code, true); this.key(code, false); },
};
