// A small interpreter for the part of C++ that students need to write joystick-mixing code.
// Pure JavaScript, no DOM: it runs inside a web worker (cpp-worker.js) and is unit-tested in Node.
//
// Supported:  int/long/short/char/unsigned, float, double, bool, auto, const/static/constexpr,
//             global variables (they keep their value between calls), arrays, functions,
//             reference parameters (int &x), if/else, for, while, do-while, break/continue/return,
//             all arithmetic/logic/bit operators, casts, ?:, #define NAME value, #include (ignored),
//             abs/min/max/round/sqrt/pow/constrain/map..., printf, cout, Serial.println.
// Not supported: classes/structs/templates, pointers (other than int *a as an array), switch, new/delete.

export class CppError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'CppError';
    this.line = line ?? null;
  }
}

/* ======================= lexer ======================= */

const TYPE_WORDS = new Set(['int', 'long', 'short', 'unsigned', 'signed', 'char', 'float', 'double', 'bool', 'void', 'auto']);
const QUALIFIERS = new Set(['const', 'static', 'constexpr', 'volatile', 'inline', 'extern', 'register']);
const UNSUPPORTED = {
  switch: "'switch' is not supported here yet — use if / else if",
  struct: "'struct' is not supported here yet — use separate variables or arrays",
  class: "'class' is not supported here",
  template: 'templates are not supported here',
  new: "'new' is not supported here",
  delete: "'delete' is not supported here",
  goto: "'goto' is not supported here",
  typedef: "'typedef' is not supported here",
  enum: "'enum' is not supported here — use const int values",
};
const OPS3 = ['<<=', '>>=', '...'];
const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '::', '->'];

