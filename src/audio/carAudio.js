// Звук синтезируется в браузере (Web Audio), без файлов:
// двигатель, стартер, щелчки поворотника, скрежет коробки, удар.

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Браузер разрешает звук только после действия пользователя
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // Двигатель: три осциллятора на частоте вспышек (4 цилиндра — 2 за оборот)
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 2;
    this.filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.oscs = [
      { type: 'sawtooth', mul: 1, gain: 0.5 },
      { type: 'square', mul: 0.5, gain: 0.35 },
      { type: 'sawtooth', mul: 2, gain: 0.18 },
      { type: 'triangle', mul: 3.02, gain: 0.12 },
    ].map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(this.filter);
      osc.start();
      return { osc, mul: o.mul };
    });

    // Шум (для стартера, скрежета, удара и «рычания» под нагрузкой)
    const len = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.roughFilter = ctx.createBiquadFilter();
    this.roughFilter.type = 'bandpass';
    this.roughFilter.Q.value = 1.2;
    this.roughGain = ctx.createGain();
    this.roughGain.gain.value = 0;
    noise.connect(this.roughFilter).connect(this.roughGain).connect(this.master);
    noise.start();

    // Стартер — жужжание
    this.starter = ctx.createOscillator();
    this.starter.type = 'sawtooth';
    this.starter.frequency.value = 140;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 900;
    this.starter.connect(sf).connect(this.starterGain).connect(this.master);
    this.starter.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }

  // s = { rpm, running, cranking, throttle (0..1 факт.), load (0..1) }
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = Math.max(4, s.rpm / 60 * 2);
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(f * o.mul, t, 0.02);
    const spinning = s.rpm > 60;
    let level = 0;
    if (s.running) level = 0.16 + 0.16 * s.throttle + Math.min(s.rpm, 6500) / 6500 * 0.1;
    else if (spinning) level = 0.08 * Math.min(1, s.rpm / 300);
    this.engineGain.gain.setTargetAtTime(level, t, 0.04);
    this.filter.frequency.setTargetAtTime(180 + f * 5 + s.throttle * 1400, t, 0.04);
    this.roughFilter.frequency.setTargetAtTime(300 + f * 6, t, 0.05);
    this.roughGain.gain.setTargetAtTime(s.running ? 0.015 + 0.05 * s.throttle * s.load : 0, t, 0.05);
    // Стартер «пульсирует» с тактами сжатия
    const crank = s.cranking ? 0.07 * (0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 9)) : 0;
    this.starterGain.gain.setTargetAtTime(crank, t, 0.02);
  }

  burst({ duration, type, freq, q = 1, gain = 0.3, attack = 0.002 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
  }

  tick(on) { this.burst({ duration: 0.03, type: 'bandpass', freq: on ? 2600 : 1900, q: 4, gain: 0.5 }); }
  grind() { this.burst({ duration: 0.45, type: 'bandpass', freq: 1400, q: 6, gain: 0.35, attack: 0.02 }); }
  thud(strength) { this.burst({ duration: 0.35, type: 'lowpass', freq: 160, gain: Math.min(1, 0.3 + strength * 0.1) }); }
  clunk() { this.burst({ duration: 0.12, type: 'lowpass', freq: 400, gain: 0.3 }); }
}
