// Маршрут экзаменатора по городу (без графики): последовательность манёвров на перекрёстках
// и команды на польском (с переводом). Изгибы кольцевой улицы — не перекрёстки, команд там нет.

const ORD_PL = ['', 'pierwszym', 'drugim', 'trzecim', 'czwartym'];
const REQUIRED = ['signals', 'roundabout', 'stop', 'equal'];

export function instructionFor(step) {
  if (!step || step.kind === 'bend') return null;
  if (step.kind === 'roundabout') {
    return {
      pl: `Na rondzie proszę zjechać ${ORD_PL[step.exitIndex] ?? step.exitIndex} zjazdem.`,
      ru: `На кольце — ${step.exitIndex}-й съезд.`,
    };
  }
  const m = step.movement;
  if (m === 'left') return { pl: 'Na najbliższym skrzyżowaniu proszę skręcić w lewo.', ru: 'На ближайшем перекрёстке — налево.' };
  if (m === 'right') return { pl: 'Na najbliższym skrzyżowaniu proszę skręcić w prawo.', ru: 'На ближайшем перекрёстке — направо.' };
  return { pl: 'Na najbliższym skrzyżowaniu proszę jechać prosto.', ru: 'На ближайшем перекрёстке — прямо.' };
}

// Случайная прогулка по сети от полосы startLaneId: steps манёвров (не считая изгибов).
// Перебираем варианты и берём тот, что проходит больше разных типов перекрёстков.
export function planRoute(net, startLaneId, rand = Math.random, { steps = 8, tries = 300 } = {}) {
  let best = null, bestScore = -1;
  for (let t = 0; t < tries; t++) {
    const route = [];
    let lane = net.laneById[startLaneId];
    let count = 0, guard = 0;
    while (count < steps && guard++ < 60) {
      const node = net.nodeById[lane.to];
      const opts = lane.next.map((id) => net.laneById[id]).filter((c) => c.movement !== 'uturn');
      const conn = opts[Math.floor(rand() * opts.length)];
      route.push({
        node: node.id, kind: node.kind, armIn: conn.arm, armOut: conn.outArm,
        movement: conn.movement, exitIndex: conn.exitIndex, conn: conn.id,
      });
      if (node.kind !== 'bend') count++;
      lane = net.laneById[conn.next[0]];
    }
    const kinds = new Set(route.map((r) => r.kind));
    const movs = new Set(route.filter((r) => r.kind !== 'bend').map((r) => r.movement));
    const score = REQUIRED.filter((k) => kinds.has(k)).length * 10 + movs.size;
    if (score > bestScore) { best = route; bestScore = score; }
    if (bestScore >= REQUIRED.length * 10 + 3) break;
  }
  return best;
}

// Следит за выполнением маршрута по событиям выезда с перекрёстков
export class RouteTracker {
  constructor(route) {
    this.route = route;
    this.idx = 0;
  }

  get done() { return this.idx >= this.route.length; }
  get total() { return this.route.filter((r) => r.kind !== 'bend').length; }
  get passed() { return this.route.slice(0, this.idx).filter((r) => r.kind !== 'bend').length; }

  // Следующий шаг с командой (изгибы пропускаем)
  get next() {
    for (let i = this.idx; i < this.route.length; i++) if (this.route[i].kind !== 'bend') return this.route[i];
    return null;
  }

  // ev — событие nodeExit из движка правил. Возвращает 'ok' | 'wrong' | 'ignore'
  onExit(ev) {
    const step = this.route[this.idx];
    if (!step) return 'ignore';
    if (ev.node.id !== step.node) return 'wrong';
    if (ev.armOut !== step.armOut) return 'wrong';
    this.idx++;
    return 'ok';
  }
}