function lex(code, macros = new Map(), depth = 0, firstLine = 1) {
  const tokens = [];
  let i = 0, line = firstLine;
  const n = code.length;
  const push = (type, value, extra = {}) => tokens.push({ type, value, line, ...extra });

  while (i < n) {
    const c = code[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === '#' && tokens.every((t) => t.line !== line)) {
      // a preprocessor line (with \ continuation)
      let text = '';
      const startLine = line;
      while (i < n && code[i] !== '\n') {
        if (code[i] === '\\' && code[i + 1] === '\n') { i += 2; line++; continue; }
        text += code[i++];
      }
      text = text.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
      const m = /^#\s*(\w+)\s*(.*)$/.exec(text);
      if (m && m[1] === 'define') {
        const dm = /^(\w+)(\(?)\s*(.*)$/.exec(m[2]);
        if (!dm) throw new CppError('bad #define', startLine);
        if (dm[2] === '(') throw new CppError('function-like #define macros are not supported — write a normal function instead', startLine);
        if (dm[1] !== 'PARAM') macros.set(dm[1], dm[3]); // #define PARAM is just a marker, handled by the parser
      }
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      i = j;
      if (macros.has(word) && depth < 8) {
        const sub = lex(macros.get(word), macros, depth + 1, line).filter((t) => t.type !== 'eof');
        for (const t of sub) tokens.push({ ...t, line });
      } else push('id', word);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([fFlLuU]*)/.exec(code.slice(i));
      i += m[0].length;
      const isHex = /^0[xX]/.test(m[1]);
      const isFloat = !isHex && /[.eE]/.test(m[1]);
      const kind = /[fF]/.test(m[2]) && !isHex ? 'float' : isFloat ? 'double' : 'int';
      push('num', Number(m[1]), { kind });
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      while (i < n && code[i] !== '"') {
        if (code[i] === '\\') { i++; s += unescape(code[i]); } else s += code[i];
        if (code[i] === '\n') throw new CppError('missing terminating " character', line);
        i++;
      }
      i++;
      push('str', s);
      continue;
    }
    if (c === "'") {
      let ch = code[i + 1];
      let len = 3;
      if (ch === '\\') { ch = unescape(code[i + 2]); len = 4; }
      if (code[i + len - 1] !== "'") throw new CppError('bad character literal', line);
      i += len;
      push('num', ch.charCodeAt(0), { kind: 'int' });
      continue;
    }
    const three = code.slice(i, i + 3), two = code.slice(i, i + 2);
    if (OPS3.includes(three)) { push('op', three); i += 3; continue; }
    if (OPS2.includes(two)) { push('op', two); i += 2; continue; }
    if ('+-*/%=<>!&|^~?:;,.(){}[]'.includes(c)) { push('op', c); i++; continue; }
    throw new CppError(`stray '${c}' in program`, line);
  }
  tokens.push({ type: 'eof', value: '<end of file>', line });
  // `std::max` is just `max` for us.
  return tokens.filter((t, k) => !(t.type === 'id' && t.value === 'std' && tokens[k + 1]?.value === '::') && !(t.value === '::' && tokens[k - 1]?.value === 'std'));
}

function unescape(ch) {
  return { n: '\n', t: '\t', r: '\r', 0: '\0', '\\': '\\', "'": "'", '"': '"' }[ch] ?? ch;
}

/* ======================= types and numbers ======================= */

// A type is one of: 'int' (all integer kinds), 'float', 'double', 'bool', 'void', 'ostream', 'str'.
const isFloating = (k) => k === 'float' || k === 'double';
const promote = (a, b) => (a === 'double' || b === 'double' ? 'double' : a === 'float' || b === 'float' ? 'float' : 'int');

function coerce(kind, v) {
  switch (kind) {
    case 'int': return Number.isFinite(v) ? Math.trunc(v) | 0 : 0;
    case 'bool': return v ? 1 : 0;
    case 'float': return Math.fround(v);
    default: return v;
  }
}

/* ======================= parser ======================= */

const BINARY_PRECEDENCE = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

// Library functions: ret() gives the result type from the argument types, fn() does the work.
const dbl = () => 'double';
const LIB = {
  abs: { ret: (t) => (t[0] === 'bool' ? 'int' : t[0]), fn: (a) => Math.abs(a) },
  labs: { ret: () => 'int', fn: (a) => Math.abs(a) },
  fabs: { ret: dbl, fn: (a) => Math.abs(a) },
  min: { ret: (t) => promote(t[0], t[1]), fn: (a, b) => Math.min(a, b) },
  max: { ret: (t) => promote(t[0], t[1]), fn: (a, b) => Math.max(a, b) },
  constrain: { ret: (t) => promote(promote(t[0], t[1]), t[2]), fn: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) },
  round: { ret: dbl, fn: (a) => Math.sign(a) * Math.round(Math.abs(a)) },
  lround: { ret: () => 'int', fn: (a) => Math.sign(a) * Math.round(Math.abs(a)) },
  floor: { ret: dbl, fn: Math.floor },
  ceil: { ret: dbl, fn: Math.ceil },
  trunc: { ret: dbl, fn: Math.trunc },
  sqrt: { ret: dbl, fn: Math.sqrt },
  pow: { ret: dbl, fn: Math.pow },
  exp: { ret: dbl, fn: Math.exp },
  log: { ret: dbl, fn: Math.log },
  sin: { ret: dbl, fn: Math.sin },
  cos: { ret: dbl, fn: Math.cos },
  tan: { ret: dbl, fn: Math.tan },
  atan: { ret: dbl, fn: Math.atan },
  atan2: { ret: dbl, fn: Math.atan2 },
  hypot: { ret: dbl, fn: Math.hypot },
  fmod: { ret: dbl, fn: (a, b) => a % b },
  sq: { ret: (t) => t[0], fn: (a) => a * a },
  // Arduino's integer map()
  map: { ret: () => 'int', fn: (x, a, b, c, d) => { if (b === a) throw new CppError('map(): in_min and in_max are equal'); return Math.trunc(((x - a) * (d - c)) / (b - a)) + c; } },
};
const CONSTANTS = { PI: ['double', Math.PI], M_PI: ['double', Math.PI], INT_MAX: ['int', 2147483647], INT_MIN: ['int', -2147483648], HIGH: ['int', 1], LOW: ['int', 0] };
const OUTPUT_FUNCS = new Set(['printf', 'puts', 'Serial.println', 'Serial.print', 'Serial.begin', 'Serial.printf']);

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.p = 0;
    this.globals = new Map();      // name -> info
    this.functions = new Map();    // name -> { name, ret, params, body, line }
    this.scopes = [this.globals];
    this.currentFn = null;
    this.globalDecls = [];         // global declarations, run in order at load
  }

  /* --- token helpers --- */
  get tok() { return this.t[this.p]; }
  peek(k = 1) { return this.t[Math.min(this.p + k, this.t.length - 1)]; }
  isOp(v) { return this.tok.type === 'op' && this.tok.value === v; }
  isId(v) { return this.tok.type === 'id' && this.tok.value === v; }
  next() { return this.t[this.p++]; }
  fail(message, line = this.tok.line) { throw new CppError(message, line); }
  expectOp(v) {
    if (!this.isOp(v)) {
      // A missing ';' is reported on the line where the statement ended, like a real compiler does.
      const line = v === ';' && this.p > 0 ? this.t[this.p - 1].line : this.tok.line;
      this.fail(`expected '${v}' before '${this.tok.value}'`, line);
    }
    return this.next();
  }
  acceptOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }

  /* --- scopes --- */
  push() { this.scopes.push(new Map()); }
  pop() { this.scopes.pop(); }
  declare(name, info, line) {
    const top = this.scopes[this.scopes.length - 1];
    if (top.has(name) && top !== this.globals) this.fail(`redeclaration of '${name}'`, line);
    top.set(name, info);
  }
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    return null;
  }

  /* --- types --- */
  atType() {
    let k = 0;
    while (this.peek(k).type === 'id' && (QUALIFIERS.has(this.peek(k).value) || this.peek(k).value === 'PARAM')) k++;
    return this.peek(k).type === 'id' && TYPE_WORDS.has(this.peek(k).value);
  }

  parseType() {
    const spec = { kind: null, isConst: false, isParam: false };
    let seen = false;
    const words = [];
    while (this.tok.type === 'id') {
      const w = this.tok.value;
      if (QUALIFIERS.has(w)) { if (w === 'const' || w === 'constexpr') spec.isConst = true; this.p++; }
      else if (w === 'PARAM') { spec.isParam = true; this.p++; }
      else if (TYPE_WORDS.has(w)) { words.push(w); seen = true; this.p++; }
      else break;
    }
    if (!seen) return null;
    spec.kind = words.includes('double') ? 'double' : words.includes('float') ? 'float'
      : words.includes('bool') ? 'bool' : words.includes('void') ? 'void' : words.includes('auto') ? 'auto' : 'int';
    return spec;
  }

  /* --- program --- */
  parseProgram() {
    while (this.tok.type !== 'eof') {
      if (this.isId('using')) { while (!this.isOp(';') && this.tok.type !== 'eof') this.p++; this.p++; continue; }
      if (this.tok.type === 'id' && UNSUPPORTED[this.tok.value]) this.fail(UNSUPPORTED[this.tok.value]);
      const line = this.tok.line;
      const spec = this.parseType();
      if (!spec) this.fail(`expected a declaration, found '${this.tok.value}'`);
      if (this.tok.type !== 'id') this.fail(`expected a name after the type, found '${this.tok.value}'`);
      if (this.peek().value === '(' && this.peek().type === 'op') this.parseFunction(spec, line);
      else this.parseDeclaration(spec, true);
    }
  }

  parseFunction(spec, line) {
    const name = this.next().value;
    this.expectOp('(');
    const params = [];
    if (this.isId('void') && this.peek().value === ')') this.p++;
    else if (!this.isOp(')')) {
      do {
        const pspec = this.parseType();
        if (!pspec || pspec.kind === 'void') this.fail(`expected a parameter type, found '${this.tok.value}'`);
        let isRef = false, isArray = false;
        if (this.acceptOp('&')) isRef = true;
        if (this.acceptOp('*')) isArray = true;
        const pname = this.tok.type === 'id' ? this.next().value : `_unnamed${params.length}`;
        if (this.acceptOp('[')) { if (!this.isOp(']')) this.parseExpr(); this.expectOp(']'); isArray = true; }
        params.push({ name: pname, kind: pspec.kind === 'auto' ? 'double' : pspec.kind, isRef: isRef && !pspec.isConst, isArray, line: this.tok.line });
      } while (this.acceptOp(','));
    }
    this.expectOp(')');
    const fn = { name, ret: spec.kind, params, body: null, line };
    if (this.functions.has(name) && this.functions.get(name).body && !this.isOp(';')) this.fail(`redefinition of '${name}'`, line);
    this.functions.set(name, fn);
    if (this.acceptOp(';')) return; // prototype
    this.currentFn = fn;
    this.push();
    for (const prm of params) this.declare(prm.name, { kind: prm.kind, isArray: prm.isArray, isRef: prm.isRef }, line);
    fn.body = this.parseBlock(false);
    this.pop();
    this.currentFn = null;
  }

  /** Parse "name [= init] {, name [= init]} ;" after a type. Global declarations are queued, local ones returned. */
  parseDeclaration(spec, global) {
    const line = this.tok.line;
    const decls = [];
    do {
      if (this.tok.type !== 'id') this.fail(`expected a variable name, found '${this.tok.value}'`);
      const name = this.next().value;
      const d = { name, kind: spec.kind, isArray: false, size: null, init: null, line, isParam: !!spec.isParam, isConst: spec.isConst };
      if (this.acceptOp('[')) {
        d.isArray = true;
        if (!this.isOp(']')) d.size = this.parseExpr();
        this.expectOp(']');
        if (this.isOp('[')) this.fail('two-dimensional arrays are not supported here — use a single array');
      }
      if (this.acceptOp('=')) {
        if (this.isOp('{')) {
          this.p++;
          d.init = { list: [] };
          while (!this.isOp('}')) { d.init.list.push(this.parseAssign()); if (!this.acceptOp(',')) break; }
          this.expectOp('}');
        } else d.init = this.parseAssign();
      }
      if (d.kind === 'auto') {
        if (!d.init || d.init.list) this.fail(`'auto' needs an initial value`, line);
        d.kind = d.init.ty === 'bool' ? 'bool' : d.init.ty;
      }
      if (d.kind === 'void') this.fail(`variable '${name}' declared void`, line);
      this.declare(name, { kind: d.kind, isArray: d.isArray, isRef: false, isConst: !!spec.isConst }, line);
      decls.push(d);
    } while (this.acceptOp(','));
    this.expectOp(';');
    const node = { n: 'decl', decls, line };
    if (global) this.globalDecls.push(node);
    return node;
  }

  /* --- statements --- */
  parseBlock(newScope = true) {
    const line = this.tok.line;
    this.expectOp('{');
    if (newScope) this.push();
    const body = [];
    while (!this.isOp('}')) {
      if (this.tok.type === 'eof') this.fail("expected '}' at end of input");
      body.push(this.parseStatement());
    }
    this.p++;
    if (newScope) this.pop();
    return { n: 'block', body, line };
  }

  parseStatement() {
    const tok = this.tok;
    const line = tok.line;
    if (tok.type === 'id' && UNSUPPORTED[tok.value]) this.fail(UNSUPPORTED[tok.value]);
    if (this.isOp('{')) return this.parseBlock();
    if (this.acceptOp(';')) return { n: 'empty', line };
    if (this.atType()) {
      const spec = this.parseType();
      return this.parseDeclaration(spec, false);
    }
    if (this.isId('if')) {
      this.p++; this.expectOp('(');
      const cond = this.parseExpr(); this.expectOp(')');
      const then = this.parseScoped();
      let otherwise = null;
      if (this.isId('else')) { this.p++; otherwise = this.parseScoped(); }
      return { n: 'if', cond, then, otherwise, line };
    }
    if (this.isId('while')) {
      this.p++; this.expectOp('(');
      const cond = this.parseExpr(); this.expectOp(')');
      return { n: 'while', cond, body: this.parseScoped(), line };
    }
    if (this.isId('do')) {
      this.p++;
      const body = this.parseScoped();
      if (!this.isId('while')) this.fail("expected 'while' after 'do' body");
      this.p++; this.expectOp('(');
      const cond = this.parseExpr(); this.expectOp(')'); this.expectOp(';');
      return { n: 'dowhile', cond, body, line };
    }
    if (this.isId('for')) {
      this.p++; this.expectOp('(');
      this.push();
      let init = null;
      if (this.atType()) init = this.parseDeclaration(this.parseType(), false);
      else if (this.acceptOp(';')) init = null;
      else { init = { n: 'expr', e: this.parseExpr(), line }; this.expectOp(';'); }
      const cond = this.isOp(';') ? null : this.parseExpr(); this.expectOp(';');
      const step = this.isOp(')') ? null : this.parseExpr(); this.expectOp(')');
      const body = this.parseScoped();
      this.pop();
      return { n: 'for', init, cond, step, body, line };
    }
    if (this.isId('return')) {
      this.p++;
      const fn = this.currentFn;
      let e = null;
      if (!this.isOp(';')) e = this.parseExpr();
      this.expectOp(';');
      if (fn && fn.ret === 'void' && e) this.fail('return-statement with a value, in function returning void', line);
      if (fn && fn.ret !== 'void' && !e) this.fail('return-statement with no value, in function returning a value', line);
      return { n: 'return', e, kind: fn ? fn.ret : 'void', line };
    }
    if (this.isId('break')) { this.p++; this.expectOp(';'); return { n: 'break', line }; }
    if (this.isId('continue')) { this.p++; this.expectOp(';'); return { n: 'continue', line }; }
    const e = this.parseExpr();
    this.expectOp(';');
    return { n: 'expr', e, line };
  }

  parseScoped() { // a statement that gets its own scope (the body of if/for/while)
    this.push();
    const s = this.parseStatement();
    this.pop();
    return s;
  }

  /* --- expressions --- */
  parseExpr() { return this.parseAssign(); }

  parseAssign() {
    const left = this.parseTernary();
    if (this.tok.type === 'op' && ASSIGN_OPS.has(this.tok.value)) {
      const op = this.next().value;
      const line = this.tok.line;
      if (!this.isLvalue(left)) this.fail('lvalue required as left operand of assignment', line);
      const right = this.parseAssign();
      if (left.n === 'id' && left.info.isConst) this.fail(`assignment of read-only variable '${left.name}'`, line);
      return { n: 'assign', op, target: left, e: right, ty: left.ty, line };
    }
    return left;
  }

  isLvalue(e) { return (e.n === 'id' && !e.info.isArray) || e.n === 'index'; }

  parseTernary() {
    const cond = this.parseBinary(1);
    if (this.isOp('?')) {
      const line = this.next().line;
      const a = this.parseAssign();
      this.expectOp(':');
      const b = this.parseAssign();
      return { n: 'cond', cond, a, b, ty: a.ty === b.ty ? a.ty : promote(a.ty, b.ty), line };
    }
    return cond;
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.tok;
      const prec = tok.type === 'op' ? BINARY_PRECEDENCE[tok.value] : undefined;
      if (!prec || prec < minPrec) return left;
      this.p++;
      const right = this.parseBinary(prec + 1);
      const op = tok.value;
      const line = tok.line;
      if (op === '&&' || op === '||') left = { n: 'logic', op, a: left, b: right, ty: 'bool', line };
      else if (op === '<<' && left.ty === 'ostream') left = { n: 'out', left, right, ty: 'ostream', line };
      else if (['==', '!=', '<', '<=', '>', '>='].includes(op)) left = { n: 'bin', op, a: left, b: right, ty: 'bool', line };
      else {
        if ((op === '%' || ['&', '|', '^', '<<', '>>'].includes(op)) && (isFloating(left.ty) || isFloating(right.ty))) {
          this.fail(`invalid operands of types '${left.ty}' and '${right.ty}' to binary 'operator${op}'`, line);
        }
        left = { n: 'bin', op, a: left, b: right, ty: ['<<', '>>'].includes(op) ? 'int' : promote(left.ty, right.ty), line };
      }
    }
  }

  parseUnary() {
    const tok = this.tok;
    const line = tok.line;
    if (tok.type === 'op') {
      if (['+', '-', '!', '~'].includes(tok.value)) {
        this.p++;
        const e = this.parseUnary();
        return { n: 'unary', op: tok.value, e, ty: tok.value === '!' ? 'bool' : e.ty === 'bool' ? 'int' : e.ty, line };
      }
      if (tok.value === '++' || tok.value === '--') {
        this.p++;
        const e = this.parseUnary();
        if (!this.isLvalue(e)) this.fail('lvalue required as increment operand', line);
        return { n: 'incdec', op: tok.value, prefix: true, target: e, ty: e.ty, line };
      }
      if (tok.value === '(' && this.peek().type === 'id' && (TYPE_WORDS.has(this.peek().value) || (QUALIFIERS.has(this.peek().value) && TYPE_WORDS.has(this.peek(2).value)))) {
        this.p++;
        const spec = this.parseType();
        this.expectOp(')');
        const e = this.parseUnary();
        return { n: 'cast', to: spec.kind, e, ty: spec.kind, line };
      }
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      const line = this.tok.line;
      if (this.isOp('[')) {
        this.p++;
        const idx = this.parseExpr();
        this.expectOp(']');
        if (e.n !== 'id' || !e.info.isArray) this.fail(`'${e.name ?? 'expression'}' is not an array`, line);
        e = { n: 'index', base: e, idx, ty: e.info.kind, line };
      } else if (this.isOp('++') || this.isOp('--')) {
        if (!this.isLvalue(e)) this.fail('lvalue required as increment operand', line);
        e = { n: 'incdec', op: this.next().value, prefix: false, target: e, ty: e.ty, line };
      } else return e;
    }
  }

  parsePrimary() {
    const tok = this.tok;
    const line = tok.line;
    if (tok.type === 'num') { this.p++; return { n: 'num', v: tok.value, ty: tok.kind, line }; }
    if (tok.type === 'str') { this.p++; return { n: 'str', v: tok.value, ty: 'str', line }; }
    if (this.isOp('(')) {
      this.p++;
      const e = this.parseExpr();
      this.expectOp(')');
      return e;
    }
    if (tok.type === 'id') {
      const name = tok.value;
      if (name === 'true' || name === 'false') { this.p++; return { n: 'num', v: name === 'true' ? 1 : 0, ty: 'bool', line }; }
      if (UNSUPPORTED[name]) this.fail(UNSUPPORTED[name]);
      // function-style cast: int(x), float(x)
      if (TYPE_WORDS.has(name) && this.peek().value === '(') {
        this.p += 2;
        const e = this.parseExpr();
        this.expectOp(')');
        return { n: 'cast', to: name === 'float' ? 'float' : name === 'double' ? 'double' : name === 'bool' ? 'bool' : 'int', e, ty: name === 'float' ? 'float' : name === 'double' ? 'double' : name === 'bool' ? 'bool' : 'int', line };
      }
      if (name === 'static_cast' && this.peek().value === '<') {
        this.p += 2;
        const spec = this.parseType();
        this.expectOp('>');
        this.expectOp('(');
        const e = this.parseExpr();
        this.expectOp(')');
        return { n: 'cast', to: spec.kind, e, ty: spec.kind, line };
      }
      this.p++;
      if (name === 'cout' || name === 'cerr') return { n: 'stream', ty: 'ostream', line };
      if (name === 'endl') return { n: 'str', v: '\n', ty: 'str', line };
      if (name === 'Serial' && this.isOp('.')) {
        this.p++;
        const method = this.next().value;
        const full = `Serial.${method}`;
        if (!OUTPUT_FUNCS.has(full)) this.fail(`'Serial.${method}' is not supported here`, line);
        return this.parseCallArgs(full, line, true);
      }
      if (this.isOp('(')) return this.parseCallArgs(name, line, false);
      const info = this.lookup(name);
      if (info) return { n: 'id', name, info, ty: info.kind, line };
      if (CONSTANTS[name]) return { n: 'num', v: CONSTANTS[name][1], ty: CONSTANTS[name][0], line };
      this.fail(`'${name}' was not declared in this scope`, line);
    }
    this.fail(`expected an expression before '${tok.value}'`);
  }

  parseCallArgs(name, line, isOutput) {
    this.expectOp('(');
    const args = [];
    if (!this.isOp(')')) do { args.push(this.parseAssign()); } while (this.acceptOp(','));
    this.expectOp(')');
    if (isOutput || OUTPUT_FUNCS.has(name)) return { n: 'print', name, args, ty: 'int', line };
    const fn = this.functions.get(name);
    if (fn) {
      if (args.length !== fn.params.length) this.fail(`'${name}' takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'} but ${args.length} given`, line);
      fn.params.forEach((prm, i) => {
        if (prm.isRef && !this.isLvalue(args[i])) this.fail(`argument ${i + 1} of '${name}' must be a variable (it is a reference parameter)`, line);
        if (prm.isArray && !(args[i].n === 'id' && args[i].info.isArray)) this.fail(`argument ${i + 1} of '${name}' must be an array`, line);
      });
      return { n: 'call', name, fn, args, ty: fn.ret, line };
    }
    const lib = LIB[name];
    if (lib) {
      const want = { abs: 1, labs: 1, fabs: 1, min: 2, max: 2, constrain: 3, pow: 2, atan2: 2, fmod: 2, hypot: 2, map: 5 }[name] ?? 1;
      if (args.length !== want) this.fail(`'${name}' takes ${want} argument${want === 1 ? '' : 's'} but ${args.length} given`, line);
      return { n: 'lib', name, lib, args, ty: lib.ret(args.map((a) => a.ty)), line };
    }
    this.fail(`'${name}' was not declared in this scope`, line);
  }
}

