// The 3D simulator: scene, robot, camera, trail and the frame loop.
// Used by both pages (Explore/Challenge in main.js, Code Lab in codelab/main.js).
//
// Wheel speeds enter the simulation in ONE place: wheelSpeeds().
// Normally they come from the wheel cards (state.wheels). If `state.external` is set
// ({ FL, FR, RL, RR } in -1..+1) those speeds are used instead – that is how the Code Lab drives the robot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WHEELS, analyse, signedSpeed, stepPose } from './kinematics.js';
import { buildRobot, createMotionOverlay, createGhostOverlay } from './robots.js';

const FIELD = 6;                 // field is 6 m x 6 m
const ROBOT_SCALE = 1.5;         // the model is drawn 1.5x bigger so it is easy to see on a smartboard
const EDGE = FIELD / 2 - 0.45;   // the robot stops here
const TRAIL_MAX = 6000;

const CAMERA_PRESETS = {
  top: { pos: new THREE.Vector3(0, 9.2, 0.001), target: new THREE.Vector3(0, 0, 0) },
  three: { pos: new THREE.Vector3(4.2, 4.6, 5.6), target: new THREE.Vector3(0, 0, 0) },
  side: { pos: new THREE.Vector3(0, 1.1, 8.5), target: new THREE.Vector3(0, 0.3, 0) },
};

export function createSim({ canvas, view, drive = 'mecanum' }) {
  /* ---------- shared state (the UI edits it, the loop reads it) ---------- */
  const state = {
    drive,
    wheels: Object.fromEntries(WHEELS.map((w) => [w, { dir: 'STOP', pct: 100 }])),
    paused: false,
    simSpeed: 1,
    showForces: false,
    showMotion: false,
    showTrail: false,
    mode: 'explore',
    external: null, // { FL, FR, RL, RR } in -1..+1, or null
  };

  /* ---------- renderer, scene, camera ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 2;
  controls.maxDistance = 20;

  let cameraTween = null;
  function setCamera(name, instant = false) {
    const p = CAMERA_PRESETS[name];
    if (instant) {
      camera.position.copy(p.pos);
      controls.target.copy(p.target);
      controls.update();
      return;
    }
    cameraTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), to: p };
  }

  /* lights */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8e8, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 7, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 6;
  sun.shadow.blurSamples = 16;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  scene.add(sun);

  /* floor: 6 m x 6 m, grid lines every 0.5 m */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD), new THREE.MeshBasicMaterial({ color: 0xf3f7fd }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // A see-through plane that only shows the soft shadows on top of the floor.
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD), new THREE.ShadowMaterial({ opacity: 0.22 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.001;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
  const grid = new THREE.GridHelper(FIELD, FIELD / 0.5, 0x9db4d8, 0xc9d7ee);
  grid.position.y = 0.002;
  scene.add(grid);
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3, 0.004, -3), new THREE.Vector3(3, 0.004, -3),
      new THREE.Vector3(3, 0.004, 3), new THREE.Vector3(-3, 0.004, 3),
    ]),
    new THREE.LineBasicMaterial({ color: 0x1d4ed8 }),
  );
  scene.add(border);

  /* ---------- the robot rig: pose + model + overlays ---------- */
  const rig = new THREE.Group();
  rig.scale.setScalar(ROBOT_SCALE);
  scene.add(rig);
  const motionOverlay = createMotionOverlay();
  const ghost = createGhostOverlay();
  rig.add(motionOverlay.group, ghost.group);

  let robot = null;
  function rebuildRobot() {
    if (robot) rig.remove(robot.root);
    robot = buildRobot(state.drive);
    rig.add(robot.root);
  }

  /* pose of the robot on the map: X right, Y forward, theta counter-clockwise (radians) */
  const pose = { X: 0, Y: 0, theta: 0 };

  /* ---------- trail: little flat discs left on the floor ---------- */
  const trail = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.03, 10).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1d4ed8 }),
    TRAIL_MAX,
  );
  trail.count = 0;
  trail.position.y = 0.01;
  scene.add(trail);
  let trailNext = 0, lastTrail = { X: 0, Y: 0 };
  const dummy = new THREE.Object3D();
  function addTrailPoint() {
    dummy.position.set(pose.X, 0, -pose.Y);
    dummy.updateMatrix();
    trail.setMatrixAt(trailNext, dummy.matrix);
    trailNext = (trailNext + 1) % TRAIL_MAX;
    trail.count = Math.min(trail.count + 1, TRAIL_MAX);
    trail.instanceMatrix.needsUpdate = true;
    lastTrail = { X: pose.X, Y: pose.Y };
  }
  function clearTrail() { trail.count = 0; trailNext = 0; lastTrail = { X: pose.X, Y: pose.Y }; }

  /* ---------- wheel speeds: the single entry point ---------- */
  function wheelSpeeds() {
    if (state.external) return { ...state.external };
    const s = {};
    for (const w of WHEELS) s[w] = signedSpeed(w, state.wheels[w].dir, state.wheels[w].pct);
    return s;
  }

  let result = analyse(state.drive, wheelSpeeds());
  function recompute() {
    result = analyse(state.drive, wheelSpeeds());
    robot.setShowForces(state.showForces);
    motionOverlay.group.visible = state.showMotion;
    trail.visible = state.showTrail;
  }

  function reset() { pose.X = pose.Y = pose.theta = 0; clearTrail(); }

  /* ---------- resize ---------- */
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);

  /* ---------- simulation step ---------- */
  function step(dt) {
    if (state.paused) return;
    const k = dt * state.simSpeed;
    Object.assign(pose, stepPose(pose, result, k, EDGE));
    robot.update(wheelSpeeds(), k);
    if (state.showTrail && Math.hypot(pose.X - lastTrail.X, pose.Y - lastTrail.Y) > 0.025) addTrailPoint();
  }

  /* ---------- main loop ---------- */
  const timer = new THREE.Timer();
  let onFrame = null;
  function frame() {
    requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);

    // External control changes every few milliseconds, so re-analyse each frame (it is cheap).
    if (state.external) recompute();
    step(dt);
    if (state.paused) robot.update(wheelSpeeds(), 0); // keep arrows in sync while paused

    rig.position.set(pose.X, 0, -pose.Y);
    rig.rotation.y = pose.theta;
    // "fighting" wheels: a small visual shake
    if (result.fighting && !state.paused) {
      robot.root.position.set((Math.random() - 0.5) * 0.015, 0, (Math.random() - 0.5) * 0.015);
      robot.root.rotation.y = (Math.random() - 0.5) * 0.03;
    } else {
      robot.root.position.set(0, 0, 0);
      robot.root.rotation.y = 0;
    }
    motionOverlay.update(result);

    if (cameraTween) {
      cameraTween.t = Math.min(1, cameraTween.t + dt / 0.6);
      const e = 1 - Math.pow(1 - cameraTween.t, 3);
      camera.position.lerpVectors(cameraTween.fromPos, cameraTween.to.pos, e);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.to.target, e);
      if (cameraTween.t >= 1) cameraTween = null;
    }
    controls.update();
    renderer.render(scene, camera);
    onFrame?.(result, pose);
  }

  rebuildRobot();
  setCamera('top', true);
  resize();

  return {
    state,
    pose,
    get result() { return result; },
    wheelSpeeds,
    recompute,
    rebuildRobot,
    reset,
    setCamera,
    setGhost: (target) => ghost.setTarget(target),
    set onFrame(fn) { onFrame = fn; },
    start() { frame(); },
  };
}
