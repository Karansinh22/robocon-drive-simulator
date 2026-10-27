import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyse } from '../src/kinematics.js';
import { buildShareLink, parseShareHash } from '../src/codelab/share.js';
import { WorkerClient, TimeoutError, CALL_TIMEOUT_MS } from '../src/codelab/client.js';
import {
  validateOutput, toWheelSpeeds, inputArgs, Runner,
  TABLE_TESTS, BEHAVIOUR_TESTS, runTableTests, runBehaviourTest,
} from '../src/codelab/runner.js';

/* JavaScript copies of the two "full" starter solutions (the Python versions live in examples.js). */
const skidFull = (x, y, dz = 8) => {
  if (Math.abs(x) < dz) x = 0;
  if (Math.abs(y) < dz) y = 0;
  let left = y + x, right = y - x;
  const biggest = Math.max(Math.abs(left), Math.abs(right), 100);
  left = (left * 100) / biggest; right = (right * 100) / biggest;
  return [Math.round(left * 2.55), Math.round(right * 2.55)];
};
const mecanumFull = (x, y, r) => {
  const v = [y + x + r, y - x - r, y - x + r, y + x - r];
  const biggest = Math.max(...v.map(Math.abs), 100);
  return v.map((a) => Math.round((a * 255) / biggest));
};
// A stand-in for client.callMany: runs the JavaScript copy of the solution for every argument list.
const fakeCall = (fn) => async (argsList) => ({ ok: true, results: argsList.map((a) => ({ ok: true, value: fn(...a), ms: 1 })) });

describe('validateOutput', () => {
  it('accepts the right count of numbers', () => {
    expect(validateOutput('skid', [10, -20])).toEqual({ ok: true, values: [10, -20], warnings: [] });
    expect(validateOutput('mecanum', [1, 2, 3, 4]).ok).toBe(true);
  });
  it('clamps to ±255 and says which wheel and how to fix it', () => {
    const r = validateOutput('mecanum', [312, 0, -400, 255]);
    expect(r.values).toEqual([255, 0, -255, 255]);
    expect(r.warnings[0]).toBe('FL was 312 — clamped to 255. Did you forget to scale?');
    expect(r.warnings[1]).toMatch(/^RL was -400 — clamped to -255/);
  });
  it('rejects the wrong count', () => {
    expect(validateOutput('skid', [1, 2, 3]).ok).toBe(false);
    expect(validateOutput('mecanum', [1, 2]).error).toMatch(/must return 4/);
  });
  it('rejects None, strings and NaN (they arrive from Python as their repr text)', () => {
    expect(validateOutput('skid', ['None', 5]).error).toBe('left is None — it must be a number.');
    expect(validateOutput('skid', [5, "'abc'"]).ok).toBe(false);
    expect(validateOutput('skid', [5, 'nan']).ok).toBe(false);
    expect(validateOutput('skid', [5, NaN]).ok).toBe(false);
  });
  it('rejects a function that returned something that is not a list', () => {
    expect(validateOutput('skid', 'None').ok).toBe(false);
  });
});

describe('wheel mapping', () => {
  it('skid steer: left drives FL and RL, right drives FR and RR', () => {
    const s = toWheelSpeeds('skid', [255, -127.5]);
    expect(s).toEqual({ FL: 1, RL: 1, FR: -0.5, RR: -0.5 });
  });
  it('mecanum: [fl, fr, rl, rr] map to the same wheels, divided by 255', () => {
    expect(toWheelSpeeds('mecanum', [255, 0, -255, 51])).toEqual({ FL: 1, FR: 0, RL: -1, RR: 0.2 });
  });
  it('builds the argument list for each drive', () => {
    expect(inputArgs('skid', { x: 1, y: 2, r: 3 })).toEqual([1, 2]);
    expect(inputArgs('mecanum', { x: 1, y: 2, r: 3 })).toEqual([1, 2, 3]);
  });
});

describe('r sign: +100 is CLOCKWISE seen from above', () => {
  it('mecanum r = +100 makes omega negative (the simulator uses CCW positive)', () => {
    const out = mecanumFull(0, 0, 100);
    const result = analyse('mecanum', toWheelSpeeds('mecanum', out));
    expect(result.omega).toBeLessThan(0);
    expect(result.name).toBe('Rotate on the spot (CW)');
  });
  it('skid x = +100 (stick right) spins clockwise as well', () => {
    const result = analyse('skid', toWheelSpeeds('skid', skidFull(100, 0)));
    expect(result.omega).toBeLessThan(0);
  });
});

