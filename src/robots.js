// Builds the 3D models. Everything is made from Three.js primitives – no external files.
//
// Conventions used here:
//  * Robot "map" frame (kinematics): +x right, +y forward.
//  * Three.js scene frame:          +x right, +y up, -z forward.   map (x, y)  ->  scene (x, 0, -y)
//  * Every wheel is built with its axle along the local +x axis. The OUTER face (hub cap) is at +x.
//    The wheel is then yawed so +x points away from the robot.
//    Positive rotation about +x is counter-clockwise seen from outside, which is exactly "CCW".
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WHEELS, wheelPushDirection, MAX_SPEED } from './kinematics.js';

export const COLORS = { blue: 0x1d4ed8, dark: 0x0f2747, light: 0xeaf1fb, orange: 0xea580c, ghost: 0x60a5fa };

const WHEEL_R = 0.09;   // wheel radius (m)
const WHEEL_W = 0.07;   // wheel width (m)
const CHASSIS = { hw: 0.2, hl: 0.3, h: 0.08, y: 0.11 }; // half-width, half-length, height, centre height

// Where each wheel sits (scene frame) and which way its outer face points (yaw about the y axis).
function wheelPlacement(drive, name) {
  const left = name === 'FL' || name === 'RL';
  const front = name === 'FL' || name === 'FR';
  const sx = left ? -1 : 1;
  const sz = front ? -1 : 1; // front is -z
  if (drive === 'omni') {
    // On the corners, axle pointing diagonally outward, so the axles form an X from above.
    const d = 0.035;
    return { x: sx * (CHASSIS.hw + d), z: sz * (CHASSIS.hl + d), yaw: outwardYaw(sx, sz) };
  }
  return { x: sx * (CHASSIS.hw + WHEEL_W / 2 + 0.008), z: sz * 0.22, yaw: outwardYaw(sx, 0) };
}

// A yaw angle a maps local +x to (cos a, 0, -sin a). We want it to equal (ox, 0, oz).
function outwardYaw(ox, oz) {
  return Math.atan2(-oz, ox);
}

/* ---------- small helpers ---------- */

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...extra });
const MATS = {
  tire: mat(0x1f2937, { roughness: 0.9 }),
  rubber: mat(0x111827, { roughness: 0.95 }),
  hub: mat(COLORS.blue),
  hubDark: mat(COLORS.dark),
  roller: mat(0x94a3b8, { metalness: 0.3, roughness: 0.4 }),
  white: mat(0xffffff, { roughness: 0.4 }),
  chassis: mat(COLORS.dark, { roughness: 0.4, metalness: 0.2 }),
};

function cast(obj) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return obj;
}

/** Cylinder whose axis is the x axis. */
function axleCylinder(radius, width, material, radial = 32) {
  const g = new THREE.CylinderGeometry(radius, radius, width, radial);
  g.rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, material);
}

/** A straight 3D arrow (shaft + head), pointing along +y until you call set(). */
export function makeArrow(color, width = 0.02) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false });
  const shaftGeo = new THREE.CylinderGeometry(width, width, 1, 12);
  shaftGeo.translate(0, 0.5, 0);
  const shaft = new THREE.Mesh(shaftGeo, material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(width * 2.6, width * 5, 16), material);
  group.add(shaft, head);
  group.renderOrder = 10;
  shaft.renderOrder = head.renderOrder = 10;
  const headLen = width * 5;
  const up = new THREE.Vector3(0, 1, 0);
  return {
    group,
    material,
    /** direction: THREE.Vector3 (any length), length in scene units. */
    set(direction, length) {
      const len = Math.max(length, headLen * 1.2);
      group.quaternion.setFromUnitVectors(up, direction.clone().normalize());
      shaft.scale.y = len - headLen;
      head.position.y = len - headLen / 2;
    },
  };
}

/**
 * A curved arrow in the local XY plane (counter-clockwise when seen from +z).
 * Scale.y = -1 on the returned group mirrors it into a clockwise arrow.
 */
