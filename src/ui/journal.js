// Журнал нарушений на экране + знак текущего ограничения скорости.

const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export class Journal {
  constructor() {
    const root = document.createElement('div');
    root.id = 'journal';
    root.innerHTML = `
      <div class="jhead"><span>Нарушения: <b id="jcount">0</b></span><kbd>J</kbd></div>
      <div id="jlist"></div>`;
    document.getElementById('hud').appendChild(root);
    const limit = document.createElement('div');
    limit.id = 'limit';
    limit.innerHTML = '<span>50</span>';
    document.getElementById('panel').prepend(limit);
    this.el = { root, count: root.querySelector('#jcount'), list: root.querySelector('#jlist'), limit: limit.querySelector('span') };
    this.items = [];
    this.expanded = false;
    this.lastLimit = 50;
  }

  toggle() {
    this.expanded = !this.expanded;
    this.render();
  }

  clear() {
    this.items = [];
    this.render();
  }

  add(v) {
    this.items.push(v);
    this.render();
  }

  render() {
    this.el.count.textContent = this.items.length;
    const shown = this.expanded ? this.items : this.items.slice(-5);
    this.el.list.innerHTML = shown.slice().reverse().map((v) => `
      <div class="jitem ${v.severity}">
        <span class="jt">${fmtTime(v.time)}</span>
        <span class="jtext">${v.ru}${v.detail ? ` — ${v.detail}` : ''}<i>${v.pl}</i></span>
      </div>`).join('');
    this.el.root.classList.toggle('empty', this.items.length === 0);
  }

  setLimit(kmh) {
    if (kmh === this.lastLimit) return;
    this.lastLimit = kmh;
    this.el.limit.textContent = kmh;
  }
}
