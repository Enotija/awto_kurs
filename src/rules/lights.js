// Цикл светофора (без графики). Две группы: NS — подъезды с севера и юга, EW — с востока и запада.
// Польская последовательность: красный → красный+жёлтый → зелёный → жёлтый → красный.

export const LIGHT_TIMING = { green: 14, yellow: 3, allRed: 2, redYellow: 1.5, pedFlash: 4 };

export class SignalController {
  constructor(timing = LIGHT_TIMING, offset = 0) {
    this.t = timing;
    this.offset = offset;
  }

  get half() { return this.t.green + this.t.yellow + this.t.allRed; }
  get cycle() { return 2 * this.half; }

  // Фаза группы NS в момент time; EW сдвинута на полцикла
  phase(group, time) {
    const c = this.cycle;
    const shift = group === 'NS' ? 0 : this.half;
    return (((time + this.offset - shift) % c) + c) % c;
  }

  // 'green' | 'yellow' | 'red' | 'redYellow'
  state(group, time) {
    const p = this.phase(group, time);
    const { green, yellow, redYellow } = this.t;
    if (p < green) return 'green';
    if (p < green + yellow) return 'yellow';
    if (p >= this.cycle - redYellow) return 'redYellow';
    return 'red';
  }

  // Сколько секунд до конца текущего сигнала (ИИ решает, успевает ли проехать на зелёный)
  remaining(group, time) {
    const p = this.phase(group, time);
    const { green, yellow, redYellow } = this.t;
    if (p < green) return green - p;
    if (p < green + yellow) return green + yellow - p;
    if (p >= this.cycle - redYellow) return this.cycle - p;
    return this.cycle - redYellow - p;
  }

  // Сигнал для пешеходов на переходе, идущем параллельно группе машин group:
  // 'walk' | 'flash' | 'stop'
  pedestrian(group, time) {
    const p = this.phase(group, time);
    const { green, pedFlash } = this.t;
    if (p < green - pedFlash) return 'walk';
    if (p < green) return 'flash';
    return 'stop';
  }
}
