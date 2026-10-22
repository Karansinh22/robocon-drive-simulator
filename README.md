# Robocon Drive Simulator

A 3D simulator for teaching **skid steer**, **mecanum** and **omni X** drives. Set each wheel to CW / CCW / Stop and watch how the robot moves. Built for a classroom smartboard (large text, touch-friendly buttons).

## Commands

```bash
npm install        # install dependencies
npm run dev        # start the dev server (http://localhost:5173)
npm test           # run the kinematics unit tests (Vitest)
npm run build      # build a static site into ./dist  (upload that folder to any web host)
npm run preview    # try the built site locally
```

## Files

| File | What it does |
| --- | --- |
| `src/kinematics.js` | Pure maths: wheel speeds -> vx, vy, omega + motion name. No Three.js. |
| `src/robots.js` | Builds the 3D robots and arrows from primitives. |
| `src/ui.js` | Control panel, presets, readout, keyboard shortcuts, challenge mode. |
| `src/challenges.js` | Challenge list and answer checking with hints (pure). |
| `src/main.js` | Scene, camera, render loop, robot movement. |
| `tests/kinematics.test.js` | Unit tests. |

## Conventions

* Robot frame: +y forward, +x right, omega > 0 = counter-clockwise from above.
* CW / CCW is seen from **outside** the robot, looking at the wheel's outer face.
* Left wheels (FL, RL): CCW = forward. Right wheels (FR, RR): CW = forward.

## Keyboard

`1` `2` `3` drive type · `Q/A` `W/S` `E/D` `R/F` = FL / FR / RL / RR to CCW / CW · `Space` pause · `X` reset robot
