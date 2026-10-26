// The Code Lab brain: input -> student function -> validation -> wheel speeds.
// No DOM, no Three.js. Uses the same kinematics as the 3D robot.
//
// Conventions (what we teach in class):
//   inputs  x = right (+), y = forward (+), r = rotate CLOCKWISE (+), each -100..+100
//   outputs -255..+255 per wheel, + = "this wheel rolls the robot forward"
//   skid steer  mix(x, y)      -> (left, right)           left = FL + RL, right = FR + RR
//   mecanum     mix4(x, y, r)  -> [fl, fr, rl, rr]
import { analyse, stepPose } from '../kinematics.js';
import { TimeoutError } from './client.js';

export const OUT_MAX = 255;
export const SLOW_CALL_MS = 50;

export const DRIVE_SPECS = {
  skid: { fn: 'mix', args: ['x', 'y'], outputs: ['left', 'right'], label: 'Skid steer (mix)' },
  mecanum: { fn: 'mix4', args: ['x', 'y', 'r'], outputs: ['FL', 'FR', 'RL', 'RR'], label: 'Mecanum (mix4)' },
};

const ZERO = { FL: 0, FR: 0, RL: 0, RR: 0 };
export const zeroSpeeds = () => ({ ...ZERO });

/** Joystick input {x, y, r} -> argument list for the student's function. */
export function inputArgs(driveType, input) {
  return driveType === 'skid' ? [input.x, input.y] : [input.x, input.y, input.r];
}

const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/**
 * Check what the student's function returned.
 * raw: array from the worker. Numbers arrive as numbers; anything else (None, nan, 'abc') as its repr() text.
 * Returns { ok, values, warnings, error }. Values outside -255..255 are clamped, with a warning.
 */
export function validateOutput(driveType, raw) {
  const spec = DRIVE_SPECS[driveType];
  const need = spec.outputs.length;
  const shape = driveType === 'skid' ? '(left, right)' : '[fl, fr, rl, rr]';

  if (!Array.isArray(raw)) {
    return { ok: false, error: `${spec.fn}() returned ${raw ?? 'nothing'} — it must return ${shape}.` };
  }
  if (raw.length !== need) {
    return { ok: false, error: `${spec.fn}() returned ${raw.length} value${raw.length === 1 ? '' : 's'} — it must return ${need}: ${shape}.` };
  }
  const values = [];
  const warnings = [];
  for (let i = 0; i < need; i++) {
    const v = raw[i];
    const name = spec.outputs[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `${name} is ${v} — it must be a number.` };
    }
    if (Math.abs(v) > OUT_MAX) {
      const clamped = Math.sign(v) * OUT_MAX;
      warnings.push(`${name} was ${fmtNum(v)} — clamped to ${clamped}. Did you forget to scale?`);
      values.push(clamped);
    } else {
      values.push(v);
    }
  }
  return { ok: true, values, warnings };
}

/** Validated outputs (-255..255) -> the simulator's wheel speeds (-1..+1). */
export function toWheelSpeeds(driveType, values) {
  const k = 1 / OUT_MAX;
  if (driveType === 'skid') {
    const [left, right] = values;
    return { FL: left * k, RL: left * k, FR: right * k, RR: right * k };
  }
  const [fl, fr, rl, rr] = values;
  return { FL: fl * k, FR: fr * k, RL: rl * k, RR: rr * k };
}

/* ---------- the live control loop ---------- */

export class Runner {
  /**
   * client:   WorkerClient
   * getInput: () => {x, y, r}
   * on:       { speeds(speeds), warnings([text]), error({kind, message, line?, traceback?}),
   *             sample({input, out}), status('idle'|'running'|'error') }
   */
  constructor({ client, getInput, on, hz = 20, now = () => performance.now() }) {
    this.client = client;
    this.getInput = getInput;
    this.on = on;
    this.hz = hz;
    this.now = now;
    this.driveType = 'mecanum';
    this.timer = null;
    this.busy = false;
    this.hold = false; // true while tests run, so the loop does not touch the module state
    this.params = {};
  }

  get running() { return this.timer !== null; }

