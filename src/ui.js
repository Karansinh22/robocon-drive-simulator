// Control panel, presets, readouts, keyboard shortcuts and challenge mode.
// This file only touches the DOM and the shared `state` object – no Three.js.
import { WHEELS, DRIVES, DRIVE_NAMES, signedSpeed, directionOf, isLeftWheel, canMoveSideways } from './kinematics.js';
import { CHALLENGES, checkChallenge } from './challenges.js';

/* ---------- tiny DOM helper ---------- */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

/* ---------- content ---------- */
const PRESETS = [
  { label: 'Forward', speeds: [1, 1, 1, 1] },
  { label: 'Backward', speeds: [-1, -1, -1, -1] },
  { label: 'Slide left', speeds: [-1, 1, 1, -1], sideways: true },
  { label: 'Slide right', speeds: [1, -1, -1, 1], sideways: true },
  { label: 'Rotate CW', speeds: [1, -1, 1, -1] },
  { label: 'Rotate CCW', speeds: [-1, 1, -1, 1] },
  { label: 'Diagonal ↗', speeds: [1, 0, 0, 1], sideways: true },
  { label: 'Curve left', speeds: [0.4, 1, 0.4, 1] },
];

const HOW = {
  skid: {
    text: [
      'A skid steer robot has four normal wheels, two on each side. The wheels cannot turn sideways.',
      'To drive forward, the left wheels spin CCW and the right wheels spin CW (seen from outside).',
      'To turn, make one side faster than the other, or spin the two sides in opposite directions.',
      'If the front and rear wheel on the same side disagree, they fight each other: the tyres skid and power is wasted.',
      'Skid steer can never slide sideways.',
    ],
    formula: 'vl = (FL + RL) / 2     vr = (FR + RR) / 2\nvy = (vl + vr) / 2     vx = 0\nomega = (vr − vl) / (2·Lx)',
  },
  mecanum: {
    text: [
      'A mecanum wheel has small rollers set at 45°. Seen from above, the rollers of the four wheels form an X.',
      'Each wheel pushes the robot along its rollers, so every wheel pushes at 45°, not straight ahead.',
      'All four wheels forward: the sideways pushes cancel and the robot goes forward.',
      'Flip FR and RL: the forward pushes cancel and the sideways pushes add up, so the robot slides right.',
      'Spinning the left wheels against the right wheels makes the robot rotate.',
    ],
    formula: 'vy = (FL + FR + RL + RR) / 4\nvx = (FL − FR − RL + RR) / 4\nomega = (−FL + FR − RL + RR) / (4·(Lx + Ly))',
  },
  omni: {
    text: [
      'An omni wheel has rollers at 90° to the wheel, so it drives forward but slides freely sideways.',
      'In Omni X the four wheels sit on the corners, each turned 45°, so their axles form an X from above.',
      'Each wheel pushes the robot at 45° – just like mecanum – and slides freely along the other 45° line.',
      'So the same wheel patterns give the same motions as mecanum: forward, slide, rotate, diagonal.',
      'Because each wheel is on a corner, the robot can turn and slide without any skidding.',
    ],
    formula: 'R = √(Lx² + Ly²)\nvy = (√2/4)·(FL + FR + RL + RR)\nvx = (√2/4)·(FL − FR − RL + RR)\nomega = (−FL + FR − RL + RR) / (4·R)',
  },
};

const KEYS = {
  q: ['FL', 'CCW'], a: ['FL', 'CW'],
  w: ['FR', 'CCW'], s: ['FR', 'CW'],
  e: ['RL', 'CCW'], d: ['RL', 'CW'],
  r: ['RR', 'CCW'], f: ['RR', 'CW'],
};

const fmt = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

/* ---------- the UI ---------- */
/**
 * state: shared object owned by main.js.
 * api:   { changed(), driveChanged(), reset(), setCamera(name), setGhost(target|null) }
 */
