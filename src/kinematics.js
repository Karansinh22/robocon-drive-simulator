// Pure kinematics – no Three.js, no DOM. Easy to read, easy to test.
//
// Robot frame:  +y = forward, +x = right, omega > 0 = counter-clockwise (seen from above).
// Wheel order:  FL, FR, RL, RR  (front-left, front-right, rear-left, rear-right).
// Each wheel has a signed speed s in [-1, +1]:  + means "this wheel rolls the robot forward".

export const DRIVES = ['skid', 'mecanum', 'omni'];
export const WHEELS = ['FL', 'FR', 'RL', 'RR'];

export const DRIVE_NAMES = { skid: 'Skid steer', mecanum: 'Mecanum', omni: 'Omni X' };

export const MAX_SPEED = 1.0; // m/s at the wheel surface when |s| = 1
export const LX = 0.25;       // half-width  (m)
export const LY = 0.25;       // half-length (m)

const FIGHT_LIMIT = 0.05;     // how different two wheels on one side may be
const MOVE_EPS = 0.02;        // m/s below which we say "not moving"
const SPIN_EPS = 0.05;        // rad/s below which we say "not rotating"

const SQRT2 = Math.SQRT2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Left-side wheels: CCW = forward (+). Right-side wheels: CW = forward (+). */
export function isLeftWheel(wheel) {
  return wheel === 'FL' || wheel === 'RL';
}

/** Direction ('CW' | 'CCW' | 'STOP') and percent (0-100) -> signed speed s (-1..+1). */
export function signedSpeed(wheel, dir, percent = 100) {
  if (dir === 'STOP') return 0;
  const magnitude = clamp(percent, 0, 100) / 100;
  const forwardDir = isLeftWheel(wheel) ? 'CCW' : 'CW';
  return dir === forwardDir ? magnitude : -magnitude;
}

/** Inverse of signedSpeed: signed s -> 'CW' | 'CCW' | 'STOP'. */
export function directionOf(wheel, s) {
  if (Math.abs(s) < 1e-9) return 'STOP';
  const forwardDir = isLeftWheel(wheel) ? 'CCW' : 'CW';
  const backwardDir = forwardDir === 'CCW' ? 'CW' : 'CCW';
  return s > 0 ? forwardDir : backwardDir;
}

/**
 * Direction (unit vector in the robot frame) in which a wheel pushes the robot
 * when its speed is positive. For mecanum and omni this is 45 degrees, which is
 * exactly why sideways motion works.
 */
export function wheelPushDirection(drive, wheel) {
  if (drive === 'skid') return { x: 0, y: 1 };
  const r = Math.SQRT1_2;
  const sameDiagonal = wheel === 'FL' || wheel === 'RR'; // "/" diagonal pair
  return sameDiagonal ? { x: r, y: r } : { x: -r, y: r };
}

/** Core maths: the drive type and four signed wheel speeds -> { vx, vy, omega } in m/s and rad/s. */
export function computeVelocity(drive, speeds) {
  const { FL, FR, RL, RR } = speeds;
  const S = MAX_SPEED;
  let vx = 0, vy = 0, omega = 0;

  if (drive === 'skid') {
    const vl = (FL + RL) / 2;
    const vr = (FR + RR) / 2;
    vy = (vl + vr) / 2;
    vx = 0;
    omega = (vr - vl) / (2 * LX);
  } else if (drive === 'mecanum') {
    vy = (FL + FR + RL + RR) / 4;
    vx = (FL - FR - RL + RR) / 4;
    omega = (-FL + FR - RL + RR) / (4 * (LX + LY));
  } else if (drive === 'omni') {
    const R = Math.sqrt(LX * LX + LY * LY);
    vy = (SQRT2 / 4) * (FL + FR + RL + RR);
    vx = (SQRT2 / 4) * (FL - FR - RL + RR);
    omega = (-FL + FR - RL + RR) / (4 * R);
  } else {
    throw new Error(`Unknown drive type: ${drive}`);
  }
  return { vx: vx * S, vy: vy * S, omega: omega * S };
}

/** Is a skid-steer side being driven by two wheels that disagree? */
export function isFighting(drive, speeds) {
  if (drive !== 'skid') return false;
  return Math.abs(speeds.FL - speeds.RL) > FIGHT_LIMIT || Math.abs(speeds.FR - speeds.RR) > FIGHT_LIMIT;
}

/** Name the motion in plain English from vx, vy, omega. */
export function describeMotion(vx, vy, omega) {
  const moving = Math.hypot(vx, vy) > MOVE_EPS;
  const spinning = Math.abs(omega) > SPIN_EPS;
  const spinWord = omega > 0 ? 'CCW' : 'CW';

  if (!moving && !spinning) return 'Not moving';
  if (!moving) return `Rotate on the spot (${spinWord})`;

  // Heading: 0 deg = forward, positive = towards the right (clockwise on the map).
  const heading = (Math.atan2(vx, vy) * 180) / Math.PI;
  const sector = ((Math.round(heading / 45) % 8) + 8) % 8;
  const labels = [
    'Forward', 'Diagonal forward-right', 'Slide right', 'Diagonal backward-right',
    'Backward', 'Diagonal backward-left', 'Slide left', 'Diagonal forward-left',
  ];
  const translation = labels[sector];

  if (!spinning) return translation;
  if (sector === 0 || sector === 4) {
    const side = omega > 0 ? 'left' : 'right';
    return `Curve ${side} while moving ${sector === 0 ? 'forward' : 'backward'}`;
  }
  return `${translation} while rotating ${spinWord}`;
}

/** Everything the UI needs for one set of wheel speeds. */
export function analyse(drive, speeds) {
  const clean = {};
  for (const w of WHEELS) clean[w] = clamp(speeds[w] ?? 0, -1, 1);

  const { vx, vy, omega } = computeVelocity(drive, clean);
  const fighting = isFighting(drive, clean);
  const moving = Math.hypot(vx, vy) > MOVE_EPS;
  const headingDeg = moving ? round((Math.atan2(vx, vy) * 180) / Math.PI, 1) : 0;
  const omegaDegPerSec = round((omega * 180) / Math.PI, 1);

  return {
    vx: round(vx), vy: round(vy), omega: round(omega),
    speed: round(Math.hypot(vx, vy)),
    headingDeg, omegaDegPerSec, fighting,
    warning: fighting ? 'Wheels on one side are fighting – skidding and wasting power' : '',
    name: describeMotion(vx, vy, omega),
  };
}

/** Can this drive do this kind of motion at all? (used to disable presets) */
export function canMoveSideways(drive) {
  return drive !== 'skid';
}
