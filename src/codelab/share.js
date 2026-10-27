// Saving to localStorage (per drive type) and share links (code compressed into the URL hash).
import LZString from 'lz-string';

// Python keeps the original key names, so code saved before C++ existed is still found.
const suffix = (lang) => (lang === 'cpp' ? ':cpp' : '');
const KEY = (drive, lang) => `robocon-codelab:v1:code:${drive}${suffix(lang)}`;
const BACKUP_KEY = (drive, lang) => `robocon-codelab:v1:backup:${drive}${suffix(lang)}`;
const LANG_KEY = 'robocon-codelab:v1:lang';

// localStorage can be blocked (private windows, school lockdowns): never let that break the page.
export function loadSaved(drive, lang = 'python') {
  try { return localStorage.getItem(KEY(drive, lang)); } catch { return null; }
}
export function saveCode(drive, code, lang = 'python') {
  try { localStorage.setItem(KEY(drive, lang), code); } catch { /* ignore */ }
}
export function backupCode(drive, code, lang = 'python') {
  try { localStorage.setItem(BACKUP_KEY(drive, lang), code); } catch { /* ignore */ }
}
export function loadLang() {
  try { return localStorage.getItem(LANG_KEY) === 'cpp' ? 'cpp' : 'python'; } catch { return 'python'; }
}
export function saveLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
}

/** base = the page URL without any hash, e.g. https://user.github.io/robocon-drive-simulator/codelab.html */
export function buildShareLink(base, code, drive, lang = 'python') {
  const langPart = lang === 'cpp' ? '&lang=cpp' : ''; // Python links stay exactly as before
  return `${base}#drive=${drive}${langPart}&code=${LZString.compressToEncodedURIComponent(code)}`;
}

/** Returns { drive, lang, code } or null if the hash is not a share link. */
export function parseShareHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const packed = params.get('code');
  const drive = params.get('drive');
  if (!packed || !['skid', 'mecanum', 'omni'].includes(drive)) return null;
  const lang = params.get('lang') === 'cpp' ? 'cpp' : 'python';
  // URLSearchParams turns "+" into a space; the compressed alphabet uses "+", so turn them back.
  try {
    const code = LZString.decompressFromEncodedURIComponent(packed.replace(/ /g, '+'));
    return code ? { drive, lang, code } : null;
  } catch {
    return null; // a damaged link must never break the page
  }
}
