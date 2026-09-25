import * as THREE from 'three';
import { LAYER } from './layers.js';
import { MIRROR_DEFS } from './mirrors.js';

const BASE_PITCH = -0.1;       // чуть вниз, чтобы были видны приборы
const BASE_FOV = 62;
const SHOULDER_AFTER = 0.45;   // держишь стрелку дольше — взгляд через плечо

// Направление взгляда (yaw, pitch) из глаз на точку салона
function aim(eye, p) {
  const d = p.clone().sub(eye);
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) - BASE_PITCH };
}

// Камера водителя: взгляд в зеркала и через плечо. Запоминает, когда
// водитель последний раз проверял каждое зеркало (для правил на этапе 2).
export class DriverView {
  constructor(parent, eye) {
    this.eye = eye.clone();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 2500);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(LAYER.CABIN);
    this.camera.layers.enable(LAYER.DRIVER_ONLY);
    this.camera.position.copy(eye);
    parent.add(this.camera);

    this.targets = {
      // fov — «фокус взгляда»: зеркало видно крупнее, пока на него смотришь
      mirrorLeft: { ...aim(eye, MIRROR_DEFS.left.pos), tol: 0.17, fov: 34, label: 'левое зеркало' },
      mirrorRight: { ...aim(eye, MIRROR_DEFS.right.pos), tol: 0.17, fov: 18, label: 'правое зеркало' },
      mirrorInner: { ...aim(eye, MIRROR_DEFS.inner.pos), tol: 0.15, fov: 34, label: 'салонное зеркало' },
      shoulderLeft: { yaw: 2.2, pitch: -0.05, tol: 0.4, label: 'через левое плечо', offset: new THREE.Vector3(0.05, 0.02, 0.06) },
      shoulderRight: { yaw: -2.3, pitch: -0.05, tol: 0.4, label: 'через правое плечо', offset: new THREE.Vector3(-0.1, 0.02, 0.06) },
    };
    this.yaw = 0;
    this.pitch = 0;
    this.offset = new THREE.Vector3();
    this.bob = 0;
    this.dwell = {};
    this.checks = {};   // имя → время последней проверки (с)
    this.looking = null;
    for (const k of Object.keys(this.targets)) { this.dwell[k] = 0; this.checks[k] = -Infinity; }
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, input, time, accel) {
    const T = this.targets;
    let target = null;
    if (input.look.left > 0) target = input.look.left < SHOULDER_AFTER ? 'mirrorLeft' : 'shoulderLeft';
    else if (input.look.right > 0) target = input.look.right < SHOULDER_AFTER ? 'mirrorRight' : 'shoulderRight';
    else if (input.look.up > 0) target = 'mirrorInner';

    let tYaw = 0, tPitch = 0, tFov = BASE_FOV;
    const tOff = new THREE.Vector3();
    if (target) {
      tYaw = T[target].yaw;
      tPitch = T[target].pitch;
      if (T[target].offset) tOff.copy(T[target].offset);
      if (T[target].fov) tFov = T[target].fov;
    }
    // Мышь (правая кнопка) — свободный взгляд; отпустил — голова возвращается
    const ml = input.mouseLook;
    if (!ml.active) {
      const k = Math.exp(-dt * 6);
      ml.yaw *= k; ml.pitch *= k;
    }
    tYaw += ml.yaw;
    tPitch += ml.pitch;

    const k = 1 - Math.exp(-dt * 11);
    this.yaw += (tYaw - this.yaw) * k;
    this.pitch += (tPitch - this.pitch) * k;
    this.offset.lerp(tOff, k);
    if (Math.abs(this.camera.fov - tFov) > 0.01) {
      this.camera.fov += (tFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
    // Лёгкий кивок при разгоне и торможении
    this.bob += (THREE.MathUtils.clamp(accel * 0.005, -0.05, 0.04) - this.bob) * (1 - Math.exp(-dt * 4));

    this.camera.position.copy(this.eye).add(this.offset);
    this.camera.rotation.set(BASE_PITCH + this.pitch + this.bob, Math.PI + this.yaw, 0);

    // Засчитываем взгляд, если задержался на цели хотя бы 0.2 с
    this.looking = null;
    for (const [name, t] of Object.entries(T)) {
      const d = Math.hypot(this.yaw - t.yaw, (this.pitch - t.pitch) * 0.7);
      if (d < t.tol) {
        this.dwell[name] += dt;
        this.looking = name;
        if (this.dwell[name] >= 0.2) this.checks[name] = time;
      } else {
        this.dwell[name] = 0;
      }
    }
  }

  // Смотрел ли водитель в это зеркало за последние seconds секунд
  checkedWithin(name, time, seconds) {
    return time - this.checks[name] <= seconds;
  }
}
