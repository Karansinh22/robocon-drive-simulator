// Live graph: the last 10 seconds of inputs and wheel outputs, drawn on a canvas.
const WINDOW_S = 10;

// Inputs are drawn dark and thin, outputs in bright colours. (Orange is kept for wheel arrows in the 3D view.)
const SERIES_STYLE = {
  x: { color: '#0f2747', label: 'x' }, y: { color: '#64748b', label: 'y' }, r: { color: '#7c3aed', label: 'r' },
  FL: { color: '#1d4ed8', label: 'FL' }, FR: { color: '#0891b2', label: 'FR' },
  RL: { color: '#16a34a', label: 'RL' }, RR: { color: '#db2777', label: 'RR' },
  left: { color: '#1d4ed8', label: 'left' }, right: { color: '#16a34a', label: 'right' },
};

export class LiveGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.samples = [];
    this.outputNames = ['FL', 'FR', 'RL', 'RR'];
    this.showRaw = false;       // also draw the input before the student's deadzone (dashed)
    this.deadzone = 0;          // PARAMS["deadzone"], if the student has one
  }

  setOutputs(names) { this.outputNames = names; }

  clear() { this.samples = []; }

  /** input = {x,y,r} as the stick gave it; out = array of outputs in -255..255 */
  push(input, out, now = performance.now() / 1000) {
    this.samples.push({ t: now, input, out });
    const cutoff = now - WINDOW_S - 1;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
  }

  draw(now = performance.now() / 1000) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const left = 56, right = 12, top = 34, bottom = 28;
    const pw = w - left - right, ph = h - top - bottom;
    const X = (t) => left + ((t - (now - WINDOW_S)) / WINDOW_S) * pw;
    const Y = (v) => top + (1 - (v + 1) / 2) * ph; // v in -1..+1

    // grid
    g.font = '16px system-ui, sans-serif';
    g.fillStyle = '#0f2747';
    g.strokeStyle = '#d6e2f5';
    g.lineWidth = 1;
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      g.beginPath(); g.moveTo(left, Y(v)); g.lineTo(left + pw, Y(v)); g.stroke();
    }
    g.textAlign = 'right';
    g.fillText('+100', left - 6, Y(1) + 5);
    g.fillText('0', left - 6, Y(0) + 5);
    g.fillText('−100', left - 6, Y(-1) + 5);
    g.textAlign = 'center';
    for (let s = 0; s <= WINDOW_S; s += 2) g.fillText(`${s - WINDOW_S}s`, X(now - WINDOW_S + s), h - 6);
    g.strokeStyle = '#9db4d8'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(left, Y(0)); g.lineTo(left + pw, Y(0)); g.stroke();

    const line = (getter, color, width, dash = []) => {
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
      g.beginPath();
      let started = false;
      for (const s of this.samples) {
        if (s.t < now - WINDOW_S) continue;
        const px = X(s.t), py = Y(getter(s));
        if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
      }
      g.stroke();
      g.setLineDash([]);
    };

    const dz = this.deadzone;
    const afterDeadzone = (v) => (Math.abs(v) < dz ? 0 : v);
    const hasDz = dz > 0;
    const inputKeys = this.outputNames.length === 2 ? ['x', 'y'] : ['x', 'y', 'r'];

    // inputs (what the student's code receives is the raw stick; the thin solid line shows it after the deadzone)
    for (const k of inputKeys) {
      if (this.showRaw && hasDz) line((s) => s.input[k] / 100, SERIES_STYLE[k].color, 1.5, [5, 4]);
      line((s) => (hasDz ? afterDeadzone(s.input[k]) : s.input[k]) / 100, SERIES_STYLE[k].color, 2);
    }
    // outputs
    this.outputNames.forEach((name, i) => line((s) => (s.out[i] ?? 0) / 255, SERIES_STYLE[name].color, 3.5));

    // legend
    g.textAlign = 'left';
    let lx = left;
    const legend = [...inputKeys.map((k) => ({ ...SERIES_STYLE[k], label: `${k} in` })), ...this.outputNames.map((n) => SERIES_STYLE[n])];
    for (const item of legend) {
      g.fillStyle = item.color; g.fillRect(lx, 8, 16, 6);
      g.fillStyle = '#0f2747'; g.fillText(item.label, lx + 22, 16);
      lx += 28 + g.measureText(item.label).width + 10;
    }
  }
}
