import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Польские дорожные знаки, нарисованные на canvas.
// Размеры — ширина×высота лицевой стороны в метрах.
export const SIGN_SIZE = {
  'B-20': [0.8, 0.8], 'A-7': [0.9, 0.8], 'A-5': [0.9, 0.8], 'D-1': [0.75, 0.75],
  'C-12': [0.7, 0.7], 'B-33': [0.7, 0.7], 'D-6': [0.7, 0.7], 'D-42': [1.2, 0.8],
  'C-13': [0.7, 0.7], 'ARROW': [0.3, 0.3],
};

const RED = '#d4161c', BLUE = '#1c5bb8', YELLOW = '#f6c200', WHITE = '#ffffff', BLACK = '#161616';

function shapePath(ctx, code, S) {
  const c = S / 2;
  ctx.beginPath();
  switch (code) {
    case 'B-20': {
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + i * Math.PI / 4;
        ctx.lineTo(c + Math.cos(a) * c * 0.98, c + Math.sin(a) * c * 0.98);
      }
      break;
    }
    case 'A-7':
      ctx.moveTo(S * 0.02, S * 0.06); ctx.lineTo(S * 0.98, S * 0.06); ctx.lineTo(c, S * 0.94); break;
    case 'A-5':
      ctx.moveTo(c, S * 0.06); ctx.lineTo(S * 0.98, S * 0.94); ctx.lineTo(S * 0.02, S * 0.94); break;
    case 'D-1':
      ctx.moveTo(c, S * 0.01); ctx.lineTo(S * 0.99, c); ctx.lineTo(c, S * 0.99); ctx.lineTo(S * 0.01, c); break;
    case 'C-12': case 'B-33': case 'C-13':
      ctx.arc(c, c, c * 0.98, 0, Math.PI * 2); break;
    default:
      ctx.rect(S * 0.02, S * 0.02, S * 0.96, S * 0.96);
  }
  ctx.closePath();
}

