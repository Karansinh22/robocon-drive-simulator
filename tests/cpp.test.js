import { describe, it, expect } from 'vitest';
import { CppProgram, CppError } from '../src/codelab/cpp/interpreter.js';
import { EXAMPLES } from '../src/codelab/examples.js';

const SKID_SIG = 'void mix(int x, int y, int &left, int &right)';
const MEC_SIG = 'void mix4(int x, int y, int r, int &fl, int &fr, int &rl, int &rr)';
const run = (code, fn, inputs, nOut, print) => new CppProgram(code, { print }).call(fn, inputs, nOut);
const compileError = (code) => { try { new CppProgram(code); } catch (e) { return e; } return null; };

describe('C++ interpreter: language basics', () => {
  it('integer division truncates, float division does not', () => {
    const code = `void f(int x, int &a, float &b, int &c) { a = 7 / 2; b = 7 / 2.0; c = x / 3; }`;
    expect(run(code, 'f', [-10], 3)).toEqual([3, 3.5, -3]);
  });
  it('assigning a float to an int truncates toward zero', () => {
    expect(run('void f(int x, int &a, int &b) { a = 2.9; b = -2.9; }', 'f', [0], 2)).toEqual([2, -2]);
  });
  it('round() rounds half away from zero', () => {
    expect(run('void f(int x, int &a, int &b, int &c) { a = round(2.5); b = round(-2.5); c = round(2.4); }', 'f', [0], 3)).toEqual([3, -3, 2]);
  });
  it('32-bit int wrap-around and % keep the sign of the left side', () => {
    expect(run('void f(int x, int &a, int &b) { a = 2147483647 + 1; b = -7 % 3; }', 'f', [0], 2)).toEqual([-2147483648, -1]);
  });
  it('if / else / for / while / do-while / break / continue', () => {
    const code = `void f(int n, int &a, int &b, int &c) {
      a = 0; for (int i = 0; i < 10; i++) { if (i == 3) continue; if (i == 6) break; a += i; }
      b = 0; int k = n; while (k > 0) { b++; k -= 2; }
      c = 0; do { c += 5; } while (c < 12);
    }`;
    expect(run(code, 'f', [7], 3)).toEqual([0 + 1 + 2 + 4 + 5, 4, 15]);
  });
  it('global variables keep their value between calls', () => {
    const p = new CppProgram('int count = 0; void f(int x, int &a) { count += x; a = count; }');
    expect(p.call('f', [5], 1)).toEqual([5]);
    expect(p.call('f', [5], 1)).toEqual([10]);
  });
  it('global arrays and local arrays with initializer lists', () => {
    const code = `float last[3] = {1, 2, 3};
      void f(int x, int &a, int &b) { int v[4] = {x, x * 2}; last[1] += 0.5; a = v[1] + v[3]; b = last[1] * 2; }`;
    expect(run(code, 'f', [4], 2)).toEqual([8, 5]);
  });
  it('functions, recursion and reference parameters', () => {
    const code = `
      int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
      void swap2(int &a, int &b) { int t = a; a = b; b = t; }
      void f(int x, int &p, int &q) { p = fact(x); q = 3; swap2(p, q); }`;
    expect(run(code, 'f', [5], 2)).toEqual([3, 120]);
  });
  it('arrays passed to functions are shared', () => {
    const code = `void fill(int a[], int n) { for (int i = 0; i < n; i++) a[i] = i * i; }
      void f(int x, int &r) { int v[5]; fill(v, 5); r = v[4]; }`;
    expect(run(code, 'f', [0], 1)).toEqual([16]);
  });
  it('casts, auto, constants, #define and the library', () => {
    const code = `#include <cmath>
      #define LIMIT 100
      const int k = 3;
      void f(int x, int &a, int &b, int &c, int &d) {
        auto h = sqrt(16.0);
        a = (int)(x * 1.5); b = constrain(x, -LIMIT, LIMIT); c = max(abs(-x), k) + min(2, 9); d = static_cast<int>(h) + int(2.7) + map(5, 0, 10, 0, 100);
      }`;
    expect(run(code, 'f', [300], 4)).toEqual([450, 100, 302, 4 + 2 + 50]);
  });
  it('std:: prefixes and using namespace are accepted', () => {
    const code = `#include <algorithm>\nusing namespace std;\nvoid f(int x, int &a) { a = std::max(std::abs(x), 2); }`;
    expect(run(code, 'f', [-7], 1)).toEqual([7]);
  });
  it('printing: cout, printf and Serial.println', () => {
    const lines = [];
    run(`void f(int x, int &a) { cout << "x=" << x << " half=" << x / 2.0 << endl; printf("%d|%5.2f|%s\\n", x, 3.14159, "hi"); Serial.println(x + 1); a = 0; }`, 'f', [3], 1, (l) => lines.push(l));
    expect(lines).toEqual(['x=3 half=1.5', '3| 3.14|hi', '4']);
  });
});

describe('C++ interpreter: PARAM tuning', () => {
  const code = `#define PARAM\nPARAM int deadzone = 8;\nPARAM float expo = 0.3;\nint hidden = 5;\nvoid f(int x, int &a) { a = abs(x) < deadzone ? 0 : x; }`;
  it('lists only PARAM variables and updates them live', () => {
    const p = new CppProgram(code);
    expect(p.getParams()).toEqual({ deadzone: { value: 8, isInt: true }, expo: { value: expect.closeTo(0.3, 5), isInt: false } });
    expect(p.call('f', [5], 1)).toEqual([0]);
    p.setParam('deadzone', 2);
    expect(p.call('f', [5], 1)).toEqual([5]);
  });
});

