// Web Worker for C++: runs the C++ interpreter. Same messages as worker.js (the Python worker),
// so the rest of the Code Lab does not care which language is running. It is ready immediately (nothing to download).
import { CppProgram, CppError } from './cpp/interpreter.js';

const MAX_PRINT_LINES_PER_CALL = 50;

let program = null;
let nIn = 0, nOut = 0, fnName = '';
let printBuffer = [];
let printedThisCall = 0;

function print(line) {
  // A print inside mix() runs 20 times a second: keep only the first few lines of each call.
  printedThisCall += 1;
  if (printedThisCall <= MAX_PRINT_LINES_PER_CALL) printBuffer.push(line);
}

function flushPrint() {
  if (printBuffer.length) { postMessage({ type: 'print', lines: printBuffer }); printBuffer = []; }
}

function errorText(e) {
  if (e instanceof CppError) return { text: e.line ? `line ${e.line}: ${e.message}` : e.message, line: e.line };
  return { text: String((e && e.message) || e), line: null };
}

function callOnce(args) {
  const t0 = performance.now();
  try {
    const value = program.call(fnName, args, nOut);
    return { ok: true, value, ms: performance.now() - t0 };
  } catch (e) {
    const { text, line } = errorText(e);
    return { ok: false, traceback: `Runtime error, ${text}`, line };
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') { postMessage({ type: 'ready' }); return; }

  printedThisCall = 0;
  let reply;
  if (msg.type === 'load') {
    program = null;
    try {
      const p = new CppProgram(msg.code, { print });
      const problem = p.checkSignature(msg.fnName, msg.nargs, msg.nOut, msg.signature);
      if (problem) reply = { ok: false, error: { text: problem, line: null } };
      else { program = p; fnName = msg.fnName; nIn = msg.nargs; nOut = msg.nOut; reply = { ok: true, params: p.getParams() }; }
    } catch (e) {
      const { text, line } = errorText(e);
      reply = { ok: false, error: { text: `error: ${text}`, line } };
    }
  } else if (!program) {
    reply = { ok: false, traceback: 'No program is loaded', line: null };
  } else if (msg.type === 'call') {
    reply = callOnce(msg.args);
  } else if (msg.type === 'callMany') {
    const results = [];
    for (const args of msg.argsList) {
      const r = callOnce(args);
      results.push(r);
      if (!r.ok) break;
    }
    reply = { ok: results.every((r) => r.ok), results };
  } else if (msg.type === 'setParam') {
    program.setParam(msg.key, msg.value);
    reply = { ok: true };
  }
  flushPrint();
  postMessage({ type: 'reply', id: msg.id, ...reply });
};