/* ======================= interpreter ======================= */

const BREAK = { signal: 'break' };
const CONTINUE = { signal: 'continue' };

class Env {
  constructor(parent = null) { this.vars = new Map(); this.parent = parent; }
  find(name) {
    for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
    throw new CppError(`'${name}' is not available here`);
  }
}

const MAX_DEPTH = 200;

export class CppProgram {
  /** print(line): called with each printed line of text. */
  constructor(code, { print = () => {} } = {}) {
    const parser = new Parser(lex(code));
    parser.parseProgram();
    this.functions = parser.functions;
    this.print = print;
    this.out = '';
    this.depth = 0;
    this.global = new Env();
    this.paramCells = new Map();
    for (const decl of parser.globalDecls) this.execDecl(decl, this.global, true);
  }

  /* ---- public API ---- */

  /** Check the function the Code Lab needs. Returns an error text, or null if it is fine. */
  checkSignature(name, nIn, nOut, signature) {
    const fn = this.functions.get(name);
    if (!fn || !fn.body) return `Your code must define this function:  ${signature}`;
    const want = nIn + nOut;
    if (fn.params.length !== want) {
      return `${name}() should take ${want} parameters (${nIn} inputs, then ${nOut} outputs as references), but yours takes ${fn.params.length}.\nIt should look like:  ${signature}`;
    }
    for (let i = 0; i < nIn; i++) {
      if (fn.params[i].isRef) return `Parameter ${i + 1} ('${fn.params[i].name}') is an input, so it should be passed by value (no &).\nIt should look like:  ${signature}`;
    }
    for (let i = nIn; i < want; i++) {
      if (!fn.params[i].isRef) return `Parameter ${i + 1} ('${fn.params[i].name}') is an output, so it must be a reference — add a & before its name.\nIt should look like:  ${signature}`;
    }
    return null;
  }