  /** Load the module and check the function. Returns true when the code is ready to run. */
  async load(code, driveType) {
    this.driveType = driveType;
    const spec = DRIVE_SPECS[driveType];
    let reply;
    try {
      reply = await this.client.load(code, spec.fn, spec.args.length, spec.args);
    } catch (e) {
      this._fail(e instanceof TimeoutError
        ? { kind: 'timeout', message: 'Your code took too long — is there an infinite loop?' }
        : { kind: 'python', message: String(e.message || e) });
      return false;
    }
    if (!reply.ok) {
      this._fail({ kind: 'python', message: reply.error.text, traceback: reply.error.text, line: reply.error.line });
      return false;
    }
    this.params = reply.params || {};
    return true;
  }

  async start(code, driveType) {
    this.stop(false);
    if (!(await this.load(code, driveType))) return false;
    this.on.status?.('running');
    this.timer = setInterval(() => this.tick(), 1000 / this.hz);
    return true;
  }

  stop(report = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.on.speeds?.(zeroSpeeds());
    if (report) this.on.status?.('idle');
  }

  _fail(error) {
    this.stop(false);
    this.on.error?.(error);
    this.on.status?.('error');
  }

  async tick() {
    if (this.busy || this.hold || !this.timer) return;
    this.busy = true;
    try {
      const input = this.getInput();
      let reply;
      try {
        reply = await this.client.call(inputArgs(this.driveType, input));
      } catch (e) {
        if (e instanceof TimeoutError) this._fail({ kind: 'timeout', message: 'Your code took too long — is there an infinite loop?' });
        else this._fail({ kind: 'python', message: String(e.message || e) });
        return;
      }
      if (!this.timer) return; // stopped while waiting
      if (!reply.ok) {
        this._fail({ kind: 'python', message: reply.traceback, traceback: reply.traceback, line: reply.line });
        return;
      }
      const checked = validateOutput(this.driveType, reply.notSequence !== undefined ? reply.notSequence : reply.value);
      if (!checked.ok) { this._fail({ kind: 'invalid', message: checked.error }); return; }

      const warnings = [...checked.warnings];
      if (reply.ms > SLOW_CALL_MS) warnings.push(`Your function took ${Math.round(reply.ms)} ms — keep it under ${SLOW_CALL_MS} ms.`);
      this.on.warnings?.(warnings);
      this.on.speeds?.(toWheelSpeeds(this.driveType, checked.values));
      this.on.sample?.({ input, out: checked.values });
    } finally {
      this.busy = false;
    }
  }
}

/* ---------- tests ---------- */

// Expected outputs for the table tests (tolerance +-1). The skid cases assume PARAMS["deadzone"] = 8.
export const TABLE_TESTS = {
  skid: [
    { input: [0, 100], expected: [255, 255] },
    { input: [100, 0], expected: [255, -255] },
    { input: [50, 100], expected: [255, 85] },
    { input: [-50, 100], expected: [85, 255] },
    { input: [5, -100], expected: [-255, -255] },
    { input: [0, 0], expected: [0, 0] },
  ],
  mecanum: [
    { input: [0, 100, 0], expected: [255, 255, 255, 255] },
    { input: [100, 0, 0], expected: [255, -255, -255, 255] },
    { input: [0, 0, 100], expected: [255, -255, 255, -255] },
    { input: [0, 100, 50], expected: [255, 85, 255, 85] },
    { input: [100, 100, 0], expected: [255, 0, 0, 255] },
    { input: [0, 0, 0], expected: [0, 0, 0, 0] },
  ],
};

export const TEST_TOLERANCE = 1;

// Each table row holds its input for a moment, so a student's ramp has time to reach full speed.
export const SETTLE_CALLS = 30;

/**
 * callManyFn(argsList) -> Promise of { results: [worker reply, ...] }. resetFn() starts the module fresh
 * (so one row cannot affect the next). Returns one row per case: { input, expected, got, pass, note }.
 */
export async function runTableTests(driveType, callManyFn, resetFn = async () => {}) {
  const rows = [];
  for (const t of TABLE_TESTS[driveType]) {
    const row = { input: t.input, expected: t.expected, got: null, pass: false, note: '' };
    try {
      await resetFn();
      const { results } = await callManyFn(Array(SETTLE_CALLS).fill(t.input));
      const reply = results[results.length - 1];
      if (!reply.ok) row.note = 'error: ' + lastLine(reply.traceback);
      else {
        const checked = validateOutput(driveType, reply.notSequence !== undefined ? reply.notSequence : reply.value);
        if (!checked.ok) row.note = checked.error;
        else {
          row.got = checked.values;
          if (checked.warnings.length) row.note = checked.warnings[0];
          row.pass = checked.values.every((v, i) => Math.abs(v - t.expected[i]) <= TEST_TOLERANCE);
        }
      }
    } catch (e) {
      row.note = e instanceof TimeoutError ? 'took too long (infinite loop?)' : String(e.message || e);
    }
    rows.push(row);
  }
  return rows;
}

