import * as THREE from 'three';
import { LAYER, setLayer } from './layers.js';
import { Cluster } from './cluster.js';

// Глаза водителя (левостороннее расположение руля, Польша)
export const EYE = new THREE.Vector3(0.37, 1.17, -0.25);

const STEER_CENTER = new THREE.Vector3(0.37, 0.76, 0.14);
const STEER_TILT = 24 * Math.PI / 180;

// Положения рычага КПП (схема: 1-3-5 вверху, 2-4-R внизу; +X — влево)
const GEAR_POS = {
  '-1': [-0.05, -0.06], 0: [0, 0], 1: [0.05, 0.06], 2: [0.05, -0.06],
  3: [0, 0.06], 4: [0, -0.06], 5: [-0.05, 0.06],
};

export class Cockpit {
  constructor(parent, { paint = 0xeeeeea } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'cockpit';
    const M = (color) => new THREE.MeshLambertMaterial({ color });
    this.mat = {
      plastic: M(0x2b2e33),
      dashTop: M(0x1c1e21),
      trim: M(0x474b52),
      fabric: M(0x3a3f49),
      headliner: M(0xb3aea4),
      paint: M(paint),
      rubber: M(0x131314),
      metal: M(0x8d9298),
      floor: M(0x202225),
    };
    this.build();
    setLayer(this.group, LAYER.CABIN);
    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    // Экран приборов светится сам и не должен затеняться
    this.clusterFace.castShadow = false;
    this.clusterFace.receiveShadow = false;
    parent.add(this.group);
  }

  box(w, h, d, mat, x, y, z, parent = this.group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // Балка между двумя точками (стойки кузова)
  beam(p0, p1, w, d, mat) {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.group.add(m);
    return m;
  }

  build() {
    const { plastic, dashTop, trim, fabric, headliner, paint, rubber, metal, floor } = this.mat;

    // Капот — из-за руля видна только его полоска
    const hood = this.box(1.62, 0.04, 1.08, paint, 0, 0.82, 1.47);
    hood.rotation.x = 0.075;
    this.box(1.5, 0.05, 0.16, plastic, 0, 0.885, 0.93); // основание лобового стекла

    // Торпедо
    this.box(1.56, 0.33, 0.46, plastic, 0, 0.715, 0.66);
    const top = this.box(1.56, 0.04, 0.5, dashTop, 0, 0.89, 0.68);
    top.rotation.x = -0.12;
    // Колодец приборов с козырьком
    this.box(0.44, 0.16, 0.12, dashTop, 0.37, 0.92, 0.53);
    const hoodC = this.box(0.46, 0.025, 0.2, dashTop, 0.37, 1.0, 0.52);
    hoodC.rotation.x = -0.12;
    this.box(0.025, 0.14, 0.2, dashTop, 0.59, 0.93, 0.52);
    this.box(0.025, 0.14, 0.2, dashTop, 0.15, 0.93, 0.52);
    // Центральная консоль с дефлекторами
    this.box(0.3, 0.22, 0.04, trim, 0, 0.74, 0.43);
    for (const x of [-0.08, 0.08]) this.box(0.1, 0.05, 0.02, rubber, x, 0.82, 0.415);
    this.box(0.26, 0.3, 0.9, plastic, 0, 0.44, 0.05);
    this.box(0.16, 0.08, 0.02, rubber, 0.62, 0.78, 0.425);  // дефлектор у двери
    this.box(0.16, 0.08, 0.02, rubber, -0.62, 0.78, 0.425);

    // Щиток приборов
    this.cluster = new Cluster();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1275),
      new THREE.MeshBasicMaterial({ map: this.cluster.texture, toneMapped: false }));
    face.position.set(0.37, 0.905, 0.46);
    face.lookAt(EYE.clone().add(new THREE.Vector3(0, -0.1, 0)));
    this.group.add(face);
    this.clusterFace = face;