  /** Call name(inputs..., &outputs...) and return the output values. */
  call(name, inputs, nOut) {
    const fn = this.functions.get(name);
    const cells = Array.from({ length: nOut }, (_, i) => ({ ty: fn.params[inputs.length + i].kind, v: 0 }));
    this.out = '';
    this.depth = 0;
    this.invoke(fn, [...inputs.map((v, i) => ({ ty: fn.params[i].kind, v: coerce(fn.params[i].kind, v) })), ...cells]);
    this.flushPrint();
    return cells.map((c) => c.v);
  }

  /** Numeric globals marked PARAM:  { name: { value, isInt } } */
  getParams() {
    const out = {};
    for (const [name, cell] of this.paramCells) out[name] = { value: cell.v, isInt: cell.ty === 'int' || cell.ty === 'bool' };
    return out;
  }

  setParam(name, value) {
    const cell = this.paramCells.get(name);
    if (cell) cell.v = coerce(cell.ty, value);
  }

  /* ---- output ---- */
  write(text) {
    this.out += text;
    let k;
    while ((k = this.out.indexOf('\n')) >= 0) { this.print(this.out.slice(0, k)); this.out = this.out.slice(k + 1); }
  }
  flushPrint() { if (this.out) { this.print(this.out); this.out = ''; } }

