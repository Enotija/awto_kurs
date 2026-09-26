import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asphaltTexture } from '../world/textures.js';
import { YARD, HILL, PARKING, LINE_W, heightAt, yardLines, yardCones, parkedCars } from './yardLayout.js';

// Площадка WORD: асфальт, разметка, горка, стоящие машины, пачоуки, ограждение.

const COLORS = { white: 0xf4f4f0, yellow: 0xf2c230 };

// Лента вдоль полилинии на высоте рельефа
function ribbon(pts, width) {
  const pos = [], idx = [];
  const hw = width / 2;
  pts.forEach(([x, z], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l * hw, rz = dx / l * hw;
    const y = heightAt(x, z) + 0.015;
    pos.push(x + rx, y, z + rz, x - rx, y, z - rz);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function boardTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1c5bb8'; ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = 'bold 54px sans-serif'; ctx.fillText('PLAC MANEWROWY', 256, 78);
  ctx.font = '34px sans-serif'; ctx.fillText('WORD · kat. B', 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildYard(scene) {
  const g = new THREE.Group();
  g.name = 'yard';
  scene.add(g);

  // Асфальт
  const w = YARD.x1 - YARD.x0, d = YARD.z1 - YARD.z0;
  const asphalt = new THREE.PlaneGeometry(w, d);
  asphalt.rotateX(-Math.PI / 2);
  asphalt.translate((YARD.x0 + YARD.x1) / 2, 0, (YARD.z0 + YARD.z1) / 2);
  const uv = asphalt.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  const tex = asphaltTexture();
  tex.repeat.set(1 / 6, 1 / 6);
  const asphaltMat = new THREE.MeshLambertMaterial({ map: tex });
  const ground = new THREE.Mesh(asphalt, asphaltMat);
  ground.receiveShadow = true;
  g.add(ground);

  // Горка: верх по профилю, боковины до земли, бортики
  const H = HILL;
  const prof = [0, H.up, H.up + H.top, H.length].map((u) => [H.zStart + u, heightAt(H.x, H.zStart + u + (u === H.length ? -1e-6 : 1e-6))]);
  prof[0][1] = 0; prof[3][1] = 0;
  const x0 = H.x - H.rampHalf, x1 = H.x + H.rampHalf;
  const pos = [], idx = [];
  const quad = (a, b, c, dd) => { const n = pos.length / 3; pos.push(...a, ...b, ...c, ...dd); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  for (let i = 0; i < prof.length - 1; i++) {
    const [za, ya] = prof[i], [zb, yb] = prof[i + 1];
    quad([x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]);          // верх
    quad([x0, 0, za], [x0, 0, zb], [x0, yb, zb], [x0, ya, za]);            // левый бок
    quad([x1, ya, za], [x1, yb, zb], [x1, 0, zb], [x1, 0, za]);            // правый бок
  }
  const rampGeo = new THREE.BufferGeometry();
  rampGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rampGeo.setIndex(idx);
  rampGeo.computeVertexNormals();
  const uvs = [];
  for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i], pos[i + 2]);
  rampGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const ramp = new THREE.Mesh(rampGeo, asphaltMat);
  ramp.material.side = THREE.DoubleSide;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  g.add(ramp);
  const curbMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b2 });
  for (const sx of [H.x - H.rampHalf - 0.15, H.x + H.rampHalf + 0.15]) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [za, ya] = prof[i], [zb, yb] = prof[i + 1];
      const len = Math.hypot(zb - za, yb - ya);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, len), curbMat);
      box.position.set(sx, (ya + yb) / 2 + 0.1, (za + zb) / 2);
      box.rotation.x = -Math.atan2(yb - ya, zb - za);
      box.castShadow = true;
      g.add(box);
    }
  }

  // Бордюр и тротуар у параллельной парковки
  {
    const c = PARKING.parallel.curb;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(c.maxX - c.minX, 0.15, 3), curbMat);
    curb.position.set((c.minX + c.maxX) / 2, 0.075, c.minZ + 1.5);
    curb.receiveShadow = true;
    g.add(curb);
  }

  // Разметка
  const byColor = { white: [], yellow: [] };
  for (const l of yardLines()) byColor[l.color].push(ribbon(l.pts, l.width ?? LINE_W));
  for (const [color, geos] of Object.entries(byColor)) {
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({
      color: COLORS[color], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    }));
    m.receiveShadow = true;
    g.add(m);
  }

  // Стоящие машины
  const palette = [0x7f8c8d, 0x2e86de, 0xc0392b, 0xecf0f1, 0x2d3436, 0x27ae60, 0xe1b12c, 0x8e44ad];
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0x26313b });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  parkedCars().forEach((c, i) => {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 4.2), new THREE.MeshLambertMaterial({ color: palette[i % palette.length] }));
    body.position.y = 0.56;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.52, 2.1), cabinMat);
    cabin.position.set(0, 1.13, -0.25);
    car.add(body, cabin);
    for (const [wx, wz] of [[0.78, 1.3], [-0.78, 1.3], [0.78, -1.3], [-0.78, -1.3]]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 12), tyreMat);
      wh.rotation.z = Math.PI / 2;
      wh.position.set(wx, 0.31, wz);
      car.add(wh);
    }
    car.position.set(c.cx, 0, c.cz);
    car.rotation.y = Math.atan2(c.dir[0], c.dir[1]);
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(car);
  });

  // Пачоуки
  const coneGeo = new THREE.ConeGeometry(0.18, 0.55, 14);
  coneGeo.translate(0, 0.275, 0);
  const bandGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.08, 14);
  bandGeo.translate(0, 0.3, 0);
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xff6a00 });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const [x, z] of yardCones()) {
    const cone = new THREE.Mesh(coneGeo, coneMat);
    const band = new THREE.Mesh(bandGeo, bandMat);
    cone.position.set(x, 0, z); band.position.set(x, 0, z);
    cone.castShadow = true;
    g.add(cone, band);
  }

  // Ограждение: столбики и две перекладины
  const posts = [], rails = [];
  const edges = [
    [[YARD.x0, YARD.z0], [YARD.x1, YARD.z0]], [[YARD.x1, YARD.z0], [YARD.x1, YARD.z1]],
    [[YARD.x1, YARD.z1], [YARD.x0, YARD.z1]], [[YARD.x0, YARD.z1], [YARD.x0, YARD.z0]],
  ];
  for (const [a, b] of edges) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= len; s += 4) {
      const p = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6);
      p.translate(a[0] + (b[0] - a[0]) * s / len, 0.6, a[1] + (b[1] - a[1]) * s / len);
      posts.push(p);
    }
    for (const y of [0.55, 1.1]) {
      const r = new THREE.BoxGeometry(0.04, 0.05, len);
      r.rotateY(ang);
      r.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
      rails.push(r);
    }
  }
  const fence = new THREE.Mesh(mergeGeometries([...posts, ...rails]), new THREE.MeshLambertMaterial({ color: 0x5c6a72 }));
  fence.castShadow = true;
  g.add(fence);

  // Табличка у въезда
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.25), new THREE.MeshLambertMaterial({ map: boardTexture() }));
  board.position.set(236, 3.1, -73.5);
  const legs = new THREE.Mesh(mergeGeometries([
    new THREE.CylinderGeometry(0.06, 0.06, 3.7, 6).translate(234.4, 1.85, -73.6),
    new THREE.CylinderGeometry(0.06, 0.06, 3.7, 6).translate(237.6, 1.85, -73.6),
  ]), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
  g.add(board, legs);
  return g;
}
