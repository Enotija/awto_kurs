import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asphaltTexture, grassTexture, pavingTexture, facadeTexture, rng } from './textures.js';
import {
  buildNetwork, GRID, ROAD_HALF, SIDEWALK, CURB_H, CROSSWALK_LEN, RONDO, roundedRectPoly,
} from './roadNetwork.js';
import { pointAt } from './geometry.js';
import { buildSignMeshes } from './signs.js';
import { TrafficLightsView } from './trafficLightsView.js';
import { SignalController } from '../rules/lights.js';

// Город строится по дорожной сети: кварталы с тротуарами, rondo, разметка,
// знаки, светофоры, дома, деревья и фонари.

const EDGE = GRID[GRID.length - 1] + ROAD_HALF; // внешний край кольцевой улицы
export const OUTER = 600;
// Зарезервировано под площадку экзамена (этап 4): там не строим дома и деревья
export const YARD_AREA = { x0: 225, x1: 345, z0: -75, z1: 75 };

const inYard = (x, z, pad = 0) => x > YARD_AREA.x0 - pad && x < YARD_AREA.x1 + pad && z > YARD_AREA.z0 - pad && z < YARD_AREA.z1 + pad;

function shapeFromPoly(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
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
    this.net = buildNetwork();
    this.signals = new SignalController();
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
        color: 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
    };
    this.mats.asphalt.map.repeat.set(1 / 6, 1 / 6);
    this.mats.grass.map.repeat.set(1 / 5, 1 / 5);

    this.buildings = [];
    this.trees = [];
    this.lamps = [];
    this.stripes = [];
    this.triangles = [];
    // Места, где на тротуаре уже стоит столб (знак, светофор) — туда не сажаем деревья
    this.poles = [...this.net.signs, ...this.net.lights].map((s) => [s.x, s.z]);

    this.buildGround();
    this.buildBlocks();
    this.buildRondo();
    this.buildOuter();
    this.buildMarkings();
    this.buildBuildingsMesh();
    this.buildTrees();
    this.buildLamps();

    const extraSigns = [{ code: 'D-42', x: -64.3, z: -138, facing: Math.PI }, ...this.buildBikePaths()];
    this.group.add(buildSignMeshes([...this.net.signs, ...extraSigns], CURB_H));
    this.lightsView = new TrafficLightsView(this.net, CURB_H);
    this.group.add(this.lightsView.group);
  }

  // Старт: машина припаркована у правого бордюра улицы x = −60, смотрит на север
  get spawn() {
    return { x: -60 - ROAD_HALF + 0.85 + 0.3, z: -150, heading: 0, parked: true };
  }

  update(time) {
    this.lightsView.update(this.signals, time);
  }

  buildGround() {
    const size = 2 * (EDGE + 12);
    const asphalt = new THREE.Mesh(flatten(new THREE.PlaneGeometry(size, size), 0), this.mats.asphalt);
    const uv = asphalt.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
    asphalt.receiveShadow = true;
    this.group.add(asphalt);

    const far = new THREE.Mesh(flatten(new THREE.PlaneGeometry(6000, 6000), -0.02),
      new THREE.MeshLambertMaterial({ color: 0x5b7f3e }));
    far.receiveShadow = true;
    this.group.add(far);
  }

  buildBlocks() {
    const grassGeos = [];
    for (const b of this.net.blocks) {
      const slab = new THREE.Mesh(
        flatten(new THREE.ExtrudeGeometry(shapeFromPoly(b.poly), { depth: CURB_H, bevelEnabled: false }), 0),
        [this.mats.paving, this.mats.curb]);
      slab.receiveShadow = true;
      this.group.add(slab);
      const s = SIDEWALK;
      const ir = {};
      for (const k of Object.keys(b.r)) ir[k] = Math.max(0.5, b.r[k] - s);
      grassGeos.push(flatten(new THREE.ShapeGeometry(shapeFromPoly(roundedRectPoly(b.x0 + s, b.z0 + s, b.x1 - s, b.z1 - s, ir))), CURB_H + 0.004));

      const xs = b.poly.map((p) => p[0]), zs = b.poly.map((p) => p[1]);
      this.colliders.push({
        type: 'poly', poly: b.poly, kind: 'curb',
        minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
      });
      this.populateBlock(b);
    }
    const grass = new THREE.Mesh(mergeGeometries(grassGeos), this.mats.grass);
    grass.receiveShadow = true;
    this.group.add(grass);
  }

  buildRondo() {
    for (const node of this.net.nodes) {
      if (node.kind !== 'roundabout') continue;
      const curb = new THREE.Mesh(new THREE.CylinderGeometry(RONDO.inner, RONDO.inner, CURB_H + 0.05, 40), this.mats.curb);
      curb.position.set(node.x, (CURB_H + 0.05) / 2, node.z);
      curb.receiveShadow = true;
      const top = new THREE.Mesh(flatten(new THREE.CircleGeometry(RONDO.inner - 0.25, 40), CURB_H + 0.055), this.mats.grass);
      top.position.set(node.x, 0, node.z);
      top.receiveShadow = true;
      this.group.add(curb, top);
      // Невысокая клумба и пара деревьев в центре
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.5, 16), new THREE.MeshLambertMaterial({ color: 0x8b5a3c }));
      bed.position.set(node.x, CURB_H + 0.25, node.z);
      bed.castShadow = true;
      this.group.add(bed);
      this.trees.push([node.x + 2.6, node.z + 1.5, 0.8], [node.x - 2.4, node.z - 1.9, 0.7]);
      this.colliders.push({ type: 'circle', x: node.x, z: node.z, r: RONDO.inner, kind: 'curb' });
    }
  }

  // Всё, что за внешним кольцом улиц
  buildOuter() {
    const e = EDGE;
    const O = OUTER;
    const shape = new THREE.Shape();
    shape.moveTo(-O, -O); shape.lineTo(O, -O); shape.lineTo(O, O); shape.lineTo(-O, O); shape.lineTo(-O, -O);
    shape.holes.push(rectPath(-e, -e, e, e));
    shape.holes.push(rectPath(YARD_AREA.x0, YARD_AREA.z0, YARD_AREA.x1, YARD_AREA.z1));
    const slab = new THREE.Mesh(flatten(new THREE.ExtrudeGeometry(shape, { depth: CURB_H, bevelEnabled: false }), 0),
      [this.mats.paving, this.mats.curb]);
    slab.receiveShadow = true;
    this.group.add(slab);

    const g = e + SIDEWALK;
    const gshape = new THREE.Shape();
    gshape.moveTo(-O, -O); gshape.lineTo(O, -O); gshape.lineTo(O, O); gshape.lineTo(-O, O); gshape.lineTo(-O, -O);
    gshape.holes.push(rectPath(-g, -g, g, g));
    gshape.holes.push(rectPath(YARD_AREA.x0 - 2, YARD_AREA.z0 - 2, YARD_AREA.x1 + 2, YARD_AREA.z1 + 2));
    const grass = new THREE.Mesh(flatten(new THREE.ShapeGeometry(gshape), CURB_H + 0.004), this.mats.grass);
    grass.receiveShadow = true;
    this.group.add(grass);

    // Бордюр по внешнему краю кольца — полоса коллайдеров шириной 40 м
    const W = 40;
    this.colliders.push(
      { type: 'box', minX: -e - W, maxX: e + W, minZ: e, maxZ: e + W, kind: 'curb' },
      { type: 'box', minX: -e - W, maxX: e + W, minZ: -e - W, maxZ: -e, kind: 'curb' },
      { type: 'box', minX: e, maxX: e + W, minZ: -e, maxZ: e, kind: 'curb' },
      { type: 'box', minX: -e - W, maxX: -e, minZ: -e, maxZ: e, kind: 'curb' },
    );

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
        if (!inYard(cx, cz, 15)) this.addBuilding(cx, cz, bw, bd, h);
        s += w + 3 + r() * 10;
      }
      for (let t = -e + 10; t < e - 10; t += 13 + r() * 6) {
        const o = e + 1.3;
        const [tx, tz] = side === 0 ? [t, o] : side === 1 ? [t, -o] : side === 2 ? [o, t] : [-o, t];
        if (!this.nearRoadEnd(tx, tz) && !this.nearPole(tx, tz)) this.trees.push([tx, tz, 0.9 + r() * 0.4]);
      }
    }
    for (let i = 0; i < 80; i++) {
      const a = r() * Math.PI * 2, dist = e + 60 + r() * 250;
      const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist;
      if (Math.abs(cx) < e + 45 && Math.abs(cz) < e + 45) continue;
      if (inYard(cx, cz, 30)) continue;
      this.addBuilding(cx, cz, 16 + r() * 20, 16 + r() * 20, 10 + r() * 30);
    }
    for (let i = 0; i < 200; i++) {
      const cx = (r() - 0.5) * 2 * 480, cz = (r() - 0.5) * 2 * 480;
      if (Math.abs(cx) < e + 32 && Math.abs(cz) < e + 32) continue;
      if (inYard(cx, cz, 6)) continue;
      this.trees.push([cx, cz, 0.9 + r() * 0.6]);
    }
  }

  nearRoadEnd(x, z) {
    for (const g of GRID) if (Math.abs(x - g) < ROAD_HALF + 7 + 5 || Math.abs(z - g) < ROAD_HALF + 7 + 5) return true;
    return false;
  }

  nearPole(x, z, r = 2.5) {
    return this.poles.some(([px, pz]) => Math.hypot(px - x, pz - z) < r);
  }

  nearCrosswalk(x, z, r = 7) {
    return this.net.crosswalks.some((c) => Math.hypot(c.x - x, c.z - z) < r);
  }

  populateBlock(b) {
    const { x0, z0, x1, z1, r } = b;
    const rand = this.rand;
    const inset = SIDEWALK + 2.5;
    const depthMax = 16;
    const bx0 = x0 + inset, bx1 = x1 - inset, bz0 = z0 + inset, bz1 = z1 - inset;

    const rows = [
      { along: 'x', from: x0 + r.sw + 6, to: x1 - r.se - 6, fixed: bz0, inward: 1 },
      { along: 'x', from: x0 + r.nw + 6, to: x1 - r.ne - 6, fixed: bz1, inward: -1 },
      { along: 'z', from: bz0 + depthMax + 2, to: bz1 - depthMax - 2, fixed: bx0, inward: 1 },
      { along: 'z', from: bz0 + depthMax + 2, to: bz1 - depthMax - 2, fixed: bx1, inward: -1 },
    ];
    for (const row of rows) {
      let s = row.from;
      while (s < row.to - 8) {
        const w = Math.min(12 + rand() * 20, row.to - s);
        const d = 10 + rand() * (depthMax - 10);
        const h = 9 + rand() * 16;
        const mid = s + w / 2;
        const c = row.fixed + row.inward * d / 2;
        if (row.along === 'x') this.addBuilding(mid, c, w, d, h);
        else this.addBuilding(c, mid, d, w, h);
        s += w + 2 + rand() * 8;
      }
    }

    // Парк в середине
    for (let i = 0; i < 24; i++) {
      const tx = bx0 + depthMax + 6 + rand() * (bx1 - bx0 - 2 * depthMax - 12);
      const tz = bz0 + depthMax + 6 + rand() * (bz1 - bz0 - 2 * depthMax - 12);
      this.trees.push([tx, tz, 0.8 + rand() * 0.6]);
    }

    // Уличные деревья и фонари вдоль бордюра
    const edges = [
      { fixed: z0, axis: 'x', from: x0 + r.sw, to: x1 - r.se, inward: 1 },
      { fixed: z1, axis: 'x', from: x0 + r.nw, to: x1 - r.ne, inward: -1 },
      { fixed: x0, axis: 'z', from: z0 + r.sw, to: z1 - r.nw, inward: 1 },
      { fixed: x1, axis: 'z', from: z0 + r.se, to: z1 - r.ne, inward: -1 },
    ];
    for (const e of edges) {
      for (let s = e.from + 10; s < e.to - 10; s += 14) {
        const o = e.fixed + e.inward * 1.4;
        const [tx, tz] = e.axis === 'x' ? [s + 7, o] : [o, s + 7];
        if (!this.nearCrosswalk(tx, tz) && !this.nearPole(tx, tz)) this.trees.push([tx, tz, 0.75 + rand() * 0.3]);
      }
      for (let s = e.from + 6; s < e.to - 6; s += 32) {
        const o = e.fixed + e.inward * 0.5;
        const [lx, lz] = e.axis === 'x' ? [s, o] : [o, s];
        if (this.nearPole(lx, lz, 1.5)) continue;
        const facing = e.axis === 'x' ? (e.inward > 0 ? Math.PI : 0) : (e.inward > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.lamps.push([lx, lz, facing]);
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
      g.translate(b.cx, b.h / 2 + CURB_H, b.cz);
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
      p.set(x, CURB_H, z);
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
    this.lampHeadMat = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x000000 });
    const poles = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]), new THREE.MeshLambertMaterial({ color: 0x55595e }), n);
    const heads = new THREE.InstancedMesh(headGeo, this.lampHeadMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    this.lamps.forEach(([x, z, facing], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
      p.set(x, CURB_H, z);
      m.compose(p, q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    this.group.add(poles, heads);
  }

  // ---------- Разметка ----------
  // Полоса: центр (x, z), ширина поперёк w, длина вдоль l, курс «вдоль» angle
  stripe(x, z, w, l, angle = 0) { this.stripes.push([x, z, w, l, angle]); }

  buildMarkings() {
    const net = this.net;
    const W = 0.12;

    // Осевая: у перекрёстков и переходов сплошная, между — прерывистая
    for (const edge of net.edges) {
      const a = net.nodeById[edge.a], b = net.nodeById[edge.b];
      const ex = (b.x - a.x) / edge.length, ez = (b.z - a.z) / edge.length;
      const angle = Math.atan2(ex, ez);
      const armA = edge.axis === 'x' ? 'E' : 'N', armB = edge.axis === 'x' ? 'W' : 'S';
      const s0 = a.armDist[armA] + 0.5, s1 = edge.length - b.armDist[armB] - 0.5;
      const cws = net.crosswalks
        .map((c) => ({ c, s: (c.x - a.x) * ex + (c.z - a.z) * ez, off: Math.abs((c.x - a.x) * -ez + (c.z - a.z) * ex) }))
        .filter((c) => c.off < 1 && c.s > s0 && c.s < s1)
        .map((c) => c.s);
      const blocked = (s) => cws.some((c) => Math.abs(s - c) < CROSSWALK_LEN / 2 + 1.5);
      const put = (p, q) => {
        if (q - p < 0.3) return;
        const mid = (p + q) / 2;
        this.stripe(a.x + ex * mid, a.z + ez * mid, W, q - p, angle);
      };
      // Интервалы без переходов
      const cuts = [s0, ...cws.flatMap((c) => [c - CROSSWALK_LEN / 2 - 1.5, c + CROSSWALK_LEN / 2 + 1.5]), s1].sort((p, q) => p - q);
      for (let k = 0; k < cuts.length - 1; k += 2) {
        const p = cuts[k], q = cuts[k + 1];
        const solid = 15;
        if (q - p <= 2 * solid + 6) { put(p, q); continue; }
        put(p, p + solid);
        put(q - solid, q);
        for (let s = p + solid + 6; s + 4 < q - solid - 3; s += 12) if (!blocked(s)) put(s, s + 4);
      }
    }

    // Стоп-линии (P-12) и «зубы» уступи (P-13)
    for (const lane of net.lanes) {
      if (lane.kind !== 'road') continue;
      const t = lane.control.type;
      const end = pointAt(lane, lane.len);
      const angle = Math.atan2(end.dx, end.dz);
      const rx = -end.dz, rz = end.dx; // вправо
      if (t === 'signals' || t === 'stop') {
        this.stripe(end.x + end.dx * 0.25 - rx * 0.05, end.z + end.dz * 0.25 - rz * 0.05, 3.3, 0.5, angle);
      } else if (t === 'yield' || t === 'roundabout') {
        for (let k = -3; k <= 2; k++) {
          const o = k * 0.55 + 0.27;
          this.triangles.push([end.x + end.dx * 0.3 + rx * o, end.z + end.dz * 0.3 + rz * o, angle]);
        }
      }
    }

    // Пешеходные переходы («зебра»): полосы вдоль движения машин, поперёк дороги
    for (const cw of net.crosswalks) {
      const along = cw.roadAxis === 'x' ? Math.PI / 2 : 0;
      for (let k = -3; k <= 3; k++) {
        const o = k * 1.0;
        if (cw.roadAxis === 'x') this.stripe(cw.x, cw.z + o, 0.5, cw.len, along);
        else this.stripe(cw.x + o, cw.z, 0.5, cw.len, along);
      }
    }

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const geo = flatten(new THREE.PlaneGeometry(1, 1), 0.012);
    const mesh = new THREE.InstancedMesh(geo, this.mats.marking, this.stripes.length);
    this.stripes.forEach(([x, z, w, l, angle], i) => {
      q.setFromAxisAngle(UP, angle);
      s.set(w, 1, l);
      p.set(x, 0, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Треугольники P-13: вершиной к водителю
    const tri = new THREE.Shape();
    tri.moveTo(-0.2, 0); tri.lineTo(0.2, 0); tri.lineTo(0, 0.55); tri.closePath();
    const triGeo = new THREE.ShapeGeometry(tri);
    triGeo.rotateX(-Math.PI / 2);   // вершина уходит в −Z (к подъезжающему)
    triGeo.translate(0, 0.012, 0.3);
    const triMesh = new THREE.InstancedMesh(triGeo, this.mats.marking, this.triangles.length);
    this.triangles.forEach(([x, z, angle], i) => {
      q.setFromAxisAngle(UP, angle);
      p.set(x, 0, z);
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      triMesh.setMatrixAt(i, m);
    });
    triMesh.receiveShadow = true;
    this.group.add(triMesh);
  }

  // Велодорожка: красная лента по траве между тротуаром и домами + знаки C-13
  buildBikePaths() {
    const signs = [];
    for (const bp of this.net.bikePaths) {
      const pos = [], idx = [];
      const hw = bp.width / 2;
      bp.pts.forEach(([x, z], i) => {
        const a = bp.pts[Math.max(0, i - 1)], b = bp.pts[Math.min(bp.pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        const rx = -dz / l, rz = dx / l;
        pos.push(x + rx * hw, CURB_H + 0.01, z + rz * hw, x - rx * hw, CURB_H + 0.01, z - rz * hw);
        if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xa4493d, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const s of [20, bp.len / 2 + 20]) {
        const p = pointAt(bp, s);
        signs.push({ code: 'C-13', x: p.x + p.dz * 1.3, z: p.z - p.dx * 1.3, facing: Math.atan2(-p.dx, -p.dz) });
      }
    }
    return signs;
  }

  setNight(night) {
    this.lampHeadMat.emissive.setHex(night ? 0xffe8b0 : 0x000000);
  }
}