  /* ---- statements ---- */
  execDecl(node, env, isGlobal = false) {
    for (const d of node.decls) {
      if (d.isArray) {
        const items = d.init?.list;
        const size = d.size ? coerce('int', this.ev(d.size, env)) : items ? items.length : 0;
        if (size <= 0) throw new CppError(`array '${d.name}' needs a positive size`, d.line);
        if (items && items.length > size) throw new CppError(`too many initializers for '${d.name}'`, d.line);
        const arr = new Array(size).fill(0);
        if (items) items.forEach((e, i) => { arr[i] = coerce(d.kind, this.ev(e, env)); });
        env.vars.set(d.name, { ty: 'array', ety: d.kind, arr });
      } else {
        const cell = { ty: d.kind, v: 0 };
        if (d.init) cell.v = coerce(d.kind, this.ev(d.init, env));
        env.vars.set(d.name, cell);
        if (isGlobal && d.isParam) {
          if (d.kind === 'void') throw new CppError('PARAM must be a number', d.line);
          this.paramCells.set(d.name, cell);
        }
      }
    }
  }

  exec(node, env) {
    switch (node.n) {
      case 'block': {
        const inner = new Env(env);
        for (const s of node.body) { const r = this.exec(s, inner); if (r) return r; }
        return undefined;
      }
      case 'decl': this.execDecl(node, env); return undefined;
      case 'expr': this.ev(node.e, env); return undefined;
      case 'empty': return undefined;
      case 'if':
        if (this.ev(node.cond, env)) return this.exec(node.then, new Env(env));
        return node.otherwise ? this.exec(node.otherwise, new Env(env)) : undefined;
      case 'while':
        while (this.ev(node.cond, env)) {
          const r = this.exec(node.body, new Env(env));
          if (r === BREAK) break;
          if (r && r !== CONTINUE) return r;
        }
        return undefined;
      case 'dowhile':
        do {
          const r = this.exec(node.body, new Env(env));
          if (r === BREAK) break;
          if (r && r !== CONTINUE) return r;
        } while (this.ev(node.cond, env));
        return undefined;
      case 'for': {
        const loopEnv = new Env(env);
        if (node.init) this.exec(node.init, loopEnv);
        while (node.cond ? this.ev(node.cond, loopEnv) : true) {
          const r = this.exec(node.body, new Env(loopEnv));
          if (r === BREAK) break;
          if (r && r !== CONTINUE) return r;
          if (node.step) this.ev(node.step, loopEnv);
        }
        return undefined;
      }
      case 'return': return { signal: 'return', value: node.e ? coerce(node.kind, this.ev(node.e, env)) : 0 };
      case 'break': return BREAK;
      case 'continue': return CONTINUE;
      default: throw new CppError(`cannot run '${node.n}'`, node.line);
    }
  }

