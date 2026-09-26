// Экранный интерфейс: сообщения, подсказки, педали, окно помощи.

const KEYS = [
  ['W / S', 'газ / тормоз (нажим нарастает, пока держишь)'],
  ['A / D', 'руль (на месте руль остаётся повёрнутым)'],
  ['Shift', 'сцепление: держишь — выжато, отпустил — поднимается само'],
  ['E / Q', 'передача вверх / вниз (N ↔ 1…5)'],
  ['R', 'задняя (только стоя на месте)'],
  ['Space', 'ручник вкл / выкл'],
  ['Z / C', 'левый / правый поворотник (ещё раз — выключить)'],
  ['H', 'аварийка'],
  ['L', 'фары: выкл → ближний → дальний'],
  ['K', 'завести двигатель (при выжатом сцеплении)'],
  ['← / →', 'в боковое зеркало; держать дольше — через плечо'],
  ['↑', 'в салонное зеркало'],
  ['ПКМ + мышь', 'свободный взгляд'],
  ['J', 'журнал нарушений: последние 5 / все'],
  ['N', 'день / ночь'],
  ['M', 'звук вкл / выкл'],
  ['V', 'голос экзаменатора вкл / выкл (польский)'],
  ['Backspace', 'на старт (в тренировке — начать задание заново)'],
  ['F1 / Esc', 'пауза и меню'],
];

const PAD = 'Геймпад: левый стик — руль, правый курок — газ, левый — тормоз, правый стик вниз — сцепление, '
  + 'RB / LB — передачи, Y — задняя, X — ручник, B — завести, крестовина — поворотники, фары, аварийка, '
  + 'правый стик вбок — взгляд.';