describe('table and behaviour tests with the correct solutions', () => {
  it('every table row passes', async () => {
    const skid = await runTableTests('skid', fakeCall(skidFull));
    expect(skid.map((r) => r.pass)).toEqual(Array(6).fill(true));
    const mec = await runTableTests('mecanum', fakeCall(mecanumFull));
    expect(mec.map((r) => r.pass)).toEqual(Array(6).fill(true));
    expect(TABLE_TESTS.skid).toHaveLength(6);
  });
  it.each(['skid', 'mecanum'])('every behaviour test passes for %s', async (drive) => {
    const fn = drive === 'skid' ? skidFull : mecanumFull;
    for (const t of BEHAVIOUR_TESTS[drive]) {
      const r = await runBehaviourTest(drive, t, fakeCall(fn));
      expect(r.pass, `${t.name}: ${r.note}`).toBe(true);
    }
  });
  it('swapped left/right is caught by the behaviour tests', async () => {
    const wrong = (x, y) => skidFull(-x, y);
    const results = await Promise.all(BEHAVIOUR_TESTS.skid.map((t) => runBehaviourTest('skid', t, fakeCall(wrong))));
    expect(results.some((r) => !r.pass)).toBe(true);
  });
  it('a mecanum that forgot the clockwise sign for r fails the rotation test', async () => {
    const wrong = (x, y, r) => mecanumFull(x, y, -r);
    const t = BEHAVIOUR_TESTS.mecanum.find((b) => b.name.startsWith('r = +100'));
    expect((await runBehaviourTest('mecanum', t, fakeCall(wrong))).pass).toBe(false);
  });
  it('a Python error is reported as a failed row, not a crash', async () => {
    const rows = await runTableTests('skid', async (list) => ({ ok: false, results: [{ ok: false, traceback: 'x\nZeroDivisionError: division by zero', line: 2 }] }));
    expect(rows[0].pass).toBe(false);
    expect(rows[0].note).toMatch(/ZeroDivisionError/);
  });
});

/* ---------- watchdog, with a mock worker ---------- */

function makeMockWorker({ replyToCalls = true } = {}) {
  const w = {
    terminated: false,
    sent: [],
    onmessage: null,
    postMessage(msg) {
      w.sent.push(msg);
      if (msg.type === 'init') queueMicrotask(() => w.onmessage({ data: { type: 'ready' } }));
      else if (replyToCalls) queueMicrotask(() => w.onmessage({ data: { type: 'reply', id: msg.id, ok: true, value: [1, 2], ms: 1 } }));
    },
    terminate() { w.terminated = true; },
  };
  return w;
}

describe('watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the reply when the worker answers in time', async () => {
    const worker = makeMockWorker();
    const client = new WorkerClient(() => worker);
    await expect(client.call([0, 0])).resolves.toMatchObject({ ok: true, value: [1, 2] });
    expect(worker.terminated).toBe(false);
  });

  it('terminates and replaces the worker when there is no reply within 500 ms', async () => {
    const workers = [];
    const onRestart = vi.fn();
    const client = new WorkerClient(() => { const w = makeMockWorker({ replyToCalls: workers.length > 0 }); workers.push(w); return w; }, { onRestart });
    const promise = client.call([0, 0]);
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 1);
    expect(await settled).toBeInstanceOf(TimeoutError);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);       // a fresh worker was started
    expect(onRestart).toHaveBeenCalledOnce();
    await expect(client.call([0, 0])).resolves.toMatchObject({ ok: true }); // and it works
  });

  it('Runner: a timeout stops the robot (all wheels 0) and shows the infinite-loop message', async () => {
    const workers = [];
    const client = new WorkerClient(() => {
      const w = makeMockWorker({ replyToCalls: false });
      const post = w.postMessage;
      w.postMessage = (msg) => {
        if (msg.type === 'load') queueMicrotask(() => w.onmessage({ data: { type: 'reply', id: msg.id, ok: true, params: {} } }));
        else post(msg);
      };
      workers.push(w);
      return w;
    });
    const speeds = [], errors = [], statuses = [];
    const runner = new Runner({
      client, getInput: () => ({ x: 0, y: 100, r: 0 }),
      on: { speeds: (s) => speeds.push(s), error: (e) => errors.push(e), status: (s) => statuses.push(s) },
    });
    await runner.start('def mix(x, y): pass', 'skid');
    await vi.advanceTimersByTimeAsync(50);      // first tick sends a call that never gets answered
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 10);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'timeout', message: 'Your code took too long — is there an infinite loop?' });
    expect(speeds.at(-1)).toEqual({ FL: 0, FR: 0, RL: 0, RR: 0 });
    expect(runner.running).toBe(false);
    expect(statuses.at(-1)).toBe('error');
    expect(workers[0].terminated).toBe(true);
  });
});

describe('share links', () => {
  const code = 'PARAMS = {"deadzone": 8}\n\ndef mix4(x, y, r):\n    return [x + y + r, 0, 0, 0]  # héllo ✓ + spaces & symbols = ?\n';
  it('round-trips code through the URL hash', () => {
    const link = buildShareLink('https://x.github.io/robocon-drive-simulator/codelab.html', code, 'mecanum');
    expect(link.startsWith('https://x.github.io/robocon-drive-simulator/codelab.html#drive=mecanum&code=')).toBe(true);
    const hash = new URL(link).hash;
    expect(parseShareHash(hash)).toEqual({ drive: 'mecanum', lang: 'python', code });
  });
  it('survives a "+" that a chat app turned into a space', () => {
    const link = buildShareLink('https://x/y.html', code, 'skid');
    const mangled = new URL(link).hash.replace(/\+/g, ' ');
    expect(parseShareHash(mangled)).toEqual({ drive: 'skid', lang: 'python', code });
  });
  it('remembers the language and accepts Omni X', () => {
    const link = buildShareLink('https://x/y.html', '#include <cmath>\nvoid mix4() {}', 'omni', 'cpp');
    expect(link).toContain('&lang=cpp&');
    expect(parseShareHash(new URL(link).hash)).toEqual({ drive: 'omni', lang: 'cpp', code: '#include <cmath>\nvoid mix4() {}' });
  });
  it('ignores hashes that are not share links', () => {
    expect(parseShareHash('')).toBeNull();
    expect(parseShareHash('#drive=hexapod&code=abc')).toBeNull();
    expect(parseShareHash('#code=zzzz&drive=skid')).toBeNull();
  });
});
