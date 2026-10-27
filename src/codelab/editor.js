// CodeMirror 6 code editor: Python highlighting, line numbers, 4-space indent, error-line highlight.
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField, Annotation, Compartment } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';

// Marks changes we made ourselves (loading an example, moving a slider) so they do not count as "student typed".
const programmatic = Annotation.define();
const setErrorLine = StateEffect.define();

const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        const n = e.value;
        deco = n && n <= tr.state.doc.lines
          ? Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(tr.state.doc.line(n).from)])
          : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const MIN_FONT = 18, MAX_FONT = 40;
const languageFor = (lang) => (lang === 'cpp' ? cpp() : python());

/** onChange(byStudent: boolean) fires on every document change. */
export function createEditor(parent, { doc = '', onChange = () => {}, fontSize = 20, lang = 'python' } = {}) {
  const language = new Compartment();
  parent.style.setProperty('--editor-font', `${fontSize}px`);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        language.of(languageFor(lang)),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        keymap.of([indentWithTab]),
        errorLineField,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const mine = u.transactions.some((t) => t.annotation(programmatic));
            // Typing moves the error line, so the old highlight would point at the wrong code: clear it.
            if (!mine) clearError();
            onChange(!mine);
          }
        }),
      ],
    }),
  });

  let size = fontSize;

  function clearError() {
    if (view.state.field(errorLineField).size) view.dispatch({ effects: setErrorLine.of(null), annotations: programmatic.of(true) });
  }

  return {
    view,
    getCode: () => view.state.doc.toString(),
    /** Replace the whole text. */
    setCode(code) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
        annotations: programmatic.of(true),
        effects: setErrorLine.of(null),
      });
    },
    showError(line) {
      if (line) view.dispatch({ effects: setErrorLine.of(line), scrollIntoView: false });
    },
    clearError,
    changeFont(delta) {
      size = Math.max(MIN_FONT, Math.min(MAX_FONT, size + delta));
      parent.style.setProperty('--editor-font', `${size}px`);
      view.requestMeasure();
      return size;
    },
    setLanguage(lang) { view.dispatch({ effects: language.reconfigure(languageFor(lang)) }); },
    /**
     * Update the number of one tunable value in the text.
     * Python:  "deadzone": 8  ->  "deadzone": 12      C++:  PARAM int deadzone = 8;  ->  = 12;
     */
    setParamValue(key, value, isInt, lang = 'python') {
      const text = view.state.doc.toString();
      const name = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const number = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
      const re = lang === 'cpp'
        ? new RegExp(`(PARAM\\s+[\\w ]*?\\b${name}\\s*=\\s*)${number}`)
        : new RegExp(`(["']${name}["']\\s*:\\s*)${number}`);
      const m = re.exec(text);
      if (!m) return false;
      const from = m.index + m[1].length;
      view.dispatch({ changes: { from, to: from + m[2].length, insert: formatNumber(value, isInt) }, annotations: programmatic.of(true) });
      return true;
    },
    focus: () => view.focus(),
  };
}

export function formatNumber(value, isInt) {
  if (isInt) return String(Math.round(value));
  const s = (Math.round(value * 100) / 100).toString();
  return s.includes('.') ? s : `${s}.0`;
}