export function createUI(state, api) {
  const $ = (id) => document.getElementById(id);
  const wheelEls = {};
  const driveBtns = {};
  const presetBtns = [];
  let result = null;

  /* ---- state changes ---- */
  function setWheel(wheel, dir, pct) {
    state.wheels[wheel].dir = dir;
    if (pct !== undefined) state.wheels[wheel].pct = pct;
    api.changed();
  }

  function setDrive(drive) {
    state.drive = drive;
    api.driveChanged();
    api.changed();
  }

  function applyPreset(speeds) {
    WHEELS.forEach((w, i) => {
      const s = speeds[i];
      state.wheels[w].dir = directionOf(w, s);
      if (s !== 0) state.wheels[w].pct = Math.round(Math.abs(s) * 100);
    });
    api.changed();
  }

  function setPaused(paused) {
    state.paused = paused;
    api.changed();
  }

  /* ---- 3D overlay: readout ---- */
  const readout = $('readout');
  const nameEl = el('div', { class: 'name' });
  const numsEl = el('div', { class: 'nums' });
  const warnEl = el('div', { class: 'warn', hidden: '' });
  readout.append(nameEl, numsEl, warnEl);

  /* ---- 3D overlay: camera buttons ---- */
  const camButtons = {};
  for (const [id, label] of [['top', 'Top view'], ['three', '3/4 view'], ['side', 'Side view']]) {
    const b = el('button', { class: 'btn', text: label, onclick: () => { api.setCamera(id); markCam(id); } });
    camButtons[id] = b;
    $('camBar').append(b);
  }
  function markCam(id) {
    for (const [k, b] of Object.entries(camButtons)) b.setAttribute('aria-pressed', String(k === id));
  }
  markCam('top');

  /* ---- 3D overlay: bottom bar ---- */
  const toggleRow = el('div', { class: 'barrow' });
  const controlRow = el('div', { class: 'barrow' });
  $('bottomBar').append(toggleRow, controlRow);
  const toggles = {};
  for (const [key, label] of [['showForces', 'Show wheel forces'], ['showMotion', 'Show motion'], ['showTrail', 'Show trail']]) {
    const b = el('button', {
      class: 'btn', text: label, 'aria-pressed': String(state[key]),
      onclick: () => { state[key] = !state[key]; b.setAttribute('aria-pressed', String(state[key])); api.changed(); },
    });
    toggles[key] = b;
    toggleRow.append(b);
  }

  const playBtn = el('button', { class: 'btn solid', onclick: () => setPaused(!state.paused) });
  const resetBtn = el('button', { class: 'btn', text: '↺ Reset robot', onclick: () => api.reset() });
  controlRow.append(playBtn, resetBtn);

  const speedBtns = [];
  for (const m of [0.25, 0.5, 1, 1.5, 2]) {
    const b = el('button', {
      class: 'btn', text: `${m}×`,
      onclick: () => { state.simSpeed = m; api.changed(); },
    });
    b.dataset.m = m;
    speedBtns.push(b);
    controlRow.append(b);
  }

  /* ---- side panel ---- */
  const panel = $('panel');

  // Tabs
  const tabExplore = el('button', { class: 'btn', text: 'Explore', onclick: () => setMode('explore') });
  const tabChallenge = el('button', { class: 'btn', text: 'Challenge', onclick: () => setMode('challenge') });
  panel.append(el('div', { class: 'row tabs' }, tabExplore, tabChallenge));

  // Drive selector
  for (const d of DRIVES) {
    driveBtns[d] = el('button', { class: 'btn', text: DRIVE_NAMES[d], onclick: () => setDrive(d) });
  }
  panel.append(el('div', { class: 'row' }, DRIVES.map((d) => driveBtns[d])));

  // Hint (explore) and challenge box
  const hintEl = el('div', { class: 'hint', text: 'Try: all four wheels forward. Then flip FR and RL.' });
  panel.append(hintEl);

  const chTarget = el('div', { class: 'target' });
  const chFeedback = el('div', { class: 'feedback' });
  const chScore = el('div', { class: 'score' });
  const chCount = el('div', { text: '' });
  const chCheck = el('button', { class: 'btn solid', text: '✓ Check', onclick: () => checkNow() });
  const chNext = el('button', { class: 'btn', text: 'Next ▶', onclick: () => nextChallenge() });
  const challengeBox = el('div', { class: 'card challenge', hidden: '' },
    el('div', { class: 'top' }, chCount, chScore),
    chTarget,
    el('div', { class: 'row' }, chCheck, chNext),
    chFeedback);
  panel.append(challengeBox);

  // Wheel cards: FL FR on top, RL RR below – like the robot seen from above.
  const wheelsBox = el('div', { class: 'wheels' });
  for (const w of WHEELS) {
    const fwd = isLeftWheel(w) ? 'CCW' : 'CW';
    const dirBtns = {
      CCW: el('button', { class: 'btn', text: '⟲ CCW', onclick: () => setWheel(w, 'CCW') }),
      STOP: el('button', { class: 'btn stop', text: '■ Stop', onclick: () => setWheel(w, 'STOP') }),
      CW: el('button', { class: 'btn', text: '⟳ CW', onclick: () => setWheel(w, 'CW') }),
    };
    const slider = el('input', {
      type: 'range', min: '0', max: '100', step: '5', value: '100', 'aria-label': `${w} speed`,
      oninput: (e) => setWheel(w, state.wheels[w].dir, Number(e.target.value)),
    });
    const live = el('div', { class: 'live' });
    const pctLabel = el('span', { text: '100 %' });
    const card = el('div', { class: 'wheel' },
      el('header', {}, el('span', { class: 'wname', text: w }), el('span', { class: 'map', text: `${fwd} = forward` })),
      el('div', { class: 'dirs' }, dirBtns.CCW, dirBtns.STOP, dirBtns.CW),
      el('label', { class: 'slider' }, 'Speed ', pctLabel, slider),
      live);
    wheelEls[w] = { dirBtns, slider, live, pctLabel };
    wheelsBox.append(card);
  }
  panel.append(wheelsBox);

  // Presets
  const presetsBox = el('div', { class: 'card presets' }, el('h2', { text: 'Presets' }));
  const presetRow = el('div', { class: 'row' });
  for (const p of PRESETS) {
    const b = el('button', { class: 'btn', text: p.label, onclick: () => applyPreset(p.speeds) });
    presetBtns.push({ btn: b, preset: p });
    presetRow.append(b);
  }
  presetsBox.append(presetRow);
  panel.append(presetsBox);

  // How it works
  const howBox = el('details', { class: 'how' });
  panel.append(howBox);

  /* ---- mode: explore / challenge ---- */
  let challengeIndex = 0, attempts = 0, correct = 0, solved = false;

  function setMode(mode) {
    state.mode = mode;
    const challenge = mode === 'challenge';
    tabExplore.setAttribute('aria-pressed', String(!challenge));
    tabChallenge.setAttribute('aria-pressed', String(challenge));
    challengeBox.hidden = !challenge;
    hintEl.hidden = challenge || !state.showHint;
    presetsBox.hidden = challenge;
    if (challenge) showChallenge();
    else api.setGhost(null);
    api.changed();
  }

  function showChallenge() {
    const c = CHALLENGES[challengeIndex];
    solved = false;
    chCount.textContent = `Challenge ${challengeIndex + 1} of ${CHALLENGES.length}`;
    chTarget.textContent = c.text;
    chFeedback.textContent = 'Set the wheels, then press Check.';
    chFeedback.className = 'feedback';
    chNext.textContent = 'Skip ▶';
    chScore.textContent = `Score: ${correct} / ${attempts}`;
    if (state.drive !== c.drive) {
      state.drive = c.drive;
      api.driveChanged();
    }
    for (const w of WHEELS) state.wheels[w].dir = 'STOP';
    api.setGhost(c.target);
    api.changed();
  }

  function nextChallenge() {
    challengeIndex = (challengeIndex + 1) % CHALLENGES.length;
    showChallenge();
  }

  function currentSpeeds() {
    const speeds = {};
    for (const w of WHEELS) speeds[w] = signedSpeed(w, state.wheels[w].dir, state.wheels[w].pct);
    return speeds;
  }

  function checkNow() {
    if (solved) return;
    const c = CHALLENGES[challengeIndex];
    const r = checkChallenge(c, state.drive, currentSpeeds());
    attempts += 1;
    if (r.ok) { correct += 1; solved = true; chNext.textContent = 'Next ▶'; }
    chFeedback.textContent = r.message;
    chFeedback.className = 'feedback' + (r.ok ? ' ok' : '');
    chScore.textContent = `Score: ${correct} / ${attempts}`;
  }

  /* ---- refresh everything from state + result ---- */
  function refresh(res) {
    result = res;
    nameEl.textContent = res.name;
    numsEl.replaceChildren(
      ...[['vx', `${fmt(res.vx)} m/s`], ['vy', `${fmt(res.vy)} m/s`], ['ω', `${fmt(res.omegaDegPerSec, 0)} °/s`], ['Heading', `${res.headingDeg.toFixed(0)}°`]]
        .map(([k, v]) => el('span', {}, `${k} `, el('b', { text: v }))));
    warnEl.hidden = !res.fighting;
    warnEl.textContent = res.fighting ? `⚠ ${res.warning}` : '';

    for (const d of DRIVES) driveBtns[d].setAttribute('aria-pressed', String(state.drive === d));
    for (const { btn, preset } of presetBtns) {
      const blocked = preset.sideways && !canMoveSideways(state.drive);
      btn.disabled = blocked;
      btn.title = blocked ? "Skid steer can't move sideways" : '';
    }

    for (const w of WHEELS) {
      const { dir, pct } = state.wheels[w];
      const e = wheelEls[w];
      for (const [k, b] of Object.entries(e.dirBtns)) b.classList.toggle('on', dir === k);
      e.slider.value = String(pct);
      e.pctLabel.textContent = `${pct} %`;
      const s = signedSpeed(w, dir, pct);
      if (dir === 'STOP') e.live.textContent = `${w}: Stop → 0.00`;
      else e.live.textContent = `${w}: ${dir} ${pct} % → ${fmt(s)} (${s >= 0 ? 'forward' : 'backward'})`;
    }

    playBtn.textContent = state.paused ? '▶ Play' : '⏸ Pause';
    for (const b of speedBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.m) === state.simSpeed));
    for (const [k, b] of Object.entries(toggles)) b.setAttribute('aria-pressed', String(state[k]));

    const how = HOW[state.drive];
    if (howBox.dataset.drive !== state.drive) {
      const open = howBox.open;
      howBox.dataset.drive = state.drive;
      howBox.replaceChildren(
        el('summary', { text: `How it works – ${DRIVE_NAMES[state.drive]}` }),
        ...how.text.map((t) => el('p', { text: t })),
        el('div', { class: 'formula', text: how.formula }));
      howBox.open = open;
    }
  }

  /* ---- keyboard ---- */
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ') { e.preventDefault(); setPaused(!state.paused); }
    else if (key === 'x') api.reset();
    else if (key === '1' || key === '2' || key === '3') setDrive(['skid', 'mecanum', 'omni'][Number(key) - 1]);
    else if (KEYS[key]) { const [w, dir] = KEYS[key]; setWheel(w, dir); }
  });

  // Initial look
  state.showHint = true;
  setMode('explore');
  return { refresh, hideHint() { state.showHint = false; hintEl.hidden = true; } };
}
