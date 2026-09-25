import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asphaltTexture, grassTexture, pavingTexture, facadeTexture, rng } from './textures.js';

// Квартал: сетка улиц. Улицы идут по линиям xs (вдоль оси Z) и zs (вдоль оси X).
// Между улицами — кварталы с тротуаром и бордюром, у перекрёстков скруглённые углы.
export const LAYOUT = {
  xs: [-150, 0, 150],
  zs: [-150, 0, 150],
  roadHalf: 3.5,     // полоса 3.5 м в каждую сторону
  sidewalk: 3.2,
  cornerR: 7,        // радиус скругления бордюра на перекрёстке
  curbH: 0.15,
  outer: 600,
};

const WHITE = 0xf2f2ee;

// Прямоугольник со скруглёнными углами в плоскости XZ (форма в координатах x, −z)
function roundedRectShape(x0, z0, x1, z1, r, shape = new THREE.Shape()) {
  const a = x0, b = x1, c = -z1, d = -z0; // y формы = −z
  shape.moveTo(a + r, c);
  shape.lineTo(b - r, c);
  shape.quadraticCurveTo(b, c, b, c + r);
  shape.lineTo(b, d - r);
  shape.quadraticCurveTo(b, d, b - r, d);
  shape.lineTo(a + r, d);
  shape.quadraticCurveTo(a, d, a, d - r);
  shape.lineTo(a, c + r);
  shape.quadraticCurveTo(a, c, a + r, c);
  return shape;
}

function rectPath(x0, z0, x1, z1) {
  const p = new THREE.Path();
  p.moveTo(x0, -z0); p.lineTo(x0, -z1); p.lineTo(x1, -z1); p.lineTo(x1, -z0); p.lineTo(x0, -z0);
  return p;
}

