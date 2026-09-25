import * as THREE from 'three';
import { LAYER, setLayer } from './layers.js';

// Внешний вид машины из простых коробок. Координаты машины:
// +Z — вперёд, +X — влево, Y — вверх, начало — центр кузова на земле.
export function buildCarBody({ paint = 0xeeeeea } = {}) {
  const g = new THREE.Group();
  g.name = 'carBody';
  const paintMat = new THREE.MeshLambertMaterial({ color: paint });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222428 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x2c3a48 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const rim = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
  const red = new THREE.MeshLambertMaterial({ color: 0x8a1010, emissive: 0x200000 });

  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  box(1.70, 0.62, 3.80, paintMat, 0, 0.58, 0.02);      // нижняя часть кузова
  box(1.72, 0.18, 0.20, dark, 0, 0.36, 2.0);             // передний бампер
  box(1.72, 0.18, 0.20, dark, 0, 0.36, -1.95);           // задний бампер
  box(1.66, 0.04, 0.9, paintMat, 0, 0.9, 1.45);          // капот
  // «Теплица» — стёкла и крыша
  box(1.44, 0.46, 2.05, glass, 0, 1.13, -0.55);
  box(1.40, 0.05, 1.75, paintMat, 0, 1.43, -0.65);       // крыша
  for (const s of [1, -1]) {
    box(0.06, 0.46, 0.12, paintMat, s * 0.71, 1.13, -0.55); // средняя стойка
    box(0.06, 0.46, 0.35, paintMat, s * 0.71, 1.13, -1.45); // задняя стойка
    box(0.03, 0.05, 3.3, dark, s * 0.855, 0.5, 0);          // молдинг
    box(0.05, 0.12, 0.08, red, s * 0.65, 0.82, -1.93);      // задний фонарь
  }

  // Колёса
  const wheelGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.2, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.21, 12);
  rimGeo.rotateZ(Math.PI / 2);
  for (const z of [1.25, -1.30]) {
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(s * 0.76, 0.30, z);
      const r = new THREE.Mesh(rimGeo, rim);
      r.position.copy(w.position);
      g.add(w, r);
    }
  }

  setLayer(g, LAYER.BODY);
  return g;
}