export function makeCurvedArrow(color, radius, tube, arcDeg = 250) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthTest: false });
  const start = (30 * Math.PI) / 180;
  const arc = (arcDeg * Math.PI) / 180;
  const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 40, arc), material);
  torus.rotation.z = start;
  const end = start + arc;
  const head = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.2, tube * 6, 16), material);
  head.position.set(Math.cos(end) * radius, Math.sin(end) * radius, 0);
  head.rotation.z = end; // cone +y -> tangent (-sin, cos), i.e. counter-clockwise
  group.add(torus, head);
  group.renderOrder = 10;
  torus.renderOrder = head.renderOrder = 10;
  return { group, material };
}

function makeLabel(text, size, w, h, color = '#ffffff', bg = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = Math.round(256 * (h / w));
  const ctx = canvas.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.rotation.x = -Math.PI / 2; // lie flat, text reads correctly from above with the front at the top of the screen
  return m;
}

/* ---------- wheels ---------- */

function addHubStripe(spin) {
  // A white stripe on the hub cap so you can SEE the wheel turning.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.014), MATS.white);
  stripe.position.x = WHEEL_W / 2 + 0.004;
  const cap = axleCylinder(0.05, 0.012, MATS.hub);
  cap.position.x = WHEEL_W / 2 - 0.002;
  spin.add(cap, stripe);
}

function skidWheel() {
  const spin = new THREE.Group();
  spin.add(axleCylinder(WHEEL_R - 0.006, WHEEL_W, MATS.tire));
  // Treads: little blocks around the rim.
  const treadGeo = new THREE.BoxGeometry(WHEEL_W * 0.95, 0.014, 0.022);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const t = new THREE.Mesh(treadGeo, MATS.rubber);
    t.position.set(0, Math.cos(a) * (WHEEL_R - 0.002), Math.sin(a) * (WHEEL_R - 0.002));
    t.rotation.x = -a;
    spin.add(t);
  }
  addHubStripe(spin);
  return spin;
}

function mecanumWheel(sigma) {
  const spin = new THREE.Group();
  spin.add(axleCylinder(0.062, WHEEL_W * 0.8, MATS.hubDark));
  const n = 10;
  const rollerGeo = new THREE.CapsuleGeometry(0.017, 0.05, 4, 10);
  const tilt = Math.PI / 4;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const pos = new THREE.Vector3(0, Math.cos(a), Math.sin(a)).multiplyScalar(WHEEL_R - 0.017);
    const tangent = new THREE.Vector3(0, -Math.sin(a), Math.cos(a));
    // Roller axis = tangent tilted 45 degrees towards the axle. The sign decides which way (X pattern).
    const axis = tangent.multiplyScalar(Math.cos(tilt)).add(new THREE.Vector3(sigma * Math.sin(tilt), 0, 0)).normalize();
    const r = new THREE.Mesh(rollerGeo, MATS.roller);
    r.position.copy(pos);
    r.quaternion.setFromUnitVectors(up, axis);
    spin.add(r);
  }
  addHubStripe(spin);
  return spin;
}

function omniWheel() {
  const spin = new THREE.Group();
  spin.add(axleCylinder(0.066, WHEEL_W * 0.7, MATS.hubDark));
  const n = 12;
  const rollerGeo = new THREE.CapsuleGeometry(0.014, 0.04, 4, 10);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const pos = new THREE.Vector3(0, Math.cos(a), Math.sin(a)).multiplyScalar(WHEEL_R - 0.014);
    const tangent = new THREE.Vector3(0, -Math.sin(a), Math.cos(a)); // rollers at 90 degrees to the wheel axle
    // Two rows, shifted sideways, like a real double omni wheel.
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(rollerGeo, MATS.roller);
      r.position.copy(pos).add(new THREE.Vector3(side * 0.02, 0, 0));
      r.quaternion.setFromUnitVectors(up, tangent);
      spin.add(r);
    }
  }
  addHubStripe(spin);
  return spin;
}

