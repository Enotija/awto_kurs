// Отладочный автопилот: ведёт машину игрока по списку полос через «виртуальный геймпад».
// Нужен для автоматических проверок в браузере (sim.autopilot(...)), в игре не используется.

export function createAutopilot(sim, laneIds, opts = {}) {
  const net = sim.city.net, car = sim.car, p = car.physics, input = sim.input;
  const path = [];
  for (const id of laneIds) {
    for (const pt of net.laneById[id].pts) {
      const l = path[path.length - 1];
      if (!l || Math.hypot(l[0] - pt[0], l[1] - pt[1]) > 1e-3) path.push(pt);
    }
  }
  const pad = { steer: 0, throttle: 0, brake: 0, clutch: 0, lookX: 0 };
  const realPad = input.readGamepad.bind(input);
  input.readGamepad = () => pad;
  let idx = 0, launch = 0, shiftT = -1, pendingShift = null;

  const ap = {
    pad, path, done: false, kmh: opts.kmh ?? 30,
    stop() { input.readGamepad = realPad; },
    // Сколько метров до конца пути от ближайшей точки
    remaining() {
      let d = 0;
      for (let i = idx; i < path.length - 1; i++) d += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
      return d;
    },
    step(dt) {
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const lx = Math.cos(p.heading), lz = -Math.sin(p.heading);
      let best = Infinity;
      for (let i = idx; i < Math.min(path.length, idx + 30); i++) {
        const d = Math.hypot(path[i][0] - p.centerX, path[i][1] - p.centerZ);
        if (d < best) { best = d; idx = i; }
      }
      if (idx >= path.length - 2) { ap.done = true; pad.throttle = 0; pad.brake = 0.6; pad.clutch = 1; return; }
      let ti = idx;
      while (ti < path.length - 1 && Math.hypot(path[ti][0] - p.x, path[ti][1] - p.z) < 6) ti++;
      const dx = path[ti][0] - p.x, dz = path[ti][1] - p.z;
      const alpha = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz);
      const delta = Math.atan(2 * p.p.wheelbase * Math.sin(alpha) / Math.hypot(dx, dz));
      const st = Math.max(-1, Math.min(1, delta / p.p.maxWheelAngle));
      pad.steer = Math.sign(st) * Math.sqrt(Math.abs(st));
      let vT = typeof ap.kmh === 'function' ? ap.kmh(ap) : ap.kmh;
      const v = p.speedKmh;
      // Держать дистанцию до машины, велосипеда или пешехода впереди
      if (sim.traffic) {
        const rx = -fz, rz = fx;
        let gap = Infinity;
        const crossing = sim.traffic.peds.filter((q) => q.state === 'cross');
        for (const o of [...sim.traffic.vehicles, ...crossing]) {
          const dx = o.x - p.centerX, dz = o.z - p.centerZ;
          const lon = dx * fx + dz * fz, lat = Math.abs(dx * rx + dz * rz);
          if (lon > 0 && lon < 35 && lat < 1.9) gap = Math.min(gap, lon - 2 - (o.hl ?? 0.3));
        }
        if (gap < Infinity) vT = Math.min(vT, Math.max(0, (gap - 2.5) * 0.9) * 3.6);
      }
      if (p.handbrake && p.engine.running) p.handbrake = false;
      if (!p.engine.running) {
        pad.clutch = 1; pad.throttle = 0;
        if (p.engine.cranking <= 0) p.startEngine(1);
        launch = 0;
        return;
      }
      if (pendingShift) {
        pendingShift.t -= dt;
        if (pendingShift.t <= 0) { if (pendingShift.dir > 0) p.shiftUp(1); else p.shiftDown(1); pendingShift = null; }
      }
      if (shiftT >= 0) {
        shiftT -= dt;
        pad.clutch = shiftT > 0.25 ? 1 : Math.max(0, shiftT / 0.25);
        pad.throttle = 0;
        if (shiftT < 0) shiftT = -1;
        return;
      }
      if (vT <= 0.1) {
        pad.throttle = 0; pad.clutch = 1; pad.brake = v > 0.3 ? 0.7 : 0.4;
        launch = 0;
        return;
      }
      if (p.gearbox.gear <= 0) { pad.clutch = 1; if (p.gearbox.gear === 0) p.shiftUp(1); launch = 0; return; }
      if (launch < 1.3 && v < 6) {
        launch += dt;
        pad.clutch = Math.max(0, 1 - launch / 1.2); pad.throttle = 0.35; pad.brake = 0;
        return;
      }
      launch = 2;
      pad.clutch = 0;
      if (p.rpm > 2800 && p.gearbox.gear < 3 && v < vT) { shiftT = 0.6; pad.clutch = 1; pendingShift = { dir: 1, t: 0.15 }; return; }
      if (p.rpm < 1300 && p.gearbox.gear > 1) { shiftT = 0.6; pad.clutch = 1; pendingShift = { dir: -1, t: 0.15 }; return; }
      if (p.rpm < 1000 && p.gearbox.gear === 1 && v < 4) { launch = 0; return; }
      const err = vT - v;
      pad.throttle = Math.max(0, Math.min(0.6, 0.08 * err));
      pad.brake = err < -2 ? Math.min(0.7, -0.07 * err) : 0;
    },
    run(seconds, onStep) {
      for (let t = 0; t < seconds && !ap.done; t += 1 / 60) {
        ap.step(1 / 60);
        onStep?.(t);
        sim.advance(1 / 60, 1 / 60, false);
      }
      sim.advance(0);
    },
  };
  return ap;
}

// Полоса улицы между двумя узлами и связка через узел — для составления маршрутов
export function routeHelpers(net) {
  const L = (a, b) => {
    const e = net.edges.find((ed) => (ed.a === a && ed.b === b) || (ed.a === b && ed.b === a));
    return e.lanes[`${a}>${b}`];
  };
  const C = (n, i, o) => net.nodeById[n].connectors[`${i}>${o}`];
  return { L, C };
}
