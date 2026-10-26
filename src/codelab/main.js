// Code Lab page: the same 3D simulator, driven by the student's Python instead of the wheel cards.
import '../styles.css';
import './codelab.css';
import { createSim } from '../sim.js';
import { zeroSpeeds } from './runner.js';
import { createCodeLab } from './ui.js';

const sim = createSim({
  canvas: document.getElementById('scene'),
  view: document.getElementById('view'),
  drive: 'mecanum',
});
sim.state.external = zeroSpeeds(); // the Code Lab owns the wheels; start stopped

createCodeLab(sim);
sim.start();
