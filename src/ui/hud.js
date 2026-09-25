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
  ['N', 'день / ночь'],
  ['M', 'звук вкл / выкл'],
  ['Backspace', 'вернуть машину на старт'],
  ['F1 / Esc', 'пауза и эта подсказка'],
];

const PAD = 'Геймпад: левый стик — руль, правый курок — газ, левый — тормоз, правый стик вниз — сцепление, '
  + 'RB / LB — передачи, Y — задняя, X — ручник, B — завести, крестовина — поворотники, фары, аварийка, '
  + 'правый стик вбок — взгляд.';

export class Hud {
  constructor() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div id="topbar"><b>Awto Szkoła</b> · этап 1 — машина и кабина · <kbd>F1</kbd> управление</div>
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
      <div class="card">
        <h1>Awto Szkoła — тренажёр</h1>
        <p class="sub">Подготовка к экзамену на категорию B (Польша). Этап 1: машина с механикой и кабина.</p>
        <h2>Как тронуться</h2>
        <ol>
          <li>Выжми сцепление (держи <kbd>Shift</kbd>) и заведи двигатель — <kbd>K</kbd>.</li>
          <li>Не отпуская <kbd>Shift</kbd>, включи 1-ю передачу — <kbd>E</kbd>.</li>
          <li>Опусти ручник — <kbd>Space</kbd>. Посмотри в зеркало (<kbd>←</kbd>), включи поворотник, если отъезжаешь от края.</li>
          <li>Держи <kbd>W</kbd> (обороты ~1500–2000) и отпусти <kbd>Shift</kbd>. Педаль сцепления поднимается сама;
            чтобы тронуться мягче, придерживай её короткими нажатиями <kbd>Shift</kbd> в жёлтой зоне на шкале «С».</li>
          <li>Переключение: отпусти газ, выжми сцепление, <kbd>E</kbd>, отпусти сцепление. Перед остановкой выжми сцепление, иначе заглохнешь.</li>
        </ol>
        <h2>Клавиши</h2>
        <div class="keys">${KEYS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
        <p class="sub" style="margin-top:12px">${PAD}</p>
        <div class="start" id="startBtn">Кликни или нажми Enter, чтобы начать</div>
      </div>`;
    document.body.appendChild(overlay);

    this.el = {
      overlay,
      startBtn: overlay.querySelector('#startBtn'),
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

  setOverlay(visible, started) {
    this.el.overlay.classList.toggle('hidden', !visible);
    this.el.startBtn.textContent = started
      ? 'Продолжить (Esc / Enter / клик)'
      : 'Кликни или нажми Enter, чтобы начать';
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