  invoke(fn, argCells) {
    if (++this.depth > MAX_DEPTH) throw new CppError('stack overflow — a function calls itself too many times', fn.line);
    const env = new Env(this.global);
    fn.params.forEach((prm, i) => env.vars.set(prm.name, argCells[i]));
    const r = this.exec(fn.body, env);
    this.depth--;
    return r && r.signal === 'return' ? r.value : 0;
  }

  /* ---- expressions ---- */

  /** The storage cell behind a variable or array element (for =, ++ and reference arguments). */
  cellOf(node, env) {
    if (node.n === 'id') return env.find(node.name);
    if (node.n === 'index') {
      const arr = env.find(node.base.name);
      const i = coerce('int', this.ev(node.idx, env));
      if (i < 0 || i >= arr.arr.length) throw new CppError(`index ${i} is outside the array '${node.base.name}' (size ${arr.arr.length})`, node.line);
      return {
        ty: arr.ety,
        get v() { return arr.arr[i]; },
        set v(x) { arr.arr[i] = x; },
      };
    }
    throw new CppError('not a variable', node.line);
  }

  ev(node, env) {
    switch (node.n) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'id': {
        const cell = env.find(node.name);
        if (cell.ty === 'array') throw new CppError(`'${node.name}' is an array; use ${node.name}[index]`, node.line);
        return cell.v;
      }
      case 'index': return this.cellOf(node, env).v;
      case 'unary': {
        const v = this.ev(node.e, env);
        switch (node.op) {
          case '-': return node.ty === 'int' ? -v | 0 : -v;
          case '+': return v;
          case '!': return v ? 0 : 1;
          default: return ~v;
        }
      }
      case 'logic': {
        const a = this.ev(node.a, env);
        if (node.op === '&&') return a && this.ev(node.b, env) ? 1 : 0;
        return a || this.ev(node.b, env) ? 1 : 0;
      }
      case 'bin': return this.binary(node, this.ev(node.a, env), this.ev(node.b, env));
      case 'cond': return coerce(node.ty, this.ev(node.cond, env) ? this.ev(node.a, env) : this.ev(node.b, env));
      case 'cast': return coerce(node.to, this.ev(node.e, env));
      case 'assign': {
        const cell = this.cellOf(node.target, env);
        let v = this.ev(node.e, env);
        if (node.op !== '=') {
          v = this.binary({ op: node.op.slice(0, -1), ty: promote(node.target.ty, node.e.ty), a: node.target, b: node.e, line: node.line }, cell.v, v);
        }
        cell.v = coerce(cell.ty, v);
        return cell.v;
      }
      case 'incdec': {
        const cell = this.cellOf(node.target, env);
        const old = cell.v;
        cell.v = coerce(cell.ty, old + (node.op === '++' ? 1 : -1));
        return node.prefix ? cell.v : old;
      }
      case 'lib': {
        const vals = node.args.map((a) => this.ev(a, env));
        try {
          return coerce(node.ty, node.lib.fn(...vals));
        } catch (e) {
          if (e instanceof CppError && e.line === null) e.line = node.line;
          throw e;
        }
      }
      case 'call': return this.callUser(node, env);
      case 'print': return this.doPrint(node, env);
      case 'out': { // cout << a << b
        this.ev(node.left, env);
        this.write(this.format(this.ev(node.right, env), node.right.ty));
        return 0;
      }
      case 'stream': return 0;
      default: throw new CppError(`cannot evaluate '${node.n}'`, node.line);
    }
  }

  binary(node, a, b) {
    const ty = node.ty;
    switch (node.op) {
      case '+': return ty === 'int' ? (a + b) | 0 : coerce(ty, a + b);
      case '-': return ty === 'int' ? (a - b) | 0 : coerce(ty, a - b);
      case '*': return ty === 'int' ? Math.imul(a, b) : coerce(ty, a * b);
      case '/':
        if (ty === 'int') {
          if (b === 0) throw new CppError('division by zero', node.line);
          return Math.trunc(a / b) | 0;
        }
        return coerce(ty, a / b);
      case '%':
        if (b === 0) throw new CppError('division by zero (in %)', node.line);
        return (a % b) | 0;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': return a << b;
      case '>>': return a >> b;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      default: throw new CppError(`unknown operator ${node.op}`, node.line);
    }
  }

  callUser(node, env) {
    const fn = node.fn;
    if (!fn.body) throw new CppError(`function '${fn.name}' is declared but never defined`, node.line);
    const cells = fn.params.map((prm, i) => {
      const arg = node.args[i];
      if (prm.isArray) return env.find(arg.name);
      if (prm.isRef) return this.cellOf(arg, env);
      return { ty: prm.kind, v: coerce(prm.kind, this.ev(arg, env)) };
    });
    return this.invoke(fn, cells);
  }

  /* ---- printing ---- */
  format(v, ty) {
    if (typeof v === 'string') return v;
    if (ty === 'float' || ty === 'double') return fmtG(v);
    return String(v);
  }

  doPrint(node, env) {
    const vals = node.args.map((a) => this.ev(a, env));
    const tys = node.args.map((a) => a.ty);
    switch (node.name) {
      case 'printf': case 'Serial.printf': this.write(printf(vals[0], vals.slice(1))); break;
      case 'puts': this.write(`${vals[0]}\n`); break;
      case 'Serial.begin': break;
      case 'Serial.print': this.write(this.format(vals[0], tys[0])); break;
      case 'Serial.println': this.write(`${vals.length ? this.format(vals[0], tys[0]) : ''}\n`); break;
      default: break;
    }
    return 0;
  }
}

