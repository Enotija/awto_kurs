import * as THREE from 'three';

// Приборная панель на canvas: тахометр, спидометр, передача, контрольные лампы.
export class Cluster {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.timer = 0;
    this.odometer = 12873.4;
  }

  // s = { rpm, speedKmh, gear, left, right, lowBeam, highBeam, handbrake, engineOn, cranking }
  update(dt, s) {
    this.odometer += Math.abs(s.speedKmh) / 3600 * dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 30;
    this.draw(s);
    this.texture.needsUpdate = true;
  }

  dial(cx, cy, r, max, value, major, minor, labelDiv, redFrom, unit) {
    const ctx = this.ctx;
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    const ang = (v) => a0 + sweep * Math.min(Math.max(v / max, 0), 1.02);

    ctx.fillStyle = '#101216';
    ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3c4048'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.stroke();

    if (redFrom !== undefined) {
      ctx.strokeStyle = '#d02020'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.arc(cx, cy, r - 8, ang(redFrom), ang(max)); ctx.stroke();
    }
    for (let v = 0; v <= max + 1e-6; v += minor) {
      const a = ang(v);
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const r0 = isMajor ? r - 26 : r - 15;
      ctx.strokeStyle = redFrom !== undefined && v >= redFrom ? '#ff5050' : '#e8e8e8';
      ctx.lineWidth = isMajor ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = '#f0f0f0';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(v / labelDiv)), cx + Math.cos(a) * (r - 48), cy + Math.sin(a) * (r - 48));
      }
    }
    ctx.fillStyle = '#9aa0a8';
    ctx.font = '20px sans-serif';
    ctx.fillText(unit, cx, cy + r * 0.45);

    // Стрелка
    const a = ang(value);
    ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 18, cy - Math.sin(a) * 18);
    ctx.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#2a2d33';
    ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill();
  }

  arrow(x, y, dir, on) {
    const ctx = this.ctx;
    ctx.fillStyle = on ? '#2cff5a' : '#1b2a1e';
    ctx.beginPath();
    ctx.moveTo(x + dir * 30, y);
    ctx.lineTo(x, y - 22);
    ctx.lineTo(x, y - 10);
    ctx.lineTo(x - dir * 24, y - 10);
    ctx.lineTo(x - dir * 24, y + 10);
    ctx.lineTo(x, y + 10);
    ctx.lineTo(x, y + 22);
    ctx.closePath();
    ctx.fill();
  }

  beam(x, y, color, on, high) {
    const ctx = this.ctx;
    ctx.strokeStyle = on ? color : '#1e2228';
    ctx.fillStyle = on ? color : '#1e2228';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(x + 8, y, 12, 15, 0, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.closePath();
    ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      const dy = high ? 0 : 6;
      ctx.moveTo(x - 8, y + i * 9);
      ctx.lineTo(x - 26, y + i * 9 + dy);
      ctx.stroke();
    }
  }

  lampText(x, y, text, color, on) {
    const ctx = this.ctx;
    ctx.strokeStyle = on ? color : '#23262c';
    ctx.fillStyle = on ? color : '#23262c';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }

  battery(x, y, on) {
    const ctx = this.ctx;
    ctx.strokeStyle = on ? '#ff3030' : '#23262c';
    ctx.lineWidth = 4;
    ctx.strokeRect(x - 20, y - 12, 40, 26);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(x - 14, y - 18, 8, 6);
    ctx.fillRect(x + 6, y - 18, 8, 6);
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('− +', x, y + 1);
  }

  oil(x, y, on) {
    const ctx = this.ctx;
    ctx.fillStyle = on ? '#ff3030' : '#23262c';
    ctx.beginPath();
    ctx.moveTo(x - 24, y - 4); ctx.lineTo(x + 10, y - 4); ctx.lineTo(x + 24, y - 12);
    ctx.lineTo(x + 14, y + 12); ctx.lineTo(x - 24, y + 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 26, y + 8, 4, 0, Math.PI * 2); ctx.fill();
  }

  draw(s) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, W, H);

    this.dial(200, 200, 165, 8000, s.rpm, 1000, 500, 1000, 6000, '×1000 об/мин');
    this.dial(824, 200, 165, 200, Math.abs(s.speedKmh), 20, 10, 1, undefined, 'км/ч');

    // Центр: передача и лампы
    const cx = W / 2;
    ctx.fillStyle = '#101216';
    ctx.fillRect(cx - 115, 30, 230, 324);
    this.arrow(cx - 70, 70, -1, s.left);
    this.arrow(cx + 70, 70, 1, s.right);
    this.beam(cx - 45, 130, '#2cff5a', s.lowBeam && !s.highBeam, false);
    this.beam(cx + 55, 130, '#3a7bff', s.highBeam, true);

    ctx.fillStyle = '#e8eef5';
    ctx.font = 'bold 110px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.gear, cx, 228);

    const warn = !s.engineOn;
    this.lampText(cx - 70, 318, 'P', '#ff3030', s.handbrake);
    this.battery(cx, 318, warn);
    this.oil(cx + 66, 314, warn);

    ctx.fillStyle = '#7d848e';
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.odometer.toFixed(1)} km`, 824, 330);
    ctx.fillText(s.cranking ? 'START' : '', 200, 330);
  }
}
