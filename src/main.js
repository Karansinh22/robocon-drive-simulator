// Explore + Challenge page: connects the 3D simulator (sim.js) to the control panel (ui.js).
import './styles.css';
import { createSim } from './sim.js';
import { createUI } from './ui.js';

const sim = createSim({
  canvas: document.getElementById('scene'),
  view: document.getElementById('view'),
  drive: 'mecanum',
});

let ui = null;
ui = createUI(sim.state, {
  changed() {
    sim.recompute();
    ui?.refresh(sim.result);
  },
  driveChanged: sim.rebuildRobot,
  reset: sim.reset,
  setCamera: sim.setCamera,
  setGhost: sim.setGhost,
});
ui.refresh(sim.result);
sim.start();