export class Hud {
  constructor() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div id="topbar"><b>Awto Szkoła</b> · <span id="mode">свободная езда</span> · <kbd>F1</kbd> управление</div>
      <div id="messages"></div>
      <div id="look"></div>
      <div id="hint"></div>
      <div id="panel">
        <div class="pedals">
          <div class="pedal" id="pc"><div class="bar"><div class="bite"></div><div class="fill"></div></div>С</div>
          <div class="pedal" id="pb"><div class="bar"><div class="fill"></div></div>Т</div>
          <div class="pedal" id="pt"><div class="bar"><div class="fill"></div></div>Г</div>
        </div>
        <div id="readout">
          <div><span id="spd">0</span> <span id="spdUnit">км/ч</span></div>
          <div id="gearRpm"></div>
          <div id="fps"></div>
        </div>
      </div>`;
    document.body.appendChild(root);

    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.innerHTML = `
      <div class="card" id="menuCard">
        <h1>Awto Szkoła — тренажёр</h1>
        <p class="sub">Подготовка к экзамену на категорию B (Польша): механика, польские правила, живой город, экзамен WORD.</p>
        <div class="resumeRow" id="resumeRow">
          <button class="start" data-act="resume">Продолжить (Esc)</button>
        </div>
        <div class="modes">
          <button class="mode" data-mode="free"><b>Свободная езда</b><small>город с правилами, журналом нарушений и живым движением</small></button>
          <button class="mode" data-mode="exam"><b>Экзамен WORD</b><small>площадка (łuk, горка, парковка) + маршрут с экзаменатором → ZDAŁ / NIE ZDAŁ</small></button>
          <button class="mode" data-mode="yard"><b>Площадка — тренировка</b><small>все задания площадки по очереди: łuk, горка, три парковки</small></button>
        </div>
        <details id="helpBox">
          <summary>Как тронуться и клавиши</summary>
          <h2>Как тронуться</h2>
          <ol>
            <li>Выжми сцепление (держи <kbd>Shift</kbd>) и заведи двигатель — <kbd>K</kbd>.</li>
            <li>Не отпуская <kbd>Shift</kbd>, включи 1-ю передачу — <kbd>E</kbd>.</li>
            <li>Опусти ручник — <kbd>Space</kbd>. Стоишь у края дороги — включи левый поворотник (<kbd>Z</kbd>) и посмотри в левое зеркало (<kbd>←</kbd>).</li>
            <li>Держи <kbd>W</kbd> (обороты ~1500–2000) и отпусти <kbd>Shift</kbd>. Педаль сцепления поднимается сама;
              чтобы тронуться мягче, придерживай её короткими нажатиями <kbd>Shift</kbd> в жёлтой зоне на шкале «С».</li>
            <li>Переключение: отпусти газ, выжми сцепление, <kbd>E</kbd>, отпусти сцепление. Перед остановкой выжми сцепление, иначе заглохнешь.</li>
          </ol>
          <h2>Клавиши</h2>
          <div class="keys">${KEYS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
          <p class="sub" style="margin-top:12px">${PAD}</p>
        </details>
      </div>
      <div class="card hidden" id="resultCard"></div>`;
    document.body.appendChild(overlay);
    this.onAction = null;
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.onAction) return;
      e.stopPropagation();
      this.onAction(b.dataset.mode ? { mode: b.dataset.mode } : { act: b.dataset.act });
    });

    const exam = document.createElement('div');
    exam.id = 'exam';
    exam.className = 'hidden';
    exam.innerHTML = '<div class="stage"></div><div class="title"></div><div class="sub"></div><div class="pl"></div><div class="ru"></div>';
    root.appendChild(exam);

    this.el = {
      overlay,
      menuCard: overlay.querySelector('#menuCard'),
      resultCard: overlay.querySelector('#resultCard'),
      resumeRow: overlay.querySelector('#resumeRow'),
      exam,
      mode: root.querySelector('#mode'),
      messages: root.querySelector('#messages'),
      hint: root.querySelector('#hint'),
      look: root.querySelector('#look'),
      spd: root.querySelector('#spd'),
      gearRpm: root.querySelector('#gearRpm'),
      fps: root.querySelector('#fps'),
      pc: root.querySelector('#pc .fill'),
      pb: root.querySelector('#pb .fill'),
      pt: root.querySelector('#pt .fill'),
    };
    this.lastMsg = new Map();
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.showFps = new URLSearchParams(location.search).has('debug');
  }

  get overlayVisible() { return !this.el.overlay.classList.contains('hidden'); }

  // Главное меню / пауза. canResume — есть игра, которую можно продолжить
  showMenu(canResume) {
    this.el.overlay.classList.remove('hidden');
    this.el.menuCard.classList.remove('hidden');
    this.el.resultCard.classList.add('hidden');
    this.el.resumeRow.classList.toggle('hidden', !canResume);
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }

  setMode(text) { this.el.mode.textContent = text; }

  // Панель экзаменатора: status = { stage, title, sub }, instruction = { pl, ru }
  setExam(status, instruction) {
    const e = this.el.exam;
    if (!status) { e.classList.add('hidden'); return; }
    e.classList.remove('hidden');
    const q = (c) => e.querySelector(c);
    q('.stage').textContent = status.stage;
    q('.title').textContent = status.title;
    q('.sub').textContent = status.sub;
    q('.pl').textContent = instruction ? `Egzaminator: „${instruction.pl}”` : '';
    q('.ru').textContent = instruction ? instruction.ru : '';
  }

  showResult(res) {
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const verdict = res.mode === 'yard'
      ? `<div class="verdict neutral">Тренировка окончена</div>`
      : `<div class="verdict ${res.passed ? 'pass' : 'fail'}">${res.passed ? 'ZDAŁ' : 'NIE ZDAŁ'}</div>`;
    const tasks = res.results.length
      ? `<h2>Площадка</h2><ul>${res.results.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔' : '✖'} ${esc(r.name)} — ${r.ok ? `с ${r.attempts}-й попытки` : esc(r.reason)}</li>`).join('')}</ul>`
      : '';
    const errs = res.errors.length
      ? `<h2>Ошибки</h2><ul>${res.errors.map((e) => `<li>${esc(e.ru)}<i>${esc(e.pl)}</i></li>`).join('')}</ul>`
      : '<p class="sub">Ошибок нет.</p>';
    this.el.resultCard.innerHTML = `
      ${verdict}
      <p class="reason">${esc(res.reason.ru)}<i>${esc(res.reason.pl)}</i></p>
      ${tasks}${errs}
      <div class="resultBtns">
        <button class="start" data-act="again">Ещё раз</button>
        <button class="start secondary" data-act="menu">В главное меню</button>
      </div>`;
    this.el.overlay.classList.remove('hidden');
    this.el.menuCard.classList.add('hidden');
    this.el.resultCard.classList.remove('hidden');
  }

  // kind: info | warn | bad | good. Одинаковые сообщения не спамим.
  message(text, kind = 'info', seconds = 3.5) {
    const now = performance.now();
    if (now - (this.lastMsg.get(text) || 0) < 1500) return;
    this.lastMsg.set(text, now);
    const div = document.createElement('div');
    div.className = `msg ${kind}`;
    div.textContent = text;
    this.el.messages.appendChild(div);
    while (this.el.messages.children.length > 4) this.el.messages.firstChild.remove();
    setTimeout(() => div.classList.add('fade'), seconds * 1000);
    setTimeout(() => div.remove(), seconds * 1000 + 500);
  }

  setHint(text, warn = false) {
    if (this.el.hint.textContent !== text) this.el.hint.textContent = text;
    this.el.hint.classList.toggle('warn', warn);
  }

  setLook(text) {
    if (this.el.look.textContent !== text) this.el.look.textContent = text;
  }

  update(dt, s) {
    this.el.spd.textContent = Math.round(Math.abs(s.speedKmh));
    this.el.gearRpm.textContent = `передача ${s.gear} · ${Math.round(s.rpm / 10) * 10} об/мин`;
    this.el.pc.style.height = `${s.clutch * 100}%`;
    this.el.pb.style.height = `${s.brake * 100}%`;
    this.el.pt.style.height = `${s.throttle * 100}%`;
    if (this.showFps) {
      this.fpsAcc += dt; this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.el.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} fps`;
        this.fpsAcc = 0; this.fpsFrames = 0;
      }
    }
  }
}