// Which way the rollers lean (the X pattern seen from above): FL and RR one way, FR and RL the other.
const MECANUM_SIGMA = { FL: +1, RR: +1, FR: -1, RL: -1 };

/* ---------- the robot ---------- */

export function buildRobot(drive) {
  const root = new THREE.Group();

  // Chassis: rounded dark-blue box with a FRONT arrow.
  const chassis = new THREE.Mesh(
    new RoundedBoxGeometry(CHASSIS.hw * 2, CHASSIS.h, CHASSIS.hl * 2, 4, 0.03),
    MATS.chassis,
  );
  chassis.position.y = CHASSIS.y;
  root.add(chassis);

  const topY = CHASSIS.y + CHASSIS.h / 2 + 0.002;
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.2);        // tip
  arrowShape.lineTo(0.12, 0.04);
  arrowShape.lineTo(0.05, 0.04);
  arrowShape.lineTo(0.05, -0.12);
  arrowShape.lineTo(-0.05, -0.12);
  arrowShape.lineTo(-0.05, 0.04);
  arrowShape.lineTo(-0.12, 0.04);
  arrowShape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.set(0, topY, -0.06);
  root.add(arrow);
  const frontText = makeLabel('FRONT', 64, 0.24, 0.07, '#ffffff');
  frontText.position.set(0, topY + 0.001, 0.19);
  root.add(frontText);

  const wheelParts = {};
  const forceArrows = {};
  const topArrows = {};

  for (const name of WHEELS) {
    const place = wheelPlacement(drive, name);
    const frame = new THREE.Group();            // fixed to the chassis; +x is the wheel's outer side
    frame.position.set(place.x, WHEEL_R, place.z);
    frame.rotation.y = place.yaw;

    const spin = drive === 'skid' ? skidWheel() : drive === 'mecanum' ? mecanumWheel(MECANUM_SIGMA[name]) : omniWheel();
    frame.add(spin);

    // Curved arrow on the outer face: CCW arrow and CW arrow, only one is visible.
    const faceX = WHEEL_W / 2 + 0.012;
    const faceArrows = {};
    for (const dir of ['CCW', 'CW']) {
      const a = makeCurvedArrow(COLORS.blue, 0.052, 0.0085);
      a.group.rotation.y = Math.PI / 2;   // face +x (the outer side)
      if (dir === 'CW') a.group.scale.y = -1;
      a.group.position.x = faceX;
      a.group.visible = false;
      frame.add(a.group);
      faceArrows[dir] = a;
    }
    cast(frame);
    root.add(frame);

    // Direction this wheel pushes the robot (scene frame), perpendicular to its axle.
    const push = wheelPushDirection(drive, name);
    const pushScene = new THREE.Vector3(push.x, 0, -push.y);

    // Which sign of rotation.x makes the top of the wheel move along the push direction?
    // Local +z of the wheel (the way the top moves for a positive turn) in scene space is (sin yaw, 0, cos yaw).
    const spinSign = Math.sign(Math.sin(place.yaw) * pushScene.x + Math.cos(place.yaw) * pushScene.z);

    // Flat arrow on top of the tyre: shows where the top of the wheel is moving (readable from above).
    const topArrow = makeArrow(COLORS.blue, 0.007);
    topArrow.group.position.set(place.x, WHEEL_R * 2 + 0.02, place.z);
    topArrow.group.visible = false;
    root.add(topArrow.group);
    topArrows[name] = { arrow: topArrow, push: pushScene };

    // Wheel force arrow at the ground contact.
    const force = makeArrow(COLORS.blue, 0.011);
    force.group.position.set(place.x, 0.02, place.z);
    force.group.visible = false;
    root.add(force.group);
    forceArrows[name] = { arrow: force, push: pushScene };

    wheelParts[name] = { spin, spinSign, faceArrows, angle: 0 };

    // Name tag on the chassis next to the wheel.
    const tag = makeLabel(name, 56, 0.1, 0.06, '#ffffff');
    const tx = Math.sign(place.x) * 0.1, tz = Math.sign(place.z) * 0.24;
    tag.position.set(tx, topY + 0.001, tz);
    root.add(tag);
  }
  cast(chassis);

  let showForces = false;

  return {
    root,
    setShowForces(v) { showForces = v; },
    /** speeds: signed -1..1 per wheel. spinDt: simulated seconds to advance the spin by. */
    update(speeds, spinDt) {
      for (const name of WHEELS) {
        const s = speeds[name];
        const part = wheelParts[name];
        // Rolling without slipping: angular speed = surface speed / radius.
        part.angle += part.spinSign * s * (MAX_SPEED / WHEEL_R) * spinDt;
        part.spin.rotation.x = part.angle;

        const positive = s >= 0;
        const color = positive ? COLORS.blue : COLORS.orange;
        // Which way does the wheel turn as seen from outside? Positive rotation about +x = CCW.
        const turning = Math.abs(s) < 1e-6 ? null : (part.spinSign * s > 0 ? 'CCW' : 'CW');
        for (const d of ['CCW', 'CW']) {
          part.faceArrows[d].group.visible = turning === d;
          part.faceArrows[d].material.color.setHex(color);
        }

        const top = topArrows[name];
        top.arrow.group.visible = turning !== null;
        if (turning) {
          top.arrow.material.color.setHex(color);
          top.arrow.set(top.push.clone().multiplyScalar(Math.sign(s)), 0.08 + 0.12 * Math.abs(s));
        }

        const f = forceArrows[name];
        f.arrow.group.visible = showForces && turning !== null;
        if (f.arrow.group.visible) {
          f.arrow.material.color.setHex(color);
          f.arrow.set(f.push.clone().multiplyScalar(Math.sign(s)), 0.12 + 0.35 * Math.abs(s));
        }
      }
    },
  };
}

