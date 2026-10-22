// Challenge mode: pure data + checking logic (no Three.js, no DOM).
import { analyse, DRIVE_NAMES } from './kinematics.js';

// target = which way the robot should move, as signs: vx (right +), vy (forward +), rot (CCW +).
// ideal  = a sign pattern [FL, FR, RL, RR] that solves it (used to give hints about which wheels are wrong).
const C = (drive, text, target, ideal, diagonal = false) => ({ drive, text, target, ideal, diagonal });
const T = (vx, vy, rot) => ({ vx, vy, rot });

export const CHALLENGES = [
  C('mecanum', 'Make the mecanum robot slide left', T(-1, 0, 0), [-1, 1, 1, -1]),
  C('mecanum', 'Make the mecanum robot slide right', T(1, 0, 0), [1, -1, -1, 1]),
  C('mecanum', 'Rotate the mecanum robot clockwise on the spot', T(0, 0, -1), [1, -1, 1, -1]),
  C('mecanum', 'Make the mecanum robot go diagonally forward-left', T(-1, 1, 0), [0, 1, 1, 0], true),
  C('mecanum', 'Make the mecanum robot drive backward', T(0, -1, 0), [-1, -1, -1, -1]),
  C('mecanum', 'Make the mecanum robot go diagonally backward-right', T(1, -1, 0), [0, -1, -1, 0], true),
  C('omni', 'Rotate the omni robot clockwise', T(0, 0, -1), [1, -1, 1, -1]),
  C('omni', 'Rotate the omni robot counter-clockwise', T(0, 0, 1), [-1, 1, -1, 1]),
  C('omni', 'Make the omni robot slide right', T(1, 0, 0), [1, -1, -1, 1]),
  C('omni', 'Make the omni robot slide left', T(-1, 0, 0), [-1, 1, 1, -1]),
  C('omni', 'Make the omni robot go diagonally forward-right', T(1, 1, 0), [1, 0, 0, 1], true),
  C('omni', 'Make the omni robot drive forward', T(0, 1, 0), [1, 1, 1, 1]),
  C('skid', 'Make the skid steer robot drive forward', T(0, 1, 0), [1, 1, 1, 1]),
  C('skid', 'Make the skid steer robot drive backward', T(0, -1, 0), [-1, -1, -1, -1]),
  C('skid', 'Rotate the skid steer robot counter-clockwise on the spot', T(0, 0, 1), [-1, 1, -1, 1]),
  C('skid', 'Rotate the skid steer robot clockwise on the spot', T(0, 0, -1), [1, -1, 1, -1]),
  C('skid', 'Make the skid steer robot curve right while moving forward', T(0, 1, -1), [1, 1, 1, 1]),
];

const sign = (v, eps) => (Math.abs(v) < eps ? 0 : Math.sign(v));

/** Classify a result into signs {vx, vy, rot}. */
export function classify(result) {
  return { vx: sign(result.vx, 0.02), vy: sign(result.vy, 0.02), rot: sign(result.omega, 0.05) };
}

const WHEEL_ORDER = ['FL', 'FR', 'RL', 'RR'];
const nameList = (list) => (list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);

/**
 * Compare the robot's current motion with the challenge.
 * speeds: signed -1..1 for FL, FR, RL, RR.
 * Returns { ok, message }.
 */
export function checkChallenge(challenge, drive, speeds) {
  if (drive !== challenge.drive) {
    return { ok: false, message: `Switch to the ${DRIVE_NAMES[challenge.drive]} drive first.` };
  }
  const result = analyse(drive, speeds);
  const got = classify(result);
  const want = challenge.target;

  if (got.vx === 0 && got.vy === 0 && got.rot === 0) {
    return { ok: false, message: 'The robot is not moving. Set some wheels to CW or CCW.' };
  }

  const diagonalOk = !challenge.diagonal || Math.abs(Math.abs(result.vx) - Math.abs(result.vy)) < 0.05 * Math.max(1, Math.hypot(result.vx, result.vy));
  if (got.vx === want.vx && got.vy === want.vy && got.rot === want.rot && !result.fighting && diagonalOk) {
    return { ok: true, message: `✓ Correct! ${result.name}.` };
  }

  // Find the wheels that disagree with the ideal sign pattern.
  const wrong = WHEEL_ORDER.filter((w, i) => {
    const ideal = challenge.ideal[i];
    const s = Math.sign(speeds[w]) * (Math.abs(speeds[w]) < 0.01 ? 0 : 1);
    return s !== ideal;
  });
  const wheelHint = wrong.length ? ` – check ${nameList(wrong)}` : '';

  if (result.fighting) {
    return { ok: false, message: 'Two wheels on the same side are fighting each other – check the left pair and the right pair.' };
  }
  if (got.rot !== 0 && want.rot === 0) return { ok: false, message: `Your robot is also rotating${wheelHint}.` };
  if (got.rot === 0 && want.rot !== 0) return { ok: false, message: `Your robot is not rotating${wheelHint}.` };
  if (got.rot !== want.rot) return { ok: false, message: `Your robot rotates the wrong way${wheelHint}.` };
  if (got.vy !== want.vy) {
    return { ok: false, message: want.vy === 0 ? `Your robot also moves ${got.vy > 0 ? 'forward' : 'backward'}${wheelHint}.` : `Wrong forward/backward direction${wheelHint}.` };
  }
  if (got.vx !== want.vx) {
    return { ok: false, message: want.vx === 0 ? `Your robot also drifts sideways${wheelHint}.` : `Wrong sideways direction${wheelHint}.` };
  }
  if (!diagonalOk) return { ok: false, message: 'For a clean diagonal, sideways and forward speed must be equal – use only two opposite wheels.' };
  return { ok: false, message: `Not quite${wheelHint}.` };
}
