// Ways to feed the student's function: on-screen joystick pads, gamepad, keyboard and scripted test runs.
// Every source answers getInput() -> { x, y, r } with whole numbers from -100 to +100.
// x = right (+), y = forward (+), r = rotate CLOCKWISE (+).
import { el } from '../dom.js';

const clamp100 = (v) => Math.max(-100, Math.min(100, Math.round(v)));

/* ---------- on-screen joystick pad ---------- */
/**
 * A big round pad. axes = 'xy' (both directions) or 'x' (horizontal only, used for rotation).
 * Springs back to the centre when released.
 */
export function createPad({ title, axes = 'xy', names = ['x', 'y'] }) {
  const knob = el('div', { class: 'pad-knob' });
  const base = el('div', { class: 'pad-base' + (axes === 'x' ? ' pad-slot' : '') }, knob);
  const readout = el('div', { class: 'pad-read', text: '' });
  const root = el('div', { class: 'pad' }, el('div', { class: 'pad-title', text: title }), base, readout);
  const value = { x: 0, y: 0 };
  let activePointer = null;

  function show() {
    const half = base.clientWidth / 2 - knob.clientWidth / 2;
    knob.style.transform = `translate(${(value.x / 100) * half}px, ${(-value.y / 100) * half}px)`;
    readout.textContent = axes === 'x' ? `${names[0]} ${value.x}` : `${names[0]} ${value.x}   ${names[1]} ${value.y}`;
  }

  function move(event) {
    const rect = base.getBoundingClientRect();
    const half = rect.width / 2;
    let dx = (event.clientX - (rect.left + half)) / half;
    let dy = (event.clientY - (rect.top + half)) / half;
    if (axes === 'x') dy = 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; } // stay inside the circle
    value.x = clamp100(dx * 100);
    value.y = clamp100(-dy * 100);
    show();
  }

  base.addEventListener('pointerdown', (e) => {
    activePointer = e.pointerId;
    base.setPointerCapture(e.pointerId);
    move(e);
  });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === activePointer) move(e); });
  const release = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    value.x = 0; value.y = 0; // spring back
    show();
  };
  base.addEventListener('pointerup', release);
  base.addEventListener('pointercancel', release);
  base.style.touchAction = 'none';

  show();
  return { root, value, refresh: show };
}

/* ---------- keyboard ---------- */
const KEY_VALUES = {
  w: ['y', 100], s: ['y', -100], d: ['x', 100], a: ['x', -100], e: ['r', 100], q: ['r', -100],
};

export function createKeyboard() {
  const down = new Set();
  const typing = (target) => target instanceof Element && target.closest('.cm-editor, input, select, textarea');
  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (KEY_VALUES[k]) { down.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => down.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => down.clear());
  return {
    getInput() {
      const v = { x: 0, y: 0, r: 0 };
      for (const k of down) { const [axis, amount] = KEY_VALUES[k]; v[axis] += amount; }
      return { x: clamp100(v.x), y: clamp100(v.y), r: clamp100(v.r) };
    },
  };
}

/* ---------- gamepad ---------- */
// No deadzone here on purpose: removing the little stick drift is the student's job.
export function createGamepad() {
  const find = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  };
  return {
    find,
    getInput() {
      const p = find();
      if (!p) return { x: 0, y: 0, r: 0 };
      const axis = (i) => p.axes[i] || 0;
      return {
        x: clamp100(axis(0) * 100),
        y: clamp100(-axis(1) * 100), // "up" reads negative on a gamepad, so flip it
        r: clamp100(axis(2) * 100),  // right stick, horizontal
      };
    },
  };
}

/* ---------- test scripts ---------- */
// Each step lasts `t` seconds. Same inputs every time, so every student sees the same run.
export const TEST_SCRIPTS = [
  {
    name: 'Forward, right, diagonal',
    steps: [
      { t: 1, x: 0, y: 100, r: 0 }, { t: 0.5, x: 0, y: 0, r: 0 },
      { t: 1, x: 100, y: 0, r: 0 }, { t: 0.5, x: 0, y: 0, r: 0 },
      { t: 1, x: 100, y: 100, r: 0 }, { t: 0.5, x: 0, y: 0, r: 0 },
    ],
  },
  {
    name: 'Square dance',
    steps: [
      { t: 1, x: 0, y: 100, r: 0 }, { t: 1, x: 100, y: 0, r: 0 },
      { t: 1, x: 0, y: -100, r: 0 }, { t: 1, x: -100, y: 0, r: 0 },
      { t: 1, x: 0, y: 0, r: 100 }, { t: 0.5, x: 0, y: 0, r: 0 },
    ],
  },
  {
    name: 'Gentle stick (deadzone test)',
    steps: [
      { t: 1, x: 0, y: 4, r: 0 }, { t: 1, x: 3, y: 6, r: 0 }, { t: 1, x: 0, y: 12, r: 0 },
      { t: 1, x: 0, y: 25, r: 0 }, { t: 1, x: 0, y: 50, r: 0 }, { t: 1, x: 0, y: 100, r: 0 },
      { t: 0.5, x: 0, y: 0, r: 0 },
    ],
  },
];

export function createScriptPlayer() {
  let script = TEST_SCRIPTS[0];
  let startedAt = null;
  const total = () => script.steps.reduce((sum, s) => sum + s.t, 0);
  return {
    select(index) { script = TEST_SCRIPTS[index]; startedAt = null; },
    start(now = performance.now()) { startedAt = now; },
    stop() { startedAt = null; },
    get playing() { return startedAt !== null; },
    /** Returns the input at time `now`; when the script ends it stops by itself. */
    getInput(now = performance.now()) {
      if (startedAt === null) return { x: 0, y: 0, r: 0 };
      let t = (now - startedAt) / 1000;
      if (t >= total()) { startedAt = null; return { x: 0, y: 0, r: 0 }; }
      for (const s of script.steps) {
        if (t < s.t) return { x: s.x, y: s.y, r: s.r };
        t -= s.t;
      }
      return { x: 0, y: 0, r: 0 };
    },
  };
}
