// Экзамен WORD (без графики): площадка → город с экзаменатором → итог.
// Контроллер не трогает игру напрямую, а выдаёт команды (переставить машину,
// сказать фразу, показать итог) — их выполняет main.js.
//
// Оценка как на экзамене:
//  • на площадке у каждого задания 2 попытки; две неудачные — «не сдал»;
//  • в городе критическое нарушение (красный, пешеход, помеха, STOP, столкновение…) — сразу «не сдал»;
//  • одна и та же некритическая ошибка второй раз — «не сдал».

import { LukTask, HillTask, ParkTask } from './yardTasks.js';
import { planRoute, RouteTracker, instructionFor } from './route.js';

export const PARK_KINDS = ['perpendicular', 'parallel', 'angled'];
const MAX_ATTEMPTS = 2;

export class ExamController {
  // mode: 'exam' — полный экзамен, 'yard' — тренировка всех заданий площадки
  constructor({ net, mode = 'exam', rand = Math.random, cityStart, cityStartLane, steps = 8 }) {
    this.net = net;
    this.mode = mode;
    this.rand = rand;
    this.cityStart = cityStart;
    this.cityStartLane = cityStartLane;
    this.steps = steps;
    this.tasks = mode === 'yard'
      ? [new LukTask(), new HillTask(), ...PARK_KINDS.map((k) => new ParkTask(k))]
      : [new LukTask(), new HillTask(), new ParkTask(PARK_KINDS[Math.floor(rand() * PARK_KINDS.length)])];
    this.phase = 'intro';
    this.taskIdx = 0;
    this.attempt = 1;
    this.errors = [];
    this.results = [];
    this.minor = {};
    this.commands = [];
    this.instruction = null;
    this.finishT = 0;
    this.lightsReported = false;
    this.passed = null;
    this.reason = null;
  }

  get task() { return this.tasks[this.taskIdx]; }

  takeCommands() {
    const c = this.commands;
    this.commands = [];
    return c;
  }

  say(pl, ru) {
    this.instruction = { pl, ru };
    this.commands.push({ type: 'say', pl, ru });
  }

  begin() {
    this.phase = 'yard';
    this.startTask(true);
  }

  startTask(first = false) {
    const t = this.task;
    t.reset();
    this.commands.push({ type: 'teleport', pose: t.start, engine: first ? 'off' : 'keep', parked: false });
    const ins = t.instruction;
    this.say(ins.pl, `${this.taskLabel()}: ${ins.ru}`);
  }

  taskLabel() {
    return `Задание ${this.taskIdx + 1}/${this.tasks.length}, попытка ${this.attempt}/${MAX_ATTEMPTS}`;
  }

  // Общее состояние для панели экзаменатора
  get status() {
    if (this.phase === 'yard') return { stage: 'Plac manewrowy', title: this.task.name, sub: this.taskLabel() };
    if (this.phase === 'city') {
      return { stage: 'Jazda w ruchu drogowym', title: 'Маршрут по городу', sub: `Манёвр ${Math.min(this.tracker.passed + 1, this.tracker.total)}/${this.tracker.total} · ошибок: ${this.errors.length}` };
    }
    return { stage: 'WORD', title: this.passed ? 'ZDAŁ' : 'NIE ZDAŁ', sub: '' };
  }

  // s — состояние машины (см. yardTasks) + lowBeam, laneId
  update(dt, s) {
    if (this.phase === 'yard') this.updateYard(dt, s);
    else if (this.phase === 'city') this.updateCity(dt, s);
  }

  updateYard(dt, s) {
    const t = this.task;
    const r = t.update(dt, s);
    if (r.hint === 'phase') {
      const ins = t.instruction;
      this.say(ins.pl, `${this.taskLabel()}: ${ins.ru}`);
    }
    if (r.status === 'pass') {
      this.results.push({ name: t.name, ru: t.ru, ok: true, attempts: this.attempt });
      this.commands.push({ type: 'message', text: `Задание выполнено: ${t.name}`, kind: 'good' });
      this.nextTask();
    } else if (r.status === 'fail') {
      this.errors.push({ pl: r.reason, ru: r.ru, where: t.name });
      this.commands.push({ type: 'message', text: `Ошибка: ${r.ru} (${r.reason})`, kind: 'bad' });
      if (this.attempt < MAX_ATTEMPTS) {
        this.attempt++;
        this.commands.push({ type: 'message', text: 'Proszę powtórzyć zadanie — повтори задание', kind: 'warn' });
        this.startTask();
      } else {
        this.results.push({ name: t.name, ru: t.ru, ok: false, attempts: this.attempt, reason: r.ru });
        if (this.mode === 'exam') this.fail(`Dwukrotnie niepoprawnie wykonane zadanie: ${t.name}`, `Задание не выполнено с двух попыток: ${t.ru}`);
        else this.nextTask();
      }
    }
  }