/* ---------- overlays that follow the robot ---------- */

/** "Show motion": a big arrow for (vx, vy) and a curved arrow for omega. */
export function createMotionOverlay() {
  const group = new THREE.Group();
  const move = makeArrow(COLORS.blue, 0.022);
  const spin = makeCurvedArrow(COLORS.dark, 0.5, 0.016, 250);
  spin.group.rotation.x = -Math.PI / 2; // lie flat
  const flat = new THREE.Group();
  flat.position.y = 0.3;
  flat.add(spin.group);
  move.group.position.y = 0.3;
  group.add(move.group, flat);
  group.visible = false;
  return {
    group,
    update({ vx, vy, omega }) {
      const speed = Math.hypot(vx, vy);
      move.group.visible = speed > 0.02;
      if (move.group.visible) move.set(new THREE.Vector3(vx, 0, -vy), 0.25 + speed * 0.8);
      flat.visible = Math.abs(omega) > 0.05;
      spin.group.scale.y = omega > 0 ? 1 : -1;
    },
  };
}

/** Ghost arrow for challenge mode. target = { vx, vy, rot } with values in -1, 0, 1. */
export function createGhostOverlay() {
  const group = new THREE.Group();
  const move = makeArrow(COLORS.ghost, 0.045);
  move.material.opacity = 0.55;
  const spin = makeCurvedArrow(COLORS.ghost, 0.55, 0.035, 250);
  spin.material.opacity = 0.55;
  spin.group.rotation.x = -Math.PI / 2;
  const flat = new THREE.Group();
  flat.add(spin.group);
  flat.position.y = 0.25;
  move.group.position.y = 0.25;
  group.add(move.group, flat);
  group.visible = false;
  return {
    group,
    setTarget(target) {
      group.visible = !!target;
      if (!target) return;
      const dir = new THREE.Vector3(target.vx, 0, -target.vy);
      move.group.visible = dir.lengthSq() > 0;
      if (move.group.visible) move.set(dir, 1.1);
      flat.visible = target.rot !== 0;
      spin.group.scale.y = target.rot > 0 ? 1 : -1;
    },
  };
}
