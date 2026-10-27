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

## Code Lab (`codelab.html`)

Students write their own mixing code, run it in the browser and drive the 3D robot with it. Three drives (**Skid steer**, **Mecanum**, **Omni X**) and two languages (**Python**, **C++**).

* Skid steer: `mix(x, y)` gives the left and right side. Mecanum and Omni X: `mix4(x, y, r)` gives `fl, fr, rl, rr` (the same mixing works for both).
* Inputs: x = right (+), y = forward (+), r = rotate **clockwise** (+), each -100..100. Outputs: -255..255, + = wheel rolls the robot forward.
* **Python** runs with [Pyodide](https://pyodide.org) 314.0.7 from the jsDelivr CDN inside a Web Worker (needs internet the first time). It is only downloaded when Python is used.
* **C++** runs in a small interpreter written for this project (`src/codelab/cpp/`), also in a Web Worker, with no download. Outputs come back through reference parameters (`int &left`). Mark a number as tunable with `PARAM int deadzone = 8;` (after `#define PARAM`). Supported: int/float/double/bool, arrays, functions, references, globals that keep their value between calls, if/for/while, `abs/min/max/round/constrain/map/sqrt/pow`, `printf`, `cout`, `Serial.println`. Not supported: classes, structs, pointers, templates, `switch`.
* If a call takes longer than 500 ms the worker is killed, the robot stops and a new worker is started.
* Tabs: Console, Tests, Live graph, Tuning (sliders for every `PARAMS` entry / `PARAM` variable).
* Share link: the code, drive and language are compressed (lz-string) into the URL hash.

## Files

| File | What it does |
| --- | --- |
| `src/sim.js` | The 3D scene, robot and frame loop, shared by both pages. Wheel speeds enter in `wheelSpeeds()`. |
| `src/codelab/runner.js` | Input -> function -> validation -> wheel speeds, and the tests (pure, unit-tested). |
| `src/codelab/client.js` | Talks to the Python worker, with the watchdog. |
| `src/codelab/worker.js` | The Pyodide (Python) web worker. |
| `src/codelab/cpp-worker.js`, `cpp/interpreter.js` | The C++ web worker and the C++ interpreter (pure JS, unit-tested). |
| `src/codelab/ui.js` | Code Lab page: editor, tabs, inputs. |
| `src/codelab/{editor,inputs,graph,examples,share}.js` | CodeMirror, joystick/gamepad/keyboard/scripts, live graph, starter code, saving and sharing. |


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