// Форма в плоскости XY → лежит на земле (XZ) на высоте y
function flatten(geo, y) {
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.rand = rng(2024);

    this.mats = {
      asphalt: new THREE.MeshLambertMaterial({ map: asphaltTexture() }),
      paving: new THREE.MeshLambertMaterial({ map: pavingTexture() }),
      curb: new THREE.MeshLambertMaterial({ color: 0x9a9a96 }),
      grass: new THREE.MeshLambertMaterial({ map: grassTexture() }),
      marking: new THREE.MeshLambertMaterial({
        color: WHITE, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
    };
    this.mats.asphalt.map.repeat.set(1 / 6, 1 / 6);
    this.mats.grass.map.repeat.set(1 / 5, 1 / 5);

    this.buildings = [];
    this.trees = [];
    this.lamps = [];
    this.stripes = [];

    this.buildGround();
    this.buildBlocks();
    this.buildOuter();
    this.buildMarkings();
    this.buildBuildingsMesh();
    this.buildTrees();
    this.buildLamps();
  }

  get spawn() {
    // Правая полоса улицы x = 0, едем на север (+Z) к центральному перекрёстку
    return { x: -1.9, z: -115, heading: 0 };
  }

  buildGround() {
    const L = LAYOUT;
    const size = (L.xs[L.xs.length - 1] - L.xs[0]) + 40;
    const asphalt = new THREE.Mesh(flatten(new THREE.PlaneGeometry(size, size), 0), this.mats.asphalt);
    // UV в метрах, чтобы текстура не растягивалась
    const uv = asphalt.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
    asphalt.receiveShadow = true;
    this.group.add(asphalt);

    const far = new THREE.Mesh(flatten(new THREE.PlaneGeometry(6000, 6000), -0.02),
      new THREE.MeshLambertMaterial({ color: 0x5b7f3e }));
    far.receiveShadow = true;
    this.group.add(far);
  }

  // Кварталы между улицами
  buildBlocks() {
    const L = LAYOUT;
    const grassGeos = [];
    for (let i = 0; i < L.xs.length - 1; i++) {
      for (let j = 0; j < L.zs.length - 1; j++) {
        const x0 = L.xs[i] + L.roadHalf, x1 = L.xs[i + 1] - L.roadHalf;
        const z0 = L.zs[j] + L.roadHalf, z1 = L.zs[j + 1] - L.roadHalf;
        const r = L.cornerR;
        const slab = new THREE.Mesh(flatten(new THREE.ExtrudeGeometry(roundedRectShape(x0, z0, x1, z1, r),
          { depth: L.curbH, bevelEnabled: false, curveSegments: 8 }), 0), [this.mats.paving, this.mats.curb]);
        slab.receiveShadow = true;
        this.group.add(slab);
        const s = L.sidewalk;
        grassGeos.push(flatten(new THREE.ShapeGeometry(
          roundedRectShape(x0 + s, z0 + s, x1 - s, z1 - s, Math.max(0.5, r - s)), 6), L.curbH + 0.004));

        this.addRoundedRectCollider(x0, z0, x1, z1, r);
        this.populateBlock(x0, z0, x1, z1);
      }
    }
    const grass = new THREE.Mesh(mergeGeometries(grassGeos), this.mats.grass);
    grass.receiveShadow = true;
    this.group.add(grass);
  }

  // Всё, что за внешним кольцом улиц
  buildOuter() {
    const L = LAYOUT;
    const e = L.xs[L.xs.length - 1] + L.roadHalf; // внешний край кольца
    const O = L.outer;
    const shape = new THREE.Shape();
    shape.moveTo(-O, -O); shape.lineTo(O, -O); shape.lineTo(O, O); shape.lineTo(-O, O); shape.lineTo(-O, -O);
    shape.holes.push(rectPath(-e, -e, e, e));
    const slab = new THREE.Mesh(flatten(new THREE.ExtrudeGeometry(shape, { depth: L.curbH, bevelEnabled: false }), 0),
      [this.mats.paving, this.mats.curb]);
    slab.receiveShadow = true;
    this.group.add(slab);

    const g = e + L.sidewalk;
    const gshape = new THREE.Shape();
    gshape.moveTo(-O, -O); gshape.lineTo(O, -O); gshape.lineTo(O, O); gshape.lineTo(-O, O); gshape.lineTo(-O, -O);
    gshape.holes.push(rectPath(-g, -g, g, g));
    const grass = new THREE.Mesh(flatten(new THREE.ShapeGeometry(gshape), L.curbH + 0.004), this.mats.grass);
    grass.receiveShadow = true;
    this.group.add(grass);

    // Бордюр по внешнему краю — четыре длинных коллайдера
    this.colliders.push(
      { type: 'box', minX: -O, maxX: O, minZ: e, maxZ: O, kind: 'curb' },
      { type: 'box', minX: -O, maxX: O, minZ: -O, maxZ: -e, kind: 'curb' },
      { type: 'box', minX: e, maxX: O, minZ: -e, maxZ: e, kind: 'curb' },
      { type: 'box', minX: -O, maxX: -e, minZ: -e, maxZ: e, kind: 'curb' },
    );

    // Дома вдоль внешней стороны кольца
    const r = this.rand;
    const inset = g + 2;
    for (let side = 0; side < 4; side++) {
      let s = -e - 20;
      while (s < e + 20) {
        const w = 14 + r() * 18, d = 12 + r() * 10, h = 8 + r() * 18;
        const mid = s + w / 2;
        const off = inset + d / 2;
        const [cx, cz, bw, bd] = side === 0 ? [mid, off, w, d] : side === 1 ? [mid, -off, w, d]
          : side === 2 ? [off, mid, d, w] : [-off, mid, d, w];
        this.addBuilding(cx, cz, bw, bd, h);
        s += w + 3 + r() * 10;
      }
      // Деревья между дорогой и домами
      for (let t = -e + 10; t < e - 10; t += 13 + r() * 6) {
        const o = e + 1.3;
        const [tx, tz] = side === 0 ? [t, o] : side === 1 ? [t, -o] : side === 2 ? [o, t] : [-o, t];
        if (!this.nearAnyRoadEnd(tx, tz)) this.trees.push([tx, tz, 0.9 + r() * 0.4]);
      }
    }
    // Дальние дома для «горизонта»
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, dist = 230 + r() * 250;
      const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist;
      if (Math.abs(cx) < e + 40 && Math.abs(cz) < e + 40) continue;
      this.addBuilding(cx, cz, 16 + r() * 20, 16 + r() * 20, 10 + r() * 30);
    }
    for (let i = 0; i < 160; i++) {
      const cx = (r() - 0.5) * 2 * 420, cz = (r() - 0.5) * 2 * 420;
      if (Math.abs(cx) < e + 30 && Math.abs(cz) < e + 30) continue;
      this.trees.push([cx, cz, 0.9 + r() * 0.6]);
    }
  }

  // Точка рядом с выходом улицы на кольцо / перекрёсток (там не сажаем деревья)
  nearAnyRoadEnd(x, z) {
    const L = LAYOUT;
    for (const rx of L.xs) if (Math.abs(x - rx) < L.roadHalf + L.cornerR + 4) return true;
    for (const rz of L.zs) if (Math.abs(z - rz) < L.roadHalf + L.cornerR + 4) return true;
    return false;
  }

  addRoundedRectCollider(x0, z0, x1, z1, r) {
    const c = this.colliders;
    c.push({ type: 'box', minX: x0 + r, maxX: x1 - r, minZ: z0, maxZ: z1, kind: 'curb' });
    c.push({ type: 'box', minX: x0, maxX: x1, minZ: z0 + r, maxZ: z1 - r, kind: 'curb' });
    for (const [x, z] of [[x0 + r, z0 + r], [x1 - r, z0 + r], [x0 + r, z1 - r], [x1 - r, z1 - r]]) {
      c.push({ type: 'circle', x, z, r, kind: 'curb' });
    }
  }

  // Дома по периметру квартала, парк с деревьями внутри, деревья и фонари на тротуаре
  populateBlock(x0, z0, x1, z1) {
    const L = LAYOUT;
    const r = this.rand;
    const inset = L.sidewalk + 2.5;
    const bx0 = x0 + inset, bx1 = x1 - inset, bz0 = z0 + inset, bz1 = z1 - inset;
    const corner = L.cornerR + 6;
    const depthMax = 16;

    // Вдоль сторон, параллельных X (north/south)
    for (const along of ['x', 'z']) {
      for (const far of [false, true]) {
        const start = along === 'x' ? bx0 + (corner - inset) : bz0 + depthMax + 2;
        const end = along === 'x' ? bx1 - (corner - inset) : bz1 - depthMax - 2;
        let s = start;
        while (s < end - 8) {
          const w = Math.min(12 + r() * 20, end - s);
          const d = 10 + r() * (depthMax - 10);
          const h = 9 + r() * 16;
          const mid = s + w / 2;
          if (along === 'x') {
            const cz = far ? bz1 - d / 2 : bz0 + d / 2;
            this.addBuilding(mid, cz, w, d, h);
          } else {
            const cx = far ? bx1 - d / 2 : bx0 + d / 2;
            this.addBuilding(cx, mid, d, w, h);
          }
          s += w + 2 + r() * 8;
        }
      }
    }

    // Парк в середине квартала
    for (let i = 0; i < 28; i++) {
      const tx = bx0 + depthMax + 6 + r() * (bx1 - bx0 - 2 * depthMax - 12);
      const tz = bz0 + depthMax + 6 + r() * (bz1 - bz0 - 2 * depthMax - 12);
      this.trees.push([tx, tz, 0.8 + r() * 0.6]);
    }

    // Уличные деревья и фонари вдоль бордюра
    const edges = [
      { fixed: z0, axis: 'x', from: x0, to: x1, inward: 1 },
      { fixed: z1, axis: 'x', from: x0, to: x1, inward: -1 },
      { fixed: x0, axis: 'z', from: z0, to: z1, inward: 1 },
      { fixed: x1, axis: 'z', from: z0, to: z1, inward: -1 },
    ];
    for (const e of edges) {
      const margin = L.cornerR + 8;
      for (let s = e.from + margin; s < e.to - margin; s += 14) {
        const o = e.fixed + e.inward * 1.4;
        this.trees.push(e.axis === 'x' ? [s + 7, o, 0.75 + r() * 0.3] : [o, s + 7, 0.75 + r() * 0.3]);
      }
      for (let s = e.from + margin - 4; s < e.to - margin; s += 32) {
        const o = e.fixed + e.inward * 0.5;
        const facing = e.axis === 'x' ? (e.inward > 0 ? Math.PI : 0) : (e.inward > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.lamps.push(e.axis === 'x' ? [s, o, facing] : [o, s, facing]);
      }
    }
  }

  addBuilding(cx, cz, w, d, h) {
    const palette = [0xe8dcc4, 0xd9c7a7, 0xc9d3dc, 0xe3c1a8, 0xd0d8c4, 0xf0e6d2, 0xbfc5cc, 0xe6d0b8, 0xd8b4a0];
    this.buildings.push({ cx, cz, w, d, h, color: palette[Math.floor(this.rand() * palette.length)] });
  }

  buildBuildingsMesh() {
    const geos = [];
    const color = new THREE.Color();
    for (const b of this.buildings) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      // UV: одна ячейка окна на 3.2×3 м; крыша — однотонная
      const uv = g.attributes.uv;
      const faces = [[b.d, b.h], [b.d, b.h], null, null, [b.w, b.h], [b.w, b.h]];
      for (let f = 0; f < 6; f++) {
        for (let v = 0; v < 4; v++) {
          const i = f * 4 + v;
          if (!faces[f]) { uv.setXY(i, 0.05, 0.5); continue; }
          const ru = Math.max(1, Math.round(faces[f][0] / 3.2));
          const rv = Math.max(1, Math.round(faces[f][1] / 3.0));
          uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
        }
      }
      color.setHex(b.color).convertSRGBToLinear();
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.translate(b.cx, b.h / 2 + LAYOUT.curbH, b.cz);
      geos.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos),
      new THREE.MeshLambertMaterial({ map: facadeTexture(), vertexColors: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildTrees() {
    const n = this.trees.length;
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.7, 0);
    crownGeo.translate(0, 3.6, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4e35 }), n);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const r = rng(77);
    this.trees.forEach(([x, z, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      s.set(k, k * (0.9 + r() * 0.3), k);
      p.set(x, LAYOUT.curbH, z);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      col.setHSL(0.25 + r() * 0.08, 0.45 + r() * 0.2, 0.28 + r() * 0.1);
      crowns.setColorAt(i, col);
    });
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  buildLamps() {
    const n = this.lamps.length;
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 6.5, 6);
    poleGeo.translate(0, 3.25, 0);
    const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.6);
    armGeo.translate(0, 6.4, 0.75);
    const headGeo = new THREE.BoxGeometry(0.35, 0.12, 0.6);
    headGeo.translate(0, 6.35, 1.5);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x55595e });
    this.lampHeadMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x000000 });
    const poles = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]), poleMat, n);
    const heads = new THREE.InstancedMesh(headGeo, this.lampHeadMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    this.lamps.forEach(([x, z, facing], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
      p.set(x, LAYOUT.curbH, z);
      m.compose(p, q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    this.group.add(poles, heads);
  }

  // Разметка: осевая (прерывистая, у перекрёстков сплошная) и «зебры» у центрального перекрёстка
  buildMarkings() {
    const L = LAYOUT;
    const add = (x, z, sx, sz) => this.stripes.push([x, z, sx, sz]);
    const W = 0.12;
    const centerLine = (fixed, from, to, alongX) => {
      const solid = 18;
      const put = (a, b) => {
        const mid = (a + b) / 2, len = b - a;
        if (alongX) add(mid, fixed, len, W); else add(fixed, mid, W, len);
      };
      put(from, from + solid);
      put(to - solid, to);
      for (let s = from + solid + 6; s + 4 < to - solid - 4; s += 12) put(s, s + 4);
    };
    // Пешеходные переходы на четырёх подходах к центральному перекрёстку
    const d1 = L.roadHalf + L.cornerR + 0.5, len = 4;
    // У центрального перекрёстка осевая начинается за «зеброй»
    const gap = (node, fixed) => (node === 0 && fixed === 0 ? d1 + len + 1 : L.roadHalf + 1);
    for (const z of L.zs) {
      for (let i = 0; i < L.xs.length - 1; i++) {
        centerLine(z, L.xs[i] + gap(L.xs[i], z), L.xs[i + 1] - gap(L.xs[i + 1], z), true);
      }
    }
    for (const x of L.xs) {
      for (let j = 0; j < L.zs.length - 1; j++) {
        centerLine(x, L.zs[j] + gap(L.zs[j], x), L.zs[j + 1] - gap(L.zs[j + 1], x), false);
      }
    }

    for (const sign of [1, -1]) {
      const c = sign * (d1 + len / 2);
      for (let k = -3; k <= 3; k++) {
        const o = k * 1.0;
        add(o, c, 0.5, len);   // переход через улицу x = 0
        add(c, o, len, 0.5);   // переход через улицу z = 0
      }
    }

    const geo = flatten(new THREE.PlaneGeometry(1, 1), 0.012);
    const mesh = new THREE.InstancedMesh(geo, this.mats.marking, this.stripes.length);
    const m = new THREE.Matrix4();
    this.stripes.forEach(([x, z, sx, sz], i) => {
      m.makeScale(sx, 1, sz);
      m.setPosition(x, 0, z);
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  setNight(night) {
    this.lampHeadMat.emissive.setHex(night ? 0xffe8b0 : 0x000000);
  }
}
