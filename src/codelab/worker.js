// Web Worker: runs the student's Python with Pyodide, so a bad loop can never freeze the page.
// This is a MODULE worker: Pyodide 314 does not run in classic workers, so we import pyodide.mjs from the CDN.

// Pinned exact version. Loaded from the jsDelivr CDN the first time the Code Lab opens.
const PYODIDE_VERSION = '314.0.7';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MAX_PRINT_LINES_PER_CALL = 50;

let pyodide = null;
let entry = null; // the three Python entry points, looked up once
let printBuffer = [];
let printedThisCall = 0;

// Python side: runs the student's module, calls the function, formats errors.
const HARNESS = `
import sys, json, math, traceback, inspect, time, linecache
from _bridge import emit_print

class _Out:
    def __init__(self):
        self.buf = ""
    def write(self, text):
        self.buf += text
        while "\\n" in self.buf:
            line, self.buf = self.buf.split("\\n", 1)
            emit_print(line)
        return len(text)
    def flush(self):
        pass

sys.stdout = _Out()
sys.stderr = sys.stdout

_ns = {}
_fn = None

def _error(e):
    """Traceback that only shows the student's own lines, plus the line number to highlight."""
    tb = traceback.extract_tb(e.__traceback__)
    mine = [f for f in tb if f.filename == "student.py"]
    line = mine[-1].lineno if mine else None
    text = ""
    if isinstance(e, SyntaxError):
        line = e.lineno
        text = 'File "student.py", line %s\\n' % e.lineno
        if e.text:
            text += "    " + e.text.strip() + "\\n"
    elif mine:
        text = "Traceback (most recent call last):\\n" + "".join(traceback.format_list(mine))
    text += "".join(traceback.format_exception_only(type(e), e))
    return {"ok": False, "traceback": text.rstrip(), "line": line}

def _params():
    p = _ns.get("PARAMS")
    out = {}
    if isinstance(p, dict):
        for k, v in p.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out[str(k)] = {"value": v, "isInt": isinstance(v, int)}
    return out

def _load(code, fn_name, nargs, arg_names):
    global _ns, _fn
    _ns = {"__name__": "__student__"}
    _fn = None
    linecache.cache["student.py"] = (len(code), None, code.splitlines(True), "student.py")
    try:
        exec(compile(code, "student.py", "exec"), _ns)
    except BaseException as e:
        r = _error(e)
        return {"ok": False, "error": {"text": r["traceback"], "line": r["line"]}}
    fn = _ns.get(fn_name)
    sig_text = "%s(%s)" % (fn_name, ", ".join(arg_names))
    if not callable(fn):
        return {"ok": False, "error": {"text": "Your code must define a function named %s." % sig_text, "line": None}}
    try:
        n = len(inspect.signature(fn).parameters)
    except (TypeError, ValueError):
        n = nargs
    if n != nargs:
        return {"ok": False, "error": {"text": "%s should take %d arguments, but yours takes %d. It should look like: def %s:" % (fn_name, nargs, n, sig_text), "line": None}}
    _fn = fn
    return {"ok": True, "params": _params()}

def _num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
        return v
    return repr(v)

def _call(args):
    t0 = time.perf_counter()
    try:
        result = _fn(*args)
    except BaseException as e:
        return _error(e)
    ms = (time.perf_counter() - t0) * 1000
    try:
        items = list(result)
    except TypeError:
        return {"ok": True, "notSequence": repr(result), "ms": ms}
    if isinstance(result, (str, bytes, dict)):
        return {"ok": True, "notSequence": repr(result), "ms": ms}
    return {"ok": True, "value": [_num(v) for v in items], "ms": ms}

def _set_param(key, value, is_int):
    p = _ns.get("PARAMS")
    if isinstance(p, dict) and key in p:
        p[key] = int(round(value)) if is_int else float(value)
    return {"ok": True}

# One JSON string in, one JSON string out: the cheapest way to cross the JS <-> Python border.
def _load_json(s):
    return json.dumps(_load(*json.loads(s)))

def _call_json(s):
    return json.dumps(_call(json.loads(s)))

def _call_many_json(s):
    # Used by the tests: many calls in one message, so test speed does not depend on the page's frame rate.
    results = []
    for args in json.loads(s):
        r = _call(args)
        results.append(r)
        if not r["ok"]:
            break
    return json.dumps({"ok": all(r["ok"] for r in results), "results": results})

def _set_param_json(s):
    return json.dumps(_set_param(*json.loads(s)))
`;

function flushPrint() {
  if (printBuffer.length) {
    postMessage({ type: 'print', lines: printBuffer });
    printBuffer = [];
  }
}

function emitPrint(line) {
  // A print() inside mix() runs 20 times a second: keep only the first few lines of each call.
  printedThisCall += 1;
  if (printedThisCall <= MAX_PRINT_LINES_PER_CALL) printBuffer.push(String(line));
}

async function init() {
  try {
    postMessage({ type: 'progress', stage: 'script', text: 'Downloading Python…' });
    const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_URL + 'pyodide.mjs');
    postMessage({ type: 'progress', stage: 'runtime', text: 'Starting Python…' });
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    pyodide.registerJsModule('_bridge', { emit_print: emitPrint });
    pyodide.runPython(HARNESS);
    entry = {
      load: pyodide.globals.get('_load_json'),
      call: pyodide.globals.get('_call_json'),
      callMany: pyodide.globals.get('_call_many_json'),
      setParam: pyodide.globals.get('_set_param_json'),
    };
    postMessage({ type: 'ready' });
  } catch (e) {
    postMessage({ type: 'initError', text: String((e && e.message) || e) });
  }
}


self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') { init(); return; }
  if (!entry) return;

  printedThisCall = 0;
  let reply;
  if (msg.type === 'load') {
    reply = JSON.parse(entry.load(JSON.stringify([msg.code, msg.fnName, msg.nargs, msg.argNames])));
  } else if (msg.type === 'call') {
    reply = JSON.parse(entry.call(JSON.stringify(msg.args)));
  } else if (msg.type === 'callMany') {
    reply = JSON.parse(entry.callMany(JSON.stringify(msg.argsList)));
  } else if (msg.type === 'setParam') {
    reply = JSON.parse(entry.setParam(JSON.stringify([msg.key, msg.value, !!msg.isInt])));
  }
  flushPrint();
  postMessage({ type: 'reply', id: msg.id, ...reply });
};