    // Руль
    const col = new THREE.Group();
    col.position.copy(STEER_CENTER);
    col.lookAt(STEER_CENTER.clone().add(new THREE.Vector3(0, Math.sin(STEER_TILT), -Math.cos(STEER_TILT))));
    this.group.add(col);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.32, 10), plastic);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.z = -0.17;
    col.add(shroud);
    this.wheel = new THREE.Group();
    col.add(this.wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.019, 10, 40), rubber);
    this.wheel.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.06, 16), plastic);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.015;
    this.wheel.add(hub);
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, 0.018), plastic);
      spoke.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.005);
      spoke.rotation.z = a;
      this.wheel.add(spoke);
    }
    // Метка верха руля — видно, насколько он повёрнут
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.042), new THREE.MeshLambertMaterial({ color: 0x6d7076 }));
    mark.position.set(0, 0.185, 0);
    this.wheel.add(mark);

    // Стойки, крыша, рамки
    for (const s of [1, -1]) {
      this.beam([s * 0.74, 0.9, 0.86], [s * 0.64, 1.42, 0.08], 0.07, 0.1, plastic);     // A
      this.beam([s * 0.74, 0.92, -0.55], [s * 0.67, 1.43, -0.55], 0.06, 0.1, trim);     // B
      this.box(0.06, 0.48, 0.34, trim, s * 0.7, 1.17, -1.5);                              // C
      // Двери: передняя и задняя
      this.box(0.05, 0.6, 1.33, trim, s * 0.8, 0.64, 0.12);
      this.box(0.1, 0.035, 1.33, plastic, s * 0.765, 0.945, 0.12);                       // подоконник
      this.box(0.08, 0.04, 0.35, plastic, s * 0.76, 0.72, 0.0);                           // подлокотник
      this.box(0.05, 0.6, 0.9, trim, s * 0.8, 0.64, -1.0);
      this.box(0.1, 0.035, 0.9, plastic, s * 0.765, 0.945, -1.0);
      // Треугольник у зеркала
      this.box(0.04, 0.05, 0.22, plastic, s * 0.77, 0.97, 0.72);
      // Боковина крыши
      this.box(0.08, 0.05, 1.6, headliner, s * 0.66, 1.415, -0.75);
    }
    this.box(1.36, 0.03, 1.62, headliner, 0, 1.45, -0.75);  // потолок
    this.box(1.36, 0.08, 0.1, headliner, 0, 1.41, 0.05);     // рамка над лобовым
    // Задняя дверь (хэтчбек)
    this.box(1.4, 0.55, 0.06, trim, 0, 0.66, -1.72);
    this.box(1.4, 0.07, 0.08, headliner, 0, 1.40, -1.62);
    this.box(0.1, 0.46, 0.06, trim, 0.66, 1.15, -1.66);
    this.box(0.1, 0.46, 0.06, trim, -0.66, 1.15, -1.66);
    // Солнцезащитные козырьки
    this.box(0.36, 0.015, 0.16, headliner, 0.36, 1.405, 0.0);
    this.box(0.36, 0.015, 0.16, headliner, -0.36, 1.405, 0.0);

    // Пол и сиденья
    this.box(1.6, 0.02, 3.3, floor, 0, 0.3, -0.4);
    for (const x of [0.37, -0.37]) {
      this.box(0.5, 0.13, 0.5, fabric, x, 0.46, -0.3);
      const back = this.box(0.5, 0.66, 0.12, fabric, x, 0.84, -0.62);
      back.rotation.x = -0.18;
      this.box(0.26, 0.17, 0.1, fabric, x, 1.19, -0.74);
    }
    this.box(1.3, 0.14, 0.5, fabric, 0, 0.47, -1.15);
    this.box(1.3, 0.6, 0.12, fabric, 0, 0.82, -1.45).rotation.x = -0.12;
    for (const x of [-0.42, 0.42]) this.box(0.24, 0.13, 0.09, fabric, x, 1.1, -1.5);

    // Рычаг КПП
    this.gearLever = new THREE.Group();
    this.gearLever.position.set(0, 0.6, 0.1);
    this.group.add(this.gearLever);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), metal);
    stick.position.y = 0.11;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), rubber);
    knob.position.y = 0.23;
    this.gearLever.add(stick, knob);
    this.box(0.14, 0.02, 0.18, rubber, 0, 0.6, 0.1); // чехол

    // Ручник
    this.handbrakeLever = new THREE.Group();
    this.handbrakeLever.position.set(0, 0.6, -0.28);
    this.group.add(this.handbrakeLever);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.28), plastic);
    hb.position.z = 0.14;
    this.handbrakeLever.add(hb);
  }

  // steer −1..1, gear −1..5, handbrake bool, s — данные для приборов
  update(dt, { steer, gear, handbrake }, s, turns) {
    this.wheel.rotation.z = steer * turns * Math.PI * 2;
    const [gx, gz] = GEAR_POS[gear];
    this.gearLever.rotation.set(Math.atan2(gz, 0.23), 0, -Math.atan2(gx, 0.23));
    const target = handbrake ? 0.45 : 0.05;
    this.handbrakeLever.rotation.x += (-(target) - this.handbrakeLever.rotation.x) * Math.min(1, dt * 12);
    this.cluster.update(dt, s);
  }
}
