import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Отрисовка живого города: всё через InstancedMesh — по одному вызову на тип детали.

const MAX_CARS = 48, MAX_BIKES = 24, MAX_PEDS = 64;
const LAMP = {
  brakeOn: 0xff1a10, brakeOff: 0x5a0d0a,
  blinkOn: 0xffa010, blinkOff: 0x4a3510,
  headOn: 0xfff4d6, headOff: 0xb8bcc2,
};

function inst(geo, mat, n, color = false) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (color) m.setColorAt(0, new THREE.Color(1, 1, 1));
  m.count = 0;
  m.castShadow = true;
  m.frustumCulled = false;
  return m;
}

export class TrafficView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });

    // Машины
    const body = new THREE.BoxGeometry(1.75, 0.62, 4.2); body.translate(0, 0.56, 0);
    const bumperF = new THREE.BoxGeometry(1.77, 0.16, 0.12); bumperF.translate(0, 0.34, 2.1);
    const bumperR = new THREE.BoxGeometry(1.77, 0.16, 0.12); bumperR.translate(0, 0.34, -2.1);
    this.carBody = inst(mergeGeometries([body]), L(0xffffff), MAX_CARS, true);
    const cabin = new THREE.BoxGeometry(1.5, 0.52, 2.1); cabin.translate(0, 1.13, -0.25);
    this.carCabin = inst(cabin, L(0x26313b), MAX_CARS);
    const trim = mergeGeometries([bumperF, bumperR]);
    this.carTrim = inst(trim, L(0x1d1f22), MAX_CARS);
    const wheel = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 12); wheel.rotateZ(Math.PI / 2);
    this.wheels = inst(wheel, L(0x141414), MAX_CARS * 4);
    const lamp = new THREE.BoxGeometry(0.28, 0.12, 0.05);
    this.lamps = inst(lamp, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_CARS * 8, true);
    this.lamps.castShadow = false;

    // Велосипеды: рама + колёса + велосипедист
    const frame = new THREE.BoxGeometry(0.06, 0.06, 1.0); frame.translate(0, 0.62, 0);
    const bw1 = new THREE.TorusGeometry(0.33, 0.035, 6, 16); bw1.rotateY(Math.PI / 2); bw1.translate(0, 0.35, 0.52);
    const bw2 = bw1.clone(); bw2.translate(0, 0, -1.04);
    this.bikeFrames = inst(mergeGeometries([frame, bw1, bw2]), L(0x2b2b2b), MAX_BIKES);
    const torso = new THREE.CapsuleGeometry(0.2, 0.45, 4, 8); torso.rotateX(0.35); torso.translate(0, 1.2, -0.05);
    this.riders = inst(torso, L(0xffffff), MAX_BIKES, true);
    const rHead = new THREE.SphereGeometry(0.14, 10, 8); rHead.translate(0, 1.7, 0.12);
    this.riderHeads = inst(rHead, L(0xe0b090), MAX_BIKES);

    // Пешеходы
    const pBody = new THREE.CapsuleGeometry(0.22, 0.62, 4, 8); pBody.translate(0, 1.12, 0);
    this.pedBodies = inst(pBody, L(0xffffff), MAX_PEDS, true);
    const pHead = new THREE.SphereGeometry(0.13, 10, 8); pHead.translate(0, 1.68, 0);
    this.pedHeads = inst(pHead, L(0xe0b090), MAX_PEDS);
    const leg = new THREE.BoxGeometry(0.13, 0.75, 0.15); leg.translate(0, -0.375, 0);
    this.pedLegs = inst(leg, L(0x2f3542), MAX_PEDS * 2);

    this.group.add(this.carBody, this.carCabin, this.carTrim, this.wheels, this.lamps,
      this.bikeFrames, this.riders, this.riderHeads, this.pedBodies, this.pedHeads, this.pedLegs);

    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.c = new THREE.Color();
    this.local = new THREE.Matrix4();
    this.UP = new THREE.Vector3(0, 1, 0);
    this.night = false;
  }

  setNight(on) { this.night = on; }

  update(traffic, time) {
    const { m, q, p, s, c, local, UP } = this;
    const blink = Math.floor(time / 0.4) % 2 === 0;
    let ci = 0, bi = 0, wi = 0, li = 0;

    const setLamp = (base, x, y, z, color) => {
      local.makeTranslation(x, y, z);
      this.lamps.setMatrixAt(li, m.copy(base).multiply(local));
      this.lamps.setColorAt(li, c.setHex(color));
      li++;
    };

    for (const a of traffic.vehicles) {
      q.setFromAxisAngle(UP, a.heading);
      p.set(a.x, 0, a.z);
      const base = new THREE.Matrix4().compose(p, q, s);
      if (a.kind === 'car') {
        if (ci >= MAX_CARS) continue;
        this.carBody.setMatrixAt(ci, base);
        this.carBody.setColorAt(ci, c.setHex(a.color));
        this.carCabin.setMatrixAt(ci, base);
        this.carTrim.setMatrixAt(ci, base);
        for (const [wx, wz] of [[0.78, 1.3], [-0.78, 1.3], [0.78, -1.3], [-0.78, -1.3]]) {
          local.makeTranslation(wx, 0.31, wz);
          this.wheels.setMatrixAt(wi++, m.copy(base).multiply(local));
        }
        const brake = a.braking ? LAMP.brakeOn : LAMP.brakeOff;
        setLamp(base, 0.6, 0.72, -2.11, brake);
        setLamp(base, -0.6, 0.72, -2.11, brake);
        const lOn = a.signal === 'left' && blink, rOn = a.signal === 'right' && blink;
        // +X — левый борт
        setLamp(base, 0.8, 0.6, -2.11, lOn ? LAMP.blinkOn : LAMP.blinkOff);
        setLamp(base, -0.8, 0.6, -2.11, rOn ? LAMP.blinkOn : LAMP.blinkOff);
        setLamp(base, 0.8, 0.6, 2.11, lOn ? LAMP.blinkOn : LAMP.blinkOff);
        setLamp(base, -0.8, 0.6, 2.11, rOn ? LAMP.blinkOn : LAMP.blinkOff);
        const head = this.night ? LAMP.headOn : LAMP.headOff;
        setLamp(base, 0.55, 0.66, 2.11, head);
        setLamp(base, -0.55, 0.66, 2.11, head);
        ci++;
      } else {
        this.addBike(bi++, base, a.color);
      }
    }
    for (const b of traffic.pathBikes) {
      if (bi >= MAX_BIKES) break;
      q.setFromAxisAngle(UP, b.heading);
      p.set(b.x, 0.15, b.z);
      this.addBike(bi++, new THREE.Matrix4().compose(p, q, s), b.color);
    }

    let pi = 0;
    for (const ped of traffic.peds) {
      if (pi >= MAX_PEDS) break;
      q.setFromAxisAngle(UP, ped.heading);
      const walking = ped.state === 'cross';
      const bob = walking ? Math.abs(Math.sin(ped.phase)) * 0.04 : 0;
      p.set(ped.x, (Math.abs(ped.u) > 3.6 ? 0.15 : 0) + bob, ped.z);
      const base = new THREE.Matrix4().compose(p, q, s);
      this.pedBodies.setMatrixAt(pi, base);
      this.pedBodies.setColorAt(pi, c.setHex(ped.color));
      this.pedHeads.setMatrixAt(pi, base);
      const swing = walking ? Math.sin(ped.phase) * 0.45 : 0;
      for (const [k, sx] of [[0, 0.1], [1, -0.1]]) {
        const lq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), k ? -swing : swing);
        local.compose(new THREE.Vector3(sx, 0.78, 0), lq, s);
        this.pedLegs.setMatrixAt(pi * 2 + k, m.copy(base).multiply(local));
      }
      pi++;
    }

    this.carBody.count = this.carCabin.count = this.carTrim.count = ci;
    this.wheels.count = ci * 4;
    this.lamps.count = li;
    this.bikeFrames.count = this.riders.count = this.riderHeads.count = bi;
    this.pedBodies.count = this.pedHeads.count = pi;
    this.pedLegs.count = pi * 2;
    for (const mesh of [this.carBody, this.carCabin, this.carTrim, this.wheels, this.lamps, this.bikeFrames,
      this.riders, this.riderHeads, this.pedBodies, this.pedHeads, this.pedLegs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  addBike(i, base, color) {
    this.bikeFrames.setMatrixAt(i, base);
    this.riders.setMatrixAt(i, base);
    this.riders.setColorAt(i, this.c.setHex(color));
    this.riderHeads.setMatrixAt(i, base);
  }
}