/* ======================= formatting ======================= */

function fmtG(v) { // like C++ cout for doubles: 6 significant digits
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  const s = Number(v.toPrecision(6));
  return String(s);
}

function printf(fmt, args) {
  let k = 0;
  return String(fmt).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(l|ll|h|z)?([diufFeEgGxXcs%])/g, (m, flags, width, prec, _len, conv) => {
    if (conv === '%') return '%';
    const a = args[k++];
    let s;
    switch (conv) {
      case 'd': case 'i': case 'u': s = String(Math.trunc(Number(a))); break;
      case 'f': case 'F': s = Number(a).toFixed(prec === undefined ? 6 : Number(prec)); break;
      case 'e': case 'E': s = Number(a).toExponential(prec === undefined ? 6 : Number(prec)); break;
      case 'g': case 'G': s = fmtG(Number(a)); break;
      case 'x': s = (Number(a) >>> 0).toString(16); break;
      case 'X': s = (Number(a) >>> 0).toString(16).toUpperCase(); break;
      case 'c': s = typeof a === 'number' ? String.fromCharCode(a) : String(a); break;
      default: s = String(a);
    }
    if (flags.includes('+') && Number(a) >= 0 && 'dfFeE'.includes(conv)) s = `+${s}`;
    if (width) s = flags.includes('-') ? s.padEnd(Number(width)) : s.padStart(Number(width), flags.includes('0') ? '0' : ' ');
    return s;
  });
}