const lastLine = (text = '') => text.trim().split('\n').pop();

/**
 * Behaviour tests: drive a simulated robot for 2 s using the student's code and the real kinematics.
 * input(t) gives the joystick at time t; check(end) gets { pose, last } where last = analyse() of the final step.
 */
const still = (end) => Math.hypot(end.last.vx, end.last.vy) < 0.05 && Math.abs(end.last.omega) < 0.05;
const stayedPut = (end) => Math.hypot(end.pose.X, end.pose.Y) < 0.3;
const releaseAfterOneSecond = (y) => (t) => ({ x: 0, y: t < 1 ? y : 0, r: 0 });

export const BEHAVIOUR_TESTS = {
  skid: [
    { name: 'Push forward → moves forward', input: () => ({ x: 0, y: 100, r: 0 }),
      check: (e) => e.pose.Y > 0.8 && Math.abs(e.pose.X) < 0.1 && Math.abs(e.pose.theta) < 0.2 },
    { name: 'Push right → spins clockwise', input: () => ({ x: 100, y: 0, r: 0 }),
      check: (e) => e.pose.theta < -1 && stayedPut(e) },
    { name: 'Push left → spins counter-clockwise', input: () => ({ x: -100, y: 0, r: 0 }),
      check: (e) => e.pose.theta > 1 && stayedPut(e) },
    { name: 'Release stick → stops', input: releaseAfterOneSecond(100), check: still },
  ],
  mecanum: [
    { name: 'Push forward → moves forward', input: () => ({ x: 0, y: 100, r: 0 }),
      check: (e) => e.pose.Y > 0.8 && Math.abs(e.pose.X) < 0.1 && Math.abs(e.pose.theta) < 0.2 },
    { name: 'Push right → slides right', input: () => ({ x: 100, y: 0, r: 0 }),
      check: (e) => e.pose.X > 0.5 && Math.abs(e.pose.Y) < 0.2 && Math.abs(e.pose.theta) < 0.2 },
    { name: 'Push left → slides left', input: () => ({ x: -100, y: 0, r: 0 }),
      check: (e) => e.pose.X < -0.5 && Math.abs(e.pose.Y) < 0.2 && Math.abs(e.pose.theta) < 0.2 },
    { name: 'r = +100 → rotates clockwise', input: () => ({ x: 0, y: 0, r: 100 }),
      check: (e) => e.pose.theta < -1 && stayedPut(e) },
    { name: 'Release stick → stops', input: releaseAfterOneSecond(100), check: still },
  ],
};

export const BEHAVIOUR_SECONDS = 2;

/** Run one behaviour test. callManyFn(argsList) -> Promise of { results }; resetFn() restarts the module. Returns { name, pass, note }. */
export async function runBehaviourTest(driveType, test, callManyFn, resetFn = async () => {}, hz = 20) {
  const dt = 1 / hz;
  const steps = BEHAVIOUR_SECONDS * hz;
  // The stick inputs do not depend on the robot, so all of them can be sent in one go.
  const argsList = Array.from({ length: steps }, (_, i) => inputArgs(driveType, test.input(i * dt)));
  let pose = { X: 0, Y: 0, theta: 0 };
  let last = analyse(driveType, ZERO);
  try {
    await resetFn();
    const { results } = await callManyFn(argsList);
    for (const reply of results) {
      if (!reply.ok) return { name: test.name, pass: false, note: 'error: ' + lastLine(reply.traceback) };
      const checked = validateOutput(driveType, reply.notSequence !== undefined ? reply.notSequence : reply.value);
      if (!checked.ok) return { name: test.name, pass: false, note: checked.error };
      last = analyse(driveType, toWheelSpeeds(driveType, checked.values));
      pose = stepPose(pose, last, dt);
    }
  } catch (e) {
    return { name: test.name, pass: false, note: e instanceof TimeoutError ? 'took too long (infinite loop?)' : String(e.message || e) };
  }
  const pass = test.check({ pose, last });
  const note = `ended at x ${pose.X.toFixed(2)} m, y ${pose.Y.toFixed(2)} m, turned ${((pose.theta * 180) / Math.PI).toFixed(0)}° (CCW +)`;
  return { name: test.name, pass, note };
}
