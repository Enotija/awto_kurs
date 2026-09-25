import * as THREE from 'three';
import { LAYER, setLayer } from './layers.js';

// Три зеркала: отдельная камера рисует вид назад в текстуру,
// текстура отражена по горизонтали — как в настоящем зеркале.

const UP = new THREE.Vector3(0, 1, 0);

const deg = (d) => d * Math.PI / 180;
function dir(yawDeg, pitchDeg) {
  // yaw: 0 — строго назад, + — наружу влево (к +X)
  const y = deg(yawDeg), p = deg(pitchDeg);
  return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}

// Салонное зеркало рисуется первым: при этом строится карта теней,
// в которой салон (крыша, стойки) отбрасывает тень.
export const MIRROR_DEFS = {
  inner: {
    pos: new THREE.Vector3(0.0, 1.30, 0.3), size: [0.25, 0.07], fov: 12,
    view: dir(0, -2.5), res: [640, 180], layers: [LAYER.WORLD, LAYER.CABIN], housing: 'inner',
  },
  left: {
    pos: new THREE.Vector3(0.99, 0.99, 0.6), size: [0.18, 0.115], fov: 20,
    view: dir(11, -2.5), res: [384, 246], layers: [LAYER.WORLD, LAYER.BODY], housing: 'side',
  },
  right: {
    // Правое зеркало выпуклое — угол обзора шире
    pos: new THREE.Vector3(-0.99, 0.99, 0.6), size: [0.18, 0.115], fov: 26,
    view: dir(-15, -3), res: [384, 246], layers: [LAYER.WORLD, LAYER.BODY], housing: 'side',
  },
};

function flipU(geo) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  return geo;
}

export class Mirrors {
  constructor(parent, eye, { paint = 0xeeeeea } = {}) {
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'mirrors';
    const housingMat = new THREE.MeshLambertMaterial({ color: 0x1d1f22 });
    const paintMat = new THREE.MeshLambertMaterial({ color: paint });

    for (const [name, d] of Object.entries(MIRROR_DEFS)) {
      const [w, h] = d.size;
      const rt = new THREE.WebGLRenderTarget(d.res[0], d.res[1], { samples: 4 });
      const cam = new THREE.PerspectiveCamera(d.fov, w / h, 0.1, 500);
      cam.position.copy(d.pos);
      cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(d.pos, d.pos.clone().add(d.view), UP));
      cam.layers.disableAll();
      for (const l of d.layers) cam.layers.enable(l);
      parent.add(cam);

      // Стекло повёрнуто по биссектрисе между «к глазам» и «куда смотрит отражение»
      const toEye = eye.clone().sub(d.pos).normalize();
      const n = toEye.add(d.view).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(d.pos.clone().add(n), d.pos, UP));

      const glass = new THREE.Mesh(flipU(new THREE.PlaneGeometry(w, h)),
        new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xe6e6e6, toneMapped: false }));
      glass.position.copy(d.pos).addScaledVector(n, 0.004);
      glass.quaternion.copy(q);

      const housing = new THREE.Group();
      housing.position.copy(d.pos);
      housing.quaternion.copy(q);
      if (d.housing === 'side') {
        const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.07), paintMat);
        back.position.z = -0.04;
        const rimM = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.012), housingMat);
        rimM.position.z = -0.003;
        housing.add(back, rimM);
        // Кронштейн к двери
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), housingMat);
        arm.position.set(Math.sign(d.pos.x) * 0.08, -0.03, -0.04);
        housing.add(arm);
      } else {
        const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.035), housingMat);
        back.position.z = -0.02;
        housing.add(back);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), housingMat);
        stem.position.set(0, 0.07, -0.03);
        housing.add(stem);
      }
      this.group.add(glass, housing);
      this.items.push({ name, rt, cam, glass, def: d });
    }
    setLayer(this.group, LAYER.DRIVER_ONLY);
    parent.add(this.group);
  }

  render(renderer, scene) {
    const prev = renderer.getRenderTarget();
    for (const m of this.items) {
      renderer.setRenderTarget(m.rt);
      renderer.render(scene, m.cam);
    }
    renderer.setRenderTarget(prev);
  }
}