function drawFace(ctx, code, value, S) {
  const c = S / 2;
  const fillShape = (color, scale = 1) => {
    ctx.save();
    ctx.translate(c, c); ctx.scale(scale, scale); ctx.translate(-c, -c);
    shapePath(ctx, code, S);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (code) {
    case 'B-20':
      fillShape(WHITE); fillShape(RED, 0.9);
      ctx.fillStyle = WHITE; ctx.font = `bold ${S * 0.27}px sans-serif`;
      ctx.fillText('STOP', c, c + S * 0.01);
      break;
    case 'A-7':
      fillShape(RED); fillShape(YELLOW, 0.72);
      break;
    case 'A-5':
      fillShape(RED); fillShape(YELLOW, 0.72);
      ctx.fillStyle = BLACK;
      ctx.fillRect(c - S * 0.035, S * 0.42, S * 0.07, S * 0.36);
      ctx.fillRect(c - S * 0.16, S * 0.57, S * 0.32, S * 0.07);
      break;
    case 'D-1':
      fillShape('#8c8c8c'); fillShape(WHITE, 0.94); fillShape(YELLOW, 0.66);
      break;
    case 'B-33':
      fillShape(RED); fillShape(WHITE, 0.78);
      ctx.fillStyle = BLACK; ctx.font = `bold ${S * (value >= 100 ? 0.34 : 0.42)}px sans-serif`;
      ctx.fillText(String(value), c, c + S * 0.02);
      break;
    case 'C-12': {
      fillShape(BLUE);
      ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE; ctx.lineWidth = S * 0.07;
      for (let k = 0; k < 3; k++) {
        const a0 = k * (Math.PI * 2 / 3) + 0.35, a1 = a0 + 1.35;
        ctx.beginPath(); ctx.arc(c, c, S * 0.26, a0, a1); ctx.stroke();
        const ax = c + Math.cos(a1) * S * 0.26, az = c + Math.sin(a1) * S * 0.26;
        const tx = -Math.sin(a1), tz = Math.cos(a1);
        ctx.beginPath();
        ctx.moveTo(ax + tx * S * 0.09, az + tz * S * 0.09);
        ctx.lineTo(ax - tz * S * 0.08 - tx * S * 0.02, az + tx * S * 0.08 - tz * S * 0.02);
        ctx.lineTo(ax + tz * S * 0.08 - tx * S * 0.02, az - tx * S * 0.08 - tz * S * 0.02);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'C-13': {
      fillShape(BLUE);
      ctx.strokeStyle = WHITE; ctx.lineWidth = S * 0.045;
      for (const x of [c - S * 0.17, c + S * 0.17]) { ctx.beginPath(); ctx.arc(x, c + S * 0.1, S * 0.12, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath();
      ctx.moveTo(c - S * 0.17, c + S * 0.1); ctx.lineTo(c - S * 0.03, c - S * 0.1); ctx.lineTo(c + S * 0.12, c - S * 0.1);
      ctx.lineTo(c + S * 0.17, c + S * 0.1); ctx.moveTo(c - S * 0.03, c - S * 0.1); ctx.lineTo(c, c + S * 0.1);
      ctx.lineTo(c + S * 0.12, c - S * 0.1); ctx.stroke();
      break;
    }
    case 'D-6': {
      fillShape(BLUE);
      ctx.fillStyle = WHITE;
      ctx.beginPath(); ctx.moveTo(c, S * 0.14); ctx.lineTo(S * 0.88, S * 0.84); ctx.lineTo(S * 0.12, S * 0.84); ctx.closePath(); ctx.fill();
      ctx.fillStyle = BLACK;
      for (let k = 0; k < 4; k++) ctx.fillRect(S * (0.24 + k * 0.14), S * 0.78, S * 0.08, S * 0.05);
      ctx.beginPath(); ctx.arc(c + S * 0.02, S * 0.4, S * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = S * 0.04; ctx.strokeStyle = BLACK; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c + S * 0.01, S * 0.46); ctx.lineTo(c - S * 0.02, S * 0.6);
      ctx.lineTo(c - S * 0.09, S * 0.74); ctx.moveTo(c - S * 0.02, S * 0.6); ctx.lineTo(c + S * 0.07, S * 0.73);
      ctx.moveTo(c + S * 0.0, S * 0.5); ctx.lineTo(c - S * 0.08, S * 0.58); ctx.moveTo(c + S * 0.0, S * 0.5); ctx.lineTo(c + S * 0.08, S * 0.56);
      ctx.stroke();
      break;
    }
    case 'D-42': {
      fillShape(WHITE);
      ctx.strokeStyle = BLACK; ctx.lineWidth = S * 0.02;
      ctx.strokeRect(S * 0.04, S * 0.04, S * 0.92, S * 0.92);
      ctx.fillStyle = BLACK;
      const hs = [0.3, 0.45, 0.25, 0.55, 0.35, 0.42];
      hs.forEach((h, k) => ctx.fillRect(S * (0.12 + k * 0.13), S * (0.8 - h), S * 0.11, S * h));
      ctx.fillStyle = WHITE;
      for (let k = 0; k < 6; k++) for (let r = 0; r < 3; r++) ctx.fillRect(S * (0.145 + k * 0.13), S * (0.72 - r * 0.08), S * 0.02, S * 0.03);
      break;
    }
    case 'ARROW': {
      fillShape(BLACK);
      ctx.fillStyle = '#2ee85a';
      ctx.beginPath();
      ctx.moveTo(S * 0.18, S * 0.42); ctx.lineTo(S * 0.56, S * 0.42); ctx.lineTo(S * 0.56, S * 0.26);
      ctx.lineTo(S * 0.86, S * 0.5); ctx.lineTo(S * 0.56, S * 0.74); ctx.lineTo(S * 0.56, S * 0.58);
      ctx.lineTo(S * 0.18, S * 0.58); ctx.closePath(); ctx.fill();
      break;
    }
    default:
      fillShape(WHITE);
  }
}

const texCache = new Map();
export function signTexture(code, value, back = false) {
  const k = `${code}:${value ?? ''}:${back}`;
  if (texCache.has(k)) return texCache.get(k);
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (back) {
    shapePath(ctx, code, S);
    ctx.fillStyle = '#9a9ea3';
    ctx.fill();
  } else {
    drawFace(ctx, code, value, S);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(k, tex);
  return tex;
}

// Все знаки одной сеткой на каждый вид — мало вызовов отрисовки
export function buildSignMeshes(signs, baseY) {
  const group = new THREE.Group();
  group.name = 'signs';
  const faces = new Map();
  const backs = new Map();
  const poles = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);

  // Знаки на одном столбе (например, A-7 и C-12) — один над другим
  const poleTop = new Map();
  for (const s of signs) {
    const [w, h] = SIGN_SIZE[s.code];
    const k = `${s.x.toFixed(1)},${s.z.toFixed(1)}`;
    const bottom = poleTop.get(k) ?? baseY + 2.0;
    const cy = bottom + h / 2;
    poleTop.set(k, bottom + h + 0.08);
    q.setFromAxisAngle(UP, s.facing);
    p.set(s.x, cy, s.z);
    m.compose(p, q, one);
    const key = `${s.code}:${s.value ?? ''}`;
    if (!faces.has(key)) { faces.set(key, { code: s.code, value: s.value, geos: [] }); backs.set(s.code, []); }
    faces.get(key).geos.push(new THREE.PlaneGeometry(w, h).applyMatrix4(m));
    const back = new THREE.PlaneGeometry(w, h);
    back.rotateY(Math.PI);
    back.translate(0, 0, -0.012);
    backs.get(s.code).push(back.applyMatrix4(m));
    const top = bottom + h;
    const pole = new THREE.CylinderGeometry(0.035, 0.035, top - baseY, 6);
    pole.translate(s.x - Math.sin(s.facing) * 0.04, baseY + (top - baseY) / 2, s.z - Math.cos(s.facing) * 0.04);
    poles.push(pole);
  }
  for (const f of faces.values()) {
    const mat = new THREE.MeshLambertMaterial({ map: signTexture(f.code, f.value), alphaTest: 0.5, transparent: false });
    const mesh = new THREE.Mesh(mergeGeometries(f.geos), mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const [code, geos] of backs) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ map: signTexture(code, null, true), alphaTest: 0.5 }));
    group.add(mesh);
  }
  if (poles.length) {
    const mesh = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
