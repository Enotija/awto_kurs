import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signTexture } from './signs.js';

// Светофоры: столбы и корпуса — одна сетка, лампы — по сетке на (группа × цвет),
// чтобы переключать сигнал сменой цвета материала.

const ON = { red: 0xff2a14, yellow: 0xffb000, green: 0x22ff6a };
const OFF = { red: 0x3a0c0a, yellow: 0x3a2a08, green: 0x0a2e14 };
const PED_ON = { red: 0xff2a14, green: 0x22ff6a };

export class TrafficLightsView {
  constructor(net, baseY) {
    this.group = new THREE.Group();
    this.group.name = 'trafficLights';
    this.mats = {};
    for (const g of ['NS', 'EW']) {
      for (const c of ['red', 'yellow', 'green']) {
        this.mats[`${g}:${c}`] = new THREE.MeshBasicMaterial({ color: OFF[c], toneMapped: false });
      }
      for (const c of ['red', 'green']) {
        this.mats[`ped:${g}:${c}`] = new THREE.MeshBasicMaterial({ color: OFF[c], toneMapped: false });
      }
    }
    const housings = [], lamps = {}, arrows = [];
    const push = (k, g) => { (lamps[k] ||= []).push(g); };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const UP = new THREE.Vector3(0, 1, 0);
    const place = (geo, x, y, z, facing, lx = 0, lz = 0) => {
      q.setFromAxisAngle(UP, facing);
      p.set(x, y, z);
      m.compose(p, q, one);
      geo.translate(lx, 0, lz);
      return geo.applyMatrix4(m);
    };

    for (const L of net.lights) {
      const top = baseY + 3.6;
      const pole = new THREE.CylinderGeometry(0.06, 0.07, top - baseY, 8);
      pole.translate(0, (top - baseY) / 2 - 3.6 / 2, 0);
      housings.push(place(pole, L.x, baseY + 3.6 / 2, L.z, L.facing, 0, -0.15));
      const headY = baseY + 3.2;
      housings.push(place(new THREE.BoxGeometry(0.34, 0.95, 0.22), L.x, headY, L.z, L.facing));
      // Козырьки над лампами
      [0.3, 0, -0.3].forEach((dy, k) => {
        const color = ['red', 'yellow', 'green'][k];
        const disc = new THREE.CircleGeometry(0.11, 16);
        push(`${L.group}:${color}`, place(disc, L.x, headY + dy, L.z, L.facing, 0, 0.112));
        const visor = new THREE.BoxGeometry(0.28, 0.02, 0.12);
        housings.push(place(visor, L.x, headY + dy + 0.13, L.z, L.facing, 0, 0.17));
      });
      if (L.arrow) {
        const plate = new THREE.PlaneGeometry(0.3, 0.3);
        arrows.push(place(plate, L.x, headY + 0.3, L.z, L.facing, 0.34, 0.11));
      }
    }

    // Пешеходные светофоры на обоих концах регулируемых переходов
    for (const cw of net.crosswalks) {
      if (!cw.signal) continue;
      const across = cw.roadAxis === 'x' ? [0, 1] : [1, 0]; // куда идут пешеходы
      for (const sgn of [1, -1]) {
        const x = cw.x + across[0] * sgn * (cw.halfWidth + 0.5);
        const z = cw.z + across[1] * sgn * (cw.halfWidth + 0.5);
        const facing = Math.atan2(-across[0] * sgn, -across[1] * sgn); // смотрит через дорогу
        const y = baseY + 2.3;
        const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6);
        housings.push(place(pole, x, baseY + 1.35, z, facing, 0, -0.12));
        housings.push(place(new THREE.BoxGeometry(0.26, 0.56, 0.16), x, y, z, facing));
        push(`ped:${cw.signal}:red`, place(new THREE.PlaneGeometry(0.16, 0.2), x, y + 0.13, z, facing, 0, 0.082));
        push(`ped:${cw.signal}:green`, place(new THREE.PlaneGeometry(0.16, 0.2), x, y - 0.13, z, facing, 0, 0.082));
      }
    }

    const housing = new THREE.Mesh(mergeGeometries(housings), new THREE.MeshLambertMaterial({ color: 0x25282c }));
    housing.castShadow = true;
    this.group.add(housing);
    for (const [k, geos] of Object.entries(lamps)) this.group.add(new THREE.Mesh(mergeGeometries(geos), this.mats[k]));
    if (arrows.length) {
      this.group.add(new THREE.Mesh(mergeGeometries(arrows),
        new THREE.MeshBasicMaterial({ map: signTexture('ARROW'), toneMapped: false })));
    }
  }

  update(controller, time) {
    for (const g of ['NS', 'EW']) {
      const st = controller.state(g, time);
      const lit = { red: st === 'red' || st === 'redYellow', yellow: st === 'yellow' || st === 'redYellow', green: st === 'green' };
      for (const c of ['red', 'yellow', 'green']) this.mats[`${g}:${c}`].color.setHex(lit[c] ? ON[c] : OFF[c]);
      const ped = controller.pedestrian(g, time);
      const blinkOff = ped === 'flash' && Math.floor(time * 2) % 2 === 1;
      this.mats[`ped:${g}:green`].color.setHex(ped !== 'stop' && !blinkOff ? PED_ON.green : OFF.green);
      this.mats[`ped:${g}:red`].color.setHex(ped === 'stop' ? PED_ON.red : OFF.red);
    }
  }
}