describe('C++ interpreter: errors', () => {
  it('reports syntax errors with the line', () => {
    const e = compileError('void f(int x, int &a) {\n  a = x\n}');
    expect(e).toBeInstanceOf(CppError);
    expect(e.line).toBe(2);
    expect(e.message).toMatch(/expected ';'/);
  });
  it('reports undeclared names', () => {
    const e = compileError('void f(int x, int &a) {\n  a = y;\n}');
    expect(e.message).toBe("'y' was not declared in this scope");
    expect(e.line).toBe(2);
  });
  it('reports division by zero at run time with the line', () => {
    const p = new CppProgram('void f(int x, int &a) {\n  a = 10 / x;\n}');
    expect(() => p.call('f', [0], 1)).toThrow(/division by zero/);
    try { p.call('f', [0], 1); } catch (e) { expect(e.line).toBe(2); }
  });
  it('reports array indexes that are out of range', () => {
    const p = new CppProgram('void f(int x, int &a) { int v[3]; a = v[x]; }');
    expect(() => p.call('f', [3], 1)).toThrow(/outside the array 'v'/);
  });
  it('explains unsupported features', () => {
    expect(compileError('void f(int x, int &a) { switch (x) { } }').message).toMatch(/switch/);
    expect(compileError('#define SQ(x) ((x)*(x))\nvoid f() {}').message).toMatch(/function-like/);
  });
  it('stops runaway recursion', () => {
    const p = new CppProgram('int g(int n) { return g(n + 1); } void f(int x, int &a) { a = g(0); }');
    expect(() => p.call('f', [0], 1)).toThrow(/stack overflow/);
  });
  it('checks the function signature the Code Lab needs', () => {
    const ok = new CppProgram('void mix(int x, int y, int &left, int &right) { left = y; right = y; }');
    expect(ok.checkSignature('mix', 2, 2, SKID_SIG)).toBeNull();
    expect(new CppProgram('void other() {}').checkSignature('mix', 2, 2, SKID_SIG)).toMatch(/must define/);
    expect(new CppProgram('void mix(int x, int y, int left, int right) {}').checkSignature('mix', 2, 2, SKID_SIG)).toMatch(/add a &/);
    expect(new CppProgram('void mix(int x, int y, int &left) {}').checkSignature('mix', 2, 2, SKID_SIG)).toMatch(/should take 4 parameters/);
  });
});

describe('C++ starter examples behave like the Python ones', () => {
  const cpp = (id) => EXAMPLES.find((e) => e.id === id).code;
  const approx = (got, want) => got.forEach((v, i) => expect(Math.abs(v - want[i]), `${got} vs ${want}`).toBeLessThanOrEqual(1));

  it('skid full', () => {
    const code = cpp('cpp-skid-full');
    const p = new CppProgram(code);
    expect(p.checkSignature('mix', 2, 2, SKID_SIG)).toBeNull();
    approx(p.call('mix', [0, 100], 2), [255, 255]);
    approx(p.call('mix', [100, 0], 2), [255, -255]);
    approx(p.call('mix', [50, 100], 2), [255, 85]);
    approx(p.call('mix', [-50, 100], 2), [85, 255]);
    approx(p.call('mix', [5, -100], 2), [-255, -255]);
    approx(p.call('mix', [0, 0], 2), [0, 0]);
  });
  it.each(['cpp-mecanum-full', 'cpp-omni-full'])('%s', (id) => {
    const p = new CppProgram(cpp(id));
    expect(p.checkSignature('mix4', 3, 4, MEC_SIG)).toBeNull();
    approx(p.call('mix4', [0, 100, 0], 4), [255, 255, 255, 255]);
    approx(p.call('mix4', [100, 0, 0], 4), [255, -255, -255, 255]);
    approx(p.call('mix4', [0, 0, 100], 4), [255, -255, 255, -255]);
    approx(p.call('mix4', [0, 100, 50], 4), [255, 85, 255, 85]);
    approx(p.call('mix4', [100, 100, 0], 4), [255, 0, 0, 255]);
    approx(p.call('mix4', [0, 0, 0], 4), [0, 0, 0, 0]);
  });
  it('mecanum tuning (ramp + expo) reaches full speed after a few calls', () => {
    const p = new CppProgram(cpp('cpp-mecanum-tuning'));
    expect(Object.keys(p.getParams())).toEqual(['deadzone', 'max_speed', 'expo', 'ramp']);
    p.setParam('expo', 0);
    let out;
    for (let i = 0; i < 12; i++) out = p.call('mix4', [0, 100, 0], 4);
    approx(out, [255, 255, 255, 255]);
    expect(new CppProgram(cpp('cpp-mecanum-tuning')).call('mix4', [0, 100, 0], 4)[0]).toBeLessThan(100); // ramp: first call is slow
  });
  it('every C++ example compiles and has the right function', () => {
    for (const ex of EXAMPLES.filter((e) => e.lang === 'cpp')) {
      const p = new CppProgram(ex.code);
      const skid = ex.drive === 'skid';
      expect(p.checkSignature(skid ? 'mix' : 'mix4', skid ? 2 : 3, skid ? 2 : 4, ''), ex.id).toBeNull();
    }
  });
});