  nextTask() {
    this.taskIdx++;
    this.attempt = 1;
    if (this.taskIdx < this.tasks.length) { this.startTask(); return; }
    if (this.mode === 'yard') { this.finish(); return; }
    this.startCity();
  }

  startCity() {
    this.phase = 'city';
    const route = planRoute(this.net, this.cityStartLane, this.rand, { steps: this.steps });
    this.tracker = new RouteTracker(route);
    this.commands.push({ type: 'teleport', pose: this.cityStart, engine: 'keep', parked: true });
    const first = instructionFor(this.tracker.next);
    this.say(`Proszę ruszyć z miejsca. ${first.pl}`,
      `Город: тронься от края (поворотник, зеркало). ${first.ru} Не забудь ближний свет (L).`);
  }

  updateCity(dt, s) {
    // В Польше ближний свет обязателен и днём: нарушение уходит в общий журнал,
    // а оттуда возвращается сюда через onRulesEvent
    if (Math.abs(s.v) > 1 && !s.lowBeam && !this.lightsReported) {
      this.lightsReported = true;
      this.commands.push({ type: 'report', code: 'NO_LIGHTS' });
    }
    if (this.tracker.done) {
      const stopped = Math.abs(s.v) < 0.1 && s.handbrake;
      this.finishT = stopped && s.laneId != null ? this.finishT + dt : 0;
      if (this.finishT > 1.5) this.finish();
      // Встал на самом перекрёстке — там останавливаться нельзя, подсказываем
      if (stopped && s.laneId == null && !this.nodeStopHinted) {
        this.nodeStopHinted = true;
        this.commands.push({ type: 'message', text: 'На перекрёстке останавливаться нельзя — проедь на прямой участок и встань у края', kind: 'warn' });
      }
    }
  }

  // События движка правил (нарушения и выезды с перекрёстков) — только в городе
  onRulesEvent(ev) {
    if (this.phase !== 'city') return;
    if (ev.type === 'violation') { this.onViolation(ev.violation); return; }
    if (ev.type !== 'nodeExit') return;
    const res = this.tracker.onExit(ev);
    if (res === 'wrong') {
      const conn = this.net.laneById[ev.node.connectors[`${ev.armIn}>${ev.armOut}`]];
      const remaining = Math.max(2, this.tracker.total - this.tracker.passed);
      this.tracker = new RouteTracker(planRoute(this.net, conn.next[0], this.rand, { steps: remaining }));
      this.commands.push({ type: 'message', text: 'Не туда — экзаменатор меняет маршрут (это не ошибка)', kind: 'warn' });
    }
    if (res === 'ignore') return;
    const next = this.tracker.next;
    if (next) {
      const ins = instructionFor(next);
      this.say(ins.pl, ins.ru);
    } else if (this.tracker.done) {
      this.say('Proszę zatrzymać się w bezpiecznym miejscu przy prawej krawędzi jezdni i zaciągnąć hamulec ręczny.',
        'Остановись у правого края дороги и затяни ручник — это конец маршрута.');
    }
  }

  onViolation(v) {
    this.errors.push({ pl: v.pl, ru: `${v.ru}${v.detail ? ` — ${v.detail}` : ''}`, where: 'miasto', severity: v.severity, code: v.code });
    if (v.severity === 'critical') {
      this.fail(`Przerwanie egzaminu: ${v.pl}`, `Экзамен прерван: ${v.ru}`);
      return;
    }
    this.minor[v.code] = (this.minor[v.code] || 0) + 1;
    if (this.minor[v.code] >= 2) this.fail(`Dwukrotny błąd: ${v.pl}`, `Одна и та же ошибка дважды: ${v.ru}`);
    else this.commands.push({ type: 'message', text: `Ошибка (первая такого вида): ${v.ru}. Повтор — провал.`, kind: 'warn' });
  }

  fail(pl, ru) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.passed = false;
    this.reason = { pl, ru };
    this.commands.push(this.resultCommand());
  }

  finish() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.passed = this.mode === 'yard' ? this.results.every((r) => r.ok) : true;
    this.reason = this.passed
      ? { pl: 'Egzamin zakończony wynikiem pozytywnym.', ru: 'Экзамен сдан.' }
      : { pl: 'Nie wszystkie zadania wykonane poprawnie.', ru: 'Не все задания выполнены.' };
    if (this.mode === 'yard') this.reason = { pl: 'Trening placu zakończony.', ru: 'Тренировка площадки окончена.' };
    this.commands.push(this.resultCommand());
  }

  resultCommand() {
    return {
      type: 'result', mode: this.mode, passed: this.passed, reason: this.reason,
      errors: this.errors.slice(), results: this.results.slice(),
    };
  }
}
