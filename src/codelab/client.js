// Talks to the Python worker. Knows nothing about the DOM or Three.js, and takes the worker as a factory
// so tests can pass a fake one.
//
// Messages to the worker:   { type: 'init' | 'load' | 'call' | 'setParam', id, ... }
// Messages from the worker: { type: 'progress' | 'ready' | 'initError' | 'print' | 'reply', ... }

export const CALL_TIMEOUT_MS = 500;   // a call that takes longer than this means "infinite loop": the worker is killed
export const BATCH_TIMEOUT_MS = 3000; // a whole test batch (up to ~40 calls)
export const LOAD_TIMEOUT_MS = 3000;  // loading the student's module (top-level code) may take a little longer

export class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; }
}

export class WorkerClient {
  /**
   * createWorker: () => Worker-like { postMessage, terminate, onmessage }.
   * handlers: { onProgress(msg), onReady(), onInitError(text), onPrint(lines), onRestart() }
   */
  constructor(createWorker, handlers = {}) {
    this.createWorker = createWorker;
    this.handlers = handlers;
    this.nextId = 1;
    this.pending = new Map();
    this.restarts = 0;
    this._start();
  }

  _start() {
    this.worker = this.createWorker();
    this.isReady = false;
    this.ready = new Promise((resolve, reject) => { this._ready = { resolve, reject }; });
    this.ready.catch(() => {}); // the error is reported through onInitError; avoid an "unhandled rejection"
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.postMessage({ type: 'init' });
  }

  _onMessage(msg) {
    const h = this.handlers;
    if (msg.type === 'progress') h.onProgress?.(msg);
    else if (msg.type === 'ready') { this.isReady = true; this._ready.resolve(); h.onReady?.(); }
    else if (msg.type === 'initError') { this._ready.reject(new Error(msg.text)); h.onInitError?.(msg.text); }
    else if (msg.type === 'print') h.onPrint?.(msg.lines);
    else if (msg.type === 'reply') {
      const p = this.pending.get(msg.id);
      if (p) { this.pending.delete(msg.id); p.resolve(msg); }
    }
  }

  /** Kill the worker (e.g. after an infinite loop) and start a fresh one in the background. */
  restart() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new TimeoutError('Worker restarted'));
    this.pending.clear();
    this.restarts += 1;
    this._start();
    this.handlers.onRestart?.();
  }

  async request(payload, timeoutMs) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.restart(); // rejects every pending request, including this one
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (m) => { clearTimeout(timer); resolve(m); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.worker.postMessage({ ...payload, id });
    });
  }

  /** Run the student's module from scratch. Reply: { ok, error?, params? } */
  load(code, fnName, nargs, argNames) {
    return this.request({ type: 'load', code, fnName, nargs, argNames }, LOAD_TIMEOUT_MS);
  }

  /** Call the student's function. Reply: { ok, value | notSequence | traceback+line, ms } */
  call(args) {
    return this.request({ type: 'call', args }, CALL_TIMEOUT_MS);
  }

  /** Many calls in one message (used by the tests). Reply: { ok, results: [call replies] } */
  callMany(argsList) {
    return this.request({ type: 'callMany', argsList }, BATCH_TIMEOUT_MS);
  }

  setParam(key, value, isInt) {
    return this.request({ type: 'setParam', key, value, isInt }, CALL_TIMEOUT_MS);
  }

  terminate() { this.worker.terminate(); }
}
