// Code Lab UI: top bar, editor, tabs (console / tests / graph / tuning), inputs and wiring to the runner.
import { el } from '../dom.js';
import { DRIVE_SPECS, Runner, runTableTests, runBehaviourTest, BEHAVIOUR_TESTS, zeroSpeeds } from './runner.js';
import { WorkerClient } from './client.js';
import { createEditor } from './editor.js';
import { EXAMPLES, DEFAULT_EXAMPLE, exampleById } from './examples.js';
import { createPad, createKeyboard, createGamepad, createScriptPlayer, TEST_SCRIPTS } from './inputs.js';
import { LiveGraph } from './graph.js';
import { loadSaved, saveCode, backupCode, buildShareLink, parseShareHash, loadLang, saveLang } from './share.js';

const MAX_CONSOLE_LINES = 200;
const LANGS = [['python', 'Python'], ['cpp', 'C++']];
const LANG_LABEL = { python: 'Python', cpp: 'C++' };
const SOURCES = [['joystick', 'On-screen joystick'], ['gamepad', 'Gamepad'], ['keyboard', 'Keyboard'], ['script', 'Test script']];
const fmt = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

export function createCodeLab(sim) {
  const $ = (id) => document.getElementById(id);
  const shared = parseShareHash(location.hash);
  const S = {
    drive: 'mecanum',
    lang: shared ? shared.lang : loadLang(),   // 'python' | 'cpp'
    source: 'joystick',
    exampleId: null,        // the example last loaded (for "Restore example")
    runCode: null,          // the code that is running right now
    paramValues: {},        // slider values, kept while tests reload the module
    params: {},             // { key: { value, isInt } } from the last load
    testing: false,
    lastSample: null,
  };

  /* ================= language workers + runner ================= */
  const loadBar = $('loadBar');
  let creep = null;
  function showLoading(text) {
    loadBar.hidden = false;
    loadBar.replaceChildren(text, el('div', { class: 'track' }, el('div', { class: 'fill' })));
    const fill = loadBar.querySelector('.fill');
    const t0 = performance.now();
    clearInterval(creep);
    fill.style.width = '6%';
    // Pyodide gives no byte count, so the bar eases towards 95% and jumps to 100% when Python is ready.
    creep = setInterval(() => { fill.style.width = `${6 + 89 * (1 - Math.exp(-(performance.now() - t0) / 9000))}%`; }, 250);
  }
  function hideLoading() {
    clearInterval(creep);
    const fill = loadBar.querySelector('.fill');
    if (fill) fill.style.width = '100%';
    setTimeout(() => { loadBar.hidden = true; }, 400);
  }

  // One worker per language, created the first time it is needed. Python downloads Pyodide (about 10 MB);
  // the C++ interpreter is small and ready at once.
  const clients = { python: null, cpp: null };
  const printLines = (lines) => { for (const l of lines) log('print', l); };
  function getClient(lang) {
    if (clients[lang]) return clients[lang];
    if (lang === 'python') {
      clients.python = new WorkerClient(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }), {
        onReady() { hideLoading(); if (S.lang === 'python') setStatus('Python ready', ''); },
        onInitError(text) {
          clearInterval(creep);
          loadBar.hidden = false;
          loadBar.textContent = `Could not load Python: ${text}. Check the internet connection and reload the page.`;
          setStatus('Python failed to load', 'error');
        },
        onPrint: printLines,
        onRestart() { showLoading('Restarting Python…'); setStatus('Restarting Python…', ''); },
      });
      showLoading('Loading Python… (first time only)');
    } else {
      clients.cpp = new WorkerClient(() => new Worker(new URL('./cpp-worker.js', import.meta.url), { type: 'module' }), {
        onReady() { if (S.lang === 'cpp') setStatus('C++ ready', ''); },
        onPrint: printLines,
        onRestart() { if (S.lang === 'cpp') setStatus('Restarting C++…', ''); },
      });
    }
    return clients[lang];
  }
  const activeClient = () => getClient(S.lang);

  const warned = new Set();
  const runner = new Runner({
    client: getClient(S.lang),
    getInput: () => currentInput(),
    on: {
      speeds(speeds) { sim.state.external = speeds; },
      status(s) { if (s === 'running') setStatus('Running', 'running'); else if (s === 'idle') setStatus('Stopped', ''); },
      warnings(list) {
        showWarning(list);
        for (const w of list) if (!warned.has(w)) { warned.add(w); log('warn', w); }
      },
      error(err) {
        log('error', err.message);
        showError(err);
        if (err.line) editor.showError(err.line);
        setStatus('Error — robot stopped', 'error');
        if (err.kind === 'timeout') switchTab('Console');
      },
      sample({ input, out }) {
        S.lastSample = { input, out };
        graph.push(input, out);
      },
    },
  });

  /* ================= top bar ================= */
  const chip = el('span', { class: 'chip', text: S.lang === 'cpp' ? 'C++ ready' : 'Loading Python…' });
  function setStatus(text, kind) { chip.textContent = text; chip.className = 'chip' + (kind ? ` ${kind}` : ''); }

  const driveBtns = {};
  for (const d of ['skid', 'mecanum', 'omni']) driveBtns[d] = el('button', { class: 'btn', text: DRIVE_SPECS[d].label, onclick: () => setDrive(d) });
  const langBtns = {};
  for (const [id, label] of LANGS) langBtns[id] = el('button', { class: 'btn', text: label, 'aria-label': `Write in ${label}`, onclick: () => setLang(id) });
  const sourceBtns = {};
  for (const [id, label] of SOURCES) sourceBtns[id] = el('button', { class: 'btn', text: label, onclick: () => setSource(id) });

  $('topbar').append(
    el('div', { class: 'tbrow' },
      el('span', { class: 'title', text: '⌨ Code Lab' }),
      el('a', { class: 'btn', href: './', text: '← Simulator' }),
      el('span', { class: 'sep' }),
      el('div', { class: 'group' }, Object.values(driveBtns)),
      el('span', { class: 'sep' }),
      el('div', { class: 'group' }, Object.values(langBtns)),
      el('span', { class: 'grow' }),
      chip),
    el('div', { class: 'tbrow' }, el('div', { class: 'group' },
      el('button', { class: 'btn solid', text: 'Run ▶', onclick: () => run() }),
      el('button', { class: 'btn', text: 'Stop ■', onclick: () => stop() }),
      el('button', { class: 'btn', text: 'Reset robot', onclick: () => sim.reset() }),
      el('button', { class: 'btn', text: 'Reset state', onclick: () => resetState() })),
    el('span', { class: 'sep' }),
    el('div', { class: 'group' }, Object.values(sourceBtns))));

  /* ================= editor + toolbar ================= */
  const editor = createEditor($('editor'), {
    lang: S.lang,
    onChange(byStudent) {
      scheduleSave();
      if (byStudent && runner.running && editor.getCode() !== S.runCode) setStatus('Code changed — press Run ▶', 'running');
    },
  });

  const exampleSelect = el('select', {
    'aria-label': 'Load example',
    onchange: () => { const id = exampleSelect.value; exampleSelect.value = ''; if (id) loadExample(id); },
  });
  const fileInput = el('input', { type: 'file', accept: '.py,.cpp,.cc,.cxx,.c,.h,.ino,text/x-python,text/plain', hidden: '' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (file) {
      // The file name tells us the language; switch to it first so the code lands in the right place.
      const wanted = /\.(cpp|cc|cxx|c|h|ino)$/i.test(file.name) ? 'cpp' : /\.py$/i.test(file.name) ? 'python' : S.lang;
      if (wanted !== S.lang) setLang(wanted);
      editor.setCode(await file.text());
      hideExercise();
      log('info', `Opened ${file.name}`);
    }
    fileInput.value = '';
  });

  $('editorBar').append(
    exampleSelect,
    el('button', { class: 'btn', text: '↺ Restore example', onclick: () => loadExample(S.exampleId || DEFAULT_EXAMPLE[S.lang][S.drive]) }),
    el('button', { class: 'btn', text: '⬇ Download', onclick: downloadFile }),
    el('button', { class: 'btn', text: '📂 Open file', onclick: () => fileInput.click() }),
    el('button', { class: 'btn', text: '🔗 Copy share link', onclick: copyShareLink }),
    el('button', { class: 'btn', 'aria-label': 'Smaller text', text: 'A−', onclick: () => editor.changeFont(-2) }),
    el('button', { class: 'btn', 'aria-label': 'Bigger text', text: 'A+', onclick: () => editor.changeFont(2) }),
    fileInput);

  function fillExamples() {
    exampleSelect.replaceChildren(el('option', { value: '', text: 'Load example…' }));
    for (const ex of EXAMPLES.filter((e) => e.drive === S.drive && e.lang === S.lang)) exampleSelect.append(el('option', { value: ex.id, text: ex.title }));
    exampleSelect.value = '';
  }

  const exerciseBox = $('exerciseBox');
  function hideExercise() { exerciseBox.hidden = true; }
  function showExercise(ex) {
    let step = 0; // 0 = nothing revealed, 1 = hint shown, 2 = answer shown
    const reveal = el('div', { class: 'ex-reveal' });
    const button = el('button', { class: 'btn', text: '💡 Show hint' });
    button.addEventListener('click', () => {
      step += 1;
      if (step === 1) { reveal.textContent = `Hint: ${ex.hint}`; button.textContent = 'Show answer'; }
      else { reveal.textContent = `Answer: ${ex.answer}`; button.hidden = true; }
    });
    exerciseBox.replaceChildren(el('div', { class: 'ex-title', text: ex.title }), el('div', { text: ex.task }), reveal, button);
    exerciseBox.hidden = false;
  }

  function loadExample(id) {
    const ex = exampleById(id);
    if (!ex) return;
    S.exampleId = id;
    editor.setCode(ex.code);
    if (ex.bug) showExercise(ex); else hideExercise();
    clearError();
    log('info', `Loaded: ${ex.title}`);
  }

  function downloadFile() {
    const ext = S.lang === 'cpp' ? 'cpp' : 'py';
    const blob = new Blob([editor.getCode()], { type: 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${DRIVE_SPECS[S.drive].fn}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function copyShareLink() {
    const link = buildShareLink(location.origin + location.pathname, editor.getCode(), S.drive, S.lang);
    try {
      await navigator.clipboard.writeText(link);
      log('info', 'Share link copied. Opening it loads this code (without running it).');
    } catch {
      window.prompt('Copy this share link:', link);
    }
    switchTab('Console');
  }

  /* autosave per drive type */
  let saveTimer = null;
  const saveNow = () => { const code = editor.getCode(); if (code.trim()) saveCode(S.drive, code, S.lang); };
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  /* ================= banners ================= */
  const errorBanner = $('errorBanner');
  const warnBadge = $('warnBadge');
  function showError(err) {
    const lastLine = String(err.message).trim().split('\n').pop();
    errorBanner.textContent = err.kind === 'timeout' ? err.message : `${lastLine}${err.line ? `  (line ${err.line})` : ''}`;
    errorBanner.hidden = false;
  }
  function clearError() { errorBanner.hidden = true; editor.clearError(); }
  function showWarning(list) {
    warnBadge.hidden = list.length === 0;
    if (list.length) warnBadge.textContent = `⚠ ${list[0]}${list.length > 1 ? `   (+${list.length - 1} more)` : ''}`;
  }

  /* ================= bottom tabs ================= */
  const tabBody = $('tabBody');
  const tabNames = ['Console', 'Tests', 'Live graph', 'Tuning'];
  const panes = {};
  const tabBtns = {};
  for (const name of tabNames) {
    tabBtns[name] = el('button', { class: 'btn', text: name, onclick: () => switchTab(name) });
    panes[name] = el('div', { class: 'tabpane', hidden: '' });
    $('tabBar').append(tabBtns[name]);
    tabBody.append(panes[name]);
  }
  function switchTab(name) {
    for (const n of tabNames) { panes[n].hidden = n !== name; tabBtns[n].setAttribute('aria-pressed', String(n === name)); }
    if (name === 'Console') tabBody.scrollTop = tabBody.scrollHeight;
  }

  /* ---- console ---- */
  const consoleEl = el('div', { id: 'console' });
  const consoleBox = panes.Console;
  consoleBox.append(consoleEl);
  const emptyHint = el('div', { class: 'empty', text: 'print() output and errors appear here.' });
  consoleEl.append(emptyHint);
  function log(kind, text) {
    emptyHint.remove();
    const stick = tabBody.scrollHeight - tabBody.scrollTop - tabBody.clientHeight < 40;
    consoleEl.append(el('div', { class: `line ${kind}`, text }));
    while (consoleEl.childElementCount > MAX_CONSOLE_LINES) consoleEl.firstElementChild.remove(); // keep the last 200
    if (stick) tabBody.scrollTop = tabBody.scrollHeight;
  }

  /* ---- tests ---- */
  const testsBox = panes.Tests;
  const scoreEl = el('span', { class: 'score', text: '' });
  const testsOut = el('div');
  const runTestsBtn = el('button', { class: 'btn solid', text: 'Run tests ▶', onclick: () => runTests() });
  testsBox.append(el('div', { class: 'tests tests-head' }, runTestsBtn, scoreEl), testsOut);
  testsOut.append(el('div', { class: 'note', text: 'Tests call your function with fixed inputs and check the answers (±1). The robot on the screen does not move.' }));

  const cell = (v) => (v === null ? '—' : `[${v.join(', ')}]`);
  async function runTests() {
    if (S.testing) return;
    S.testing = true;
    runner.hold = true;
    runTestsBtn.disabled = true;
    scoreEl.textContent = 'Running…';
    const code = editor.getCode();
    const drive = S.drive;
    const callManyFn = (argsList) => activeClient().callMany(argsList);
    // Start the module fresh before every case, with the slider values the student has set.
    const reload = async () => {
      if (!(await runner.load(code, drive))) throw new Error('Your code has an error (see the Console)');
      await applyParams();
    };
    try {
      const rows = await runTableTests(drive, callManyFn, reload);
      const behaviour = [];
      for (const t of BEHAVIOUR_TESTS[drive]) behaviour.push(await runBehaviourTest(drive, t, callManyFn, reload));
      const passed = rows.filter((r) => r.pass).length + behaviour.filter((r) => r.pass).length;
      const total = rows.length + behaviour.length;
      scoreEl.textContent = `${passed} / ${total} passed`;
      testsOut.replaceChildren(
        el('table', { class: 'tests' },
          el('tr', {}, ['input', 'expected', 'got', 'pass'].map((h) => el('th', { text: h }))),
          rows.map((r) => el('tr', { class: r.pass ? 'pass' : 'fail' },
            el('td', { text: `(${r.input.join(', ')})` }), el('td', { text: cell(r.expected) }),
            el('td', {}, cell(r.got), r.note ? el('div', { class: 'note', text: r.note }) : null),
            el('td', { text: r.pass ? '✓' : '✗' })))),
        el('h3', { text: 'Robot behaviour (2 simulated seconds each)' }),
        el('table', { class: 'tests' },
          behaviour.map((r) => el('tr', { class: r.pass ? 'pass' : 'fail' },
            el('td', {}, r.name, el('div', { class: 'note', text: r.note })), el('td', { text: r.pass ? '✓' : '✗' })))));
    } catch (e) {
      scoreEl.textContent = '';
      testsOut.replaceChildren(el('div', { class: 'line error', text: String(e.message || e) }));
    } finally {
      // Put the running program back exactly as the student started it.
      if (runner.running && S.runCode !== null) { await runner.load(S.runCode, drive); await applyParams(); }
      runner.hold = false;
      S.testing = false;
      runTestsBtn.disabled = false;
    }
  }

  /* ---- live graph ---- */
  const graphBox = panes['Live graph'];
  const graphCanvas = el('canvas');
  const graph = new LiveGraph(graphCanvas);
  const rawToggle = el('input', { type: 'checkbox' });
  rawToggle.addEventListener('change', () => { graph.showRaw = rawToggle.checked; });
  graphBox.append(el('div', { class: 'graph-wrap' },
    el('label', {}, rawToggle, 'Show raw stick input before your deadzone (dashed)', el('span', { class: 'note', text: ' — inputs ±100 and outputs ±255 share the same height' })), graphCanvas));
  function graphLoop() {
    requestAnimationFrame(graphLoop);
    if (!graphBox.hidden) graph.draw();
  }
  graphLoop();

  /* ---- tuning ---- */
  const tuningBox = panes.Tuning;
  tuningBox.classList.add('tuning');
  function buildTuning() {
    const keys = Object.keys(S.params);
    if (!keys.length) {
      tuningBox.replaceChildren(S.lang === 'cpp'
        ? el('div', { class: 'empty' }, 'No PARAM variables found. Add ', el('code', { text: '#define PARAM' }), ' and a line like ', el('code', { text: 'PARAM int deadzone = 8;' }), ' to your code, press Run, and a slider appears for each number.')
        : el('div', { class: 'empty' }, 'No PARAMS found. Add a dictionary like ', el('code', { text: 'PARAMS = {"deadzone": 8}' }), ' to your code, press Run, and a slider appears for each number.'));
      return;
    }
    tuningBox.replaceChildren(...keys.map((key) => {
      const { value, isInt } = S.params[key];
      const max = isInt ? Math.max(10, value * 3) : Math.max(1.0, value * 3);
      const label = el('span', { class: 'pval', text: shown(value, isInt) });
      const slider = el('input', { type: 'range', min: '0', max: String(max), step: isInt ? '1' : '0.01', value: String(value), 'aria-label': key });
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        label.textContent = shown(v, isInt);
        S.paramValues[key] = { value: v, isInt };
        activeClient().setParam(key, v, isInt).catch(() => {});   // live: no re-run needed
        editor.setParamValue(key, v, isInt, S.lang);             // keep the text in the editor in sync
        if (key === 'deadzone') graph.deadzone = v;
      });
      return el('div', { class: 'param' }, el('span', { class: 'pname', text: key }), slider, label);
    }));
    if (S.params.deadzone) graph.deadzone = S.params.deadzone.value; else graph.deadzone = 0;
    S.paramValues = Object.fromEntries(keys.map((k) => [k, { ...S.params[k] }]));
  }
  const shown = (v, isInt) => (isInt ? String(Math.round(v)) : (Math.round(v * 100) / 100).toFixed(2));
  async function applyParams() {
    for (const [key, { value, isInt }] of Object.entries(S.paramValues)) {
      if (S.params[key]) await activeClient().setParam(key, value, isInt);
    }
  }

  /* ================= inputs ================= */
  const keyboard = createKeyboard();
  const gamepad = createGamepad();
  const script = createScriptPlayer();
  let padLeft = null, padRight = null;

  function currentInput() {
    switch (S.source) {
      case 'joystick': return { x: padLeft?.value.x ?? 0, y: padLeft?.value.y ?? 0, r: padRight?.value.x ?? 0 };
      case 'gamepad': return gamepad.getInput();
      case 'keyboard': return keyboard.getInput();
      default: return script.getInput();
    }
  }

  const dockLeft = $('padsLeft'), dockRight = $('padsRight');
  let dockTimer = null;
  function buildInputDock() {
    clearInterval(dockTimer);
    dockLeft.replaceChildren(); dockRight.replaceChildren();
    padLeft = padRight = null;
    if (S.source === 'joystick') {
      padLeft = createPad({ title: S.drive === 'skid' ? 'Drive' : 'Move', axes: 'xy', names: ['x', 'y'] });
      dockLeft.append(padLeft.root);
      if (S.drive !== 'skid') {
        padRight = createPad({ title: 'Rotate (right = clockwise)', axes: 'x', names: ['r', ''] });
        dockRight.append(padRight.root);
      }
      return;
    }
    const live = el('div', { class: 'live' });
    const card = el('div', { class: 'dock-card' });
    if (S.source === 'gamepad') {
      const status = el('div', { text: '' });
      card.append(status, live);
      const update = () => {
        const p = gamepad.find();
        status.textContent = p ? `🎮 ${p.id.slice(0, 40)}` : 'No gamepad found — press any button on it';
        const i = gamepad.getInput();
        live.textContent = `x ${i.x}   y ${i.y}   r ${i.r}`;
      };
      update();
      dockTimer = setInterval(update, 100);
    } else if (S.source === 'keyboard') {
      card.append(el('div', { text: 'W / S  forward / back' }), el('div', { text: 'A / D  left / right' }),
        el('div', { text: S.drive !== 'skid' ? 'Q / E  rotate (E = clockwise)' : 'Q / E  not used by mix(x, y)' }), live);
      dockTimer = setInterval(() => { const i = keyboard.getInput(); live.textContent = `x ${i.x}   y ${i.y}   r ${i.r}`; }, 100);
    } else {
      const select = el('select', { 'aria-label': 'Test script' }, TEST_SCRIPTS.map((s, i) => el('option', { value: String(i), text: s.name })));
      select.addEventListener('change', () => script.select(Number(select.value)));
      const go = el('button', { class: 'btn solid', text: '▶ Play script', onclick: async () => { if (!runner.running) await run(); script.select(Number(select.value)); script.start(); } });
      card.append(select, go, live);
      dockTimer = setInterval(() => { const i = script.getInput(); live.textContent = script.playing ? `x ${i.x}   y ${i.y}   r ${i.r}` : 'Press Play script (it also starts your code).'; }, 100);
    }
    dockLeft.append(card);
  }

  function setSource(id) {
    S.source = id;
    for (const [k, b] of Object.entries(sourceBtns)) b.setAttribute('aria-pressed', String(k === id));
    buildInputDock();
  }

  /* ================= 3D view overlays ================= */
  const readout = $('readout');
  const nameEl = el('div', { class: 'name', text: 'Not moving' });
  const numsEl = el('div', { class: 'nums' });
  const ioEl = el('div', { class: 'io' });
  readout.append(nameEl, numsEl, ioEl);
  let lastReadout = 0;
  sim.onFrame = (res) => {
    const now = performance.now();
    if (now - lastReadout < 100) return;
    lastReadout = now;
    nameEl.textContent = res.name;
    numsEl.replaceChildren(...[['vx', `${fmt(res.vx)} m/s`], ['vy', `${fmt(res.vy)} m/s`], ['ω', `${fmt(res.omegaDegPerSec, 0)} °/s`]]
      .map(([k, v]) => el('span', {}, `${k} `, el('b', { text: v }))));
    const i = currentInput();
    const out = S.lastSample && runner.running ? S.lastSample.out : null;
    ioEl.textContent = `in  x ${i.x} y ${i.y}${S.drive !== 'skid' ? ` r ${i.r}` : ''}\nout ${out ? `[${out.join(', ')}]` : '—'}`;
    ioEl.style.whiteSpace = 'pre';
  };

  const camButtons = {};
  for (const [id, label] of [['top', 'Top'], ['three', '3/4'], ['side', 'Side']]) {
    camButtons[id] = el('button', { class: 'btn', text: label, onclick: () => { sim.setCamera(id); for (const [k, b] of Object.entries(camButtons)) b.setAttribute('aria-pressed', String(k === id)); } });
    $('camBar').append(camButtons[id]);
  }
  camButtons.top.setAttribute('aria-pressed', 'true');
  for (const [key, label] of [['showForces', 'Wheel forces'], ['showMotion', 'Motion'], ['showTrail', 'Trail']]) {
    const b = el('button', { class: 'btn', text: label, 'aria-pressed': 'false', onclick: () => { sim.state[key] = !sim.state[key]; b.setAttribute('aria-pressed', String(sim.state[key])); } });
    $('viewToggles').append(b);
  }

  /* ================= actions ================= */
  async function run() {
    clearError();
    showWarning([]);
    warned.clear();
    graph.clear();
    S.runCode = editor.getCode();
    setStatus('Starting…', '');
    const ok = await runner.start(S.runCode, S.drive);
    if (ok) {
      S.params = runner.params;
      buildTuning();
      log('info', `Running ${DRIVE_SPECS[S.drive].fn}() at 20 Hz`);
    }
  }

  function stop() {
    runner.stop();
    script.stop();
    sim.state.external = zeroSpeeds();
    showWarning([]);
  }

  async function resetState() {
    clearError();
    const wasRunning = runner.running;
    const code = wasRunning ? S.runCode : editor.getCode();
    if (await runner.load(code, S.drive)) {
      S.params = runner.params;
      buildTuning();
      log('info', 'State reset: your module was run again from the top.');
      if (!wasRunning) setStatus('Code loaded OK', '');
    }
  }

  function setDrive(drive, { keepCode = false } = {}) {
    if (!keepCode && editor.getCode().trim()) saveCode(S.drive, editor.getCode(), S.lang);
    stop();
    S.drive = drive;
    S.params = {};
    S.paramValues = {};
    S.runCode = null;
    sim.state.drive = drive;
    sim.rebuildRobot();
    sim.reset();
    for (const [k, b] of Object.entries(driveBtns)) b.setAttribute('aria-pressed', String(k === drive));
    graph.setOutputs(DRIVE_SPECS[drive].outputs);
    graph.deadzone = 0;
    fillExamples();
    hideExercise();
    clearError();
    buildTuning();
    buildInputDock();
    if (!keepCode) {
      const saved = loadSaved(drive, S.lang);
      S.exampleId = DEFAULT_EXAMPLE[S.lang][drive];
      editor.setCode(saved && saved.trim() ? saved : exampleById(S.exampleId).code);
    }
  }

  function setLang(lang) {
    if (lang === S.lang) return;
    if (editor.getCode().trim()) saveCode(S.drive, editor.getCode(), S.lang);
    stop();
    S.lang = lang;
    saveLang(lang);
    runner.client = getClient(lang);
    S.params = {};
    S.paramValues = {};
    S.runCode = null;
    for (const [k, b] of Object.entries(langBtns)) b.setAttribute('aria-pressed', String(k === lang));
    editor.setLanguage(lang);
    fillExamples();
    hideExercise();
    clearError();
    showWarning([]);
    buildTuning();
    graph.deadzone = 0;
    const saved = loadSaved(S.drive, lang);
    S.exampleId = DEFAULT_EXAMPLE[lang][S.drive];
    editor.setCode(saved && saved.trim() ? saved : exampleById(S.exampleId).code);
    const ready = runner.client.isReady;
    setStatus(ready ? `${LANG_LABEL[lang]} ready` : `Loading ${LANG_LABEL[lang]}…`, '');
    log('info', `Switched to ${LANG_LABEL[lang]}`);
  }

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { stop(); setStatus('Stopped', ''); } });
  window.addEventListener('beforeunload', saveNow);

  /* ================= start ================= */
  buildTuning();
  switchTab('Console');
  setSource('joystick');
  for (const [k, b] of Object.entries(langBtns)) b.setAttribute('aria-pressed', String(k === S.lang));
  setDrive(shared ? shared.drive : 'mecanum');
  if (shared) {
    // Keep the student's own code safe before the shared code replaces it.
    backupCode(shared.drive, editor.getCode(), S.lang);
    editor.setCode(shared.code);
    log('info', 'Loaded code from a share link. Read it, then press Run ▶ to try it.');
  }
  return { clients, runner, editor };
}
