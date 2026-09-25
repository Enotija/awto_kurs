import * as THREE from 'three';

// Процедурные текстуры: никаких файлов, всё рисуется на canvas.

function canvasTexture(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Детерминированный генератор случайных чисел, чтобы город был всегда одинаковым
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx, size, base, spread, count, rand) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const v = Math.floor((rand() - 0.5) * spread);
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
}

export function asphaltTexture() {
  const r = rng(11);
  return canvasTexture(256, (ctx, s) => speckle(ctx, s, '#4d5055', 90, 9000, r));
}

export function grassTexture() {
  const r = rng(22);
  return canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#5f8a3f', 70, 7000, r);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(40,80,20,0.35)' : 'rgba(150,180,90,0.25)';
      ctx.fillRect(r() * s, r() * s, 1, 3 + r() * 3);
    }
  });
}

// Тротуарная плитка: одна текстура = 1×1 м, плитки 50 см
export function pavingTexture() {
  const r = rng(33);
  return canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#a9a7a2', 50, 1200, r);
    ctx.strokeStyle = 'rgba(70,70,70,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * s / 2); ctx.lineTo(s, i * s / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * s / 2, 0); ctx.lineTo(i * s / 2, s); ctx.stroke();
    }
  });
}

// Окно фасада: одна текстура = одна ячейка 3.2×3 м. Стена белая —
// цвет задаётся цветом вершин здания.
export function facadeTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, s * 0.9, s, s * 0.1);
    const x0 = s * 0.22, y0 = s * 0.2, w = s * 0.56, h = s * 0.55;
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#48586a');
    g.addColorStop(1, '#2a323c');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(x0 + w / 2 - 2, y0, 4, h);
  }, { repeat: 1 });
}
