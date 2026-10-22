import { describe, it, expect } from 'vitest';
import { analyse, signedSpeed, directionOf, describeMotion, wheelPushDirection } from '../src/kinematics.js';

const s = (FL, FR, RL, RR) => ({ FL, FR, RL, RR });
const near = (a, b) => expect(a).toBeCloseTo(b, 5);

describe('wheel sign convention', () => {
  it('left wheels: CCW = +, CW = -', () => {
    expect(signedSpeed('FL', 'CCW', 80)).toBeCloseTo(0.8);
    expect(signedSpeed('RL', 'CW', 50)).toBeCloseTo(-0.5);
  });
  it('right wheels: CW = +, CCW = -', () => {
    expect(signedSpeed('FR', 'CW', 100)).toBe(1);
    expect(signedSpeed('RR', 'CCW', 100)).toBe(-1);
  });
  it('stop is zero and directionOf inverts signedSpeed', () => {
    expect(signedSpeed('FL', 'STOP', 100)).toBe(0);
    for (const w of ['FL', 'FR', 'RL', 'RR'])
      for (const d of ['CW', 'CCW', 'STOP']) expect(directionOf(w, signedSpeed(w, d, 60))).toBe(d);
  });
});

describe('skid steer', () => {
  it('all four + -> forward, omega 0', () => {
    const r = analyse('skid', s(1, 1, 1, 1));
    near(r.vy, 1); near(r.vx, 0); near(r.omega, 0);
    expect(r.name).toBe('Forward');
    expect(r.fighting).toBe(false);
  });
  it('left -, right + -> rotate CCW on the spot', () => {
    const r = analyse('skid', s(-1, 1, -1, 1));
    near(r.vy, 0); near(r.vx, 0);
    expect(r.omega).toBeGreaterThan(0);
    expect(r.name).toBe('Rotate on the spot (CCW)');
  });
  it('FL +, RL - -> fighting flag', () => {
    const r = analyse('skid', s(1, 0, -1, 0));
    expect(r.fighting).toBe(true);
    expect(r.warning).toMatch(/fighting/);
  });
  it('curves left while moving forward when the right side is faster', () => {
    expect(analyse('skid', s(0.5, 1, 0.5, 1)).name).toBe('Curve left while moving forward');
  });
});

// The same five sign patterns must give the same named motions on mecanum and omni X.
describe.each(['mecanum', 'omni'])('%s', (drive) => {
  it('all + -> forward', () => {
    const r = analyse(drive, s(1, 1, 1, 1));
    expect(r.name).toBe('Forward');
    near(r.vx, 0); near(r.omega, 0);
  });
  it('FL +, FR -, RL -, RR + -> slide right', () => {
    const r = analyse(drive, s(1, -1, -1, 1));
    expect(r.name).toBe('Slide right');
    near(r.vy, 0); near(r.omega, 0);
    expect(r.vx).toBeGreaterThan(0);
  });
  it('FL +, FR -, RL +, RR - -> rotate CW on the spot', () => {
    const r = analyse(drive, s(1, -1, 1, -1));
    expect(r.name).toBe('Rotate on the spot (CW)');
    near(r.vx, 0); near(r.vy, 0);
    expect(r.omega).toBeLessThan(0);
  });
  it('FL +, RR + -> diagonal forward-right at 45 degrees', () => {
    const r = analyse(drive, s(1, 0, 0, 1));
    expect(r.name).toBe('Diagonal forward-right');
    near(r.headingDeg, 45);
    near(r.omega, 0);
  });
  it('FL -, FR +, RL +, RR - -> slide left (mirror of slide right)', () => {
    expect(analyse(drive, s(-1, 1, 1, -1)).name).toBe('Slide left');
  });
  it('all - -> backward', () => {
    expect(analyse(drive, s(-1, -1, -1, -1)).name).toBe('Backward');
  });
  it('never reports fighting', () => {
    expect(analyse(drive, s(1, 0, -1, 0)).fighting).toBe(false);
  });
});

describe('details', () => {
  it('mecanum forward speed is 1 m/s, omni is sqrt2/4 * 4', () => {
    near(analyse('mecanum', s(1, 1, 1, 1)).vy, 1);
    near(analyse('omni', s(1, 1, 1, 1)).vy, Math.SQRT2);
  });
  it('stopped robot is "Not moving"', () => {
    expect(analyse('mecanum', s(0, 0, 0, 0)).name).toBe('Not moving');
  });
  it('describeMotion combines translation and rotation', () => {
    expect(describeMotion(0.5, 0, -0.5)).toBe('Slide right while rotating CW');
  });
  it('wheel push direction is 45 degrees on mecanum/omni and straight on skid', () => {
    expect(wheelPushDirection('skid', 'FL')).toEqual({ x: 0, y: 1 });
    const fl = wheelPushDirection('mecanum', 'FL'), fr = wheelPushDirection('mecanum', 'FR');
    near(fl.x, Math.SQRT1_2); near(fr.x, -Math.SQRT1_2);
  });
});

import { CHALLENGES, checkChallenge } from '../src/challenges.js';
import { signedSpeed } from '../src/kinematics.js';

describe('challenges', () => {
  it('has at least 12 challenges covering all three drives', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(CHALLENGES.map((c) => c.drive))).toEqual(new Set(['skid', 'mecanum', 'omni']));
  });
  it('every challenge is solved by its own ideal wheel pattern', () => {
    for (const c of CHALLENGES) {
      const speeds = {};
      ['FL', 'FR', 'RL', 'RR'].forEach((w, i) => { speeds[w] = c.ideal[i]; });
      // A curve needs one side slower: curving right (rot -1) means the right side is slower.
      if (c.target.rot !== 0 && c.target.vy !== 0) {
        const slow = c.target.rot < 0 ? ['FR', 'RR'] : ['FL', 'RL'];
        slow.forEach((w) => { speeds[w] = 0.5; });
      }
      expect(checkChallenge(c, c.drive, speeds).ok, c.text).toBe(true);
    }
  });
  it('gives a hint naming the wrong wheels', () => {
    const slideLeft = CHALLENGES[0];
    const r = checkChallenge(slideLeft, 'mecanum', { FL: -1, FR: 1, RL: -1, RR: -1 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/RL/);
  });
});
