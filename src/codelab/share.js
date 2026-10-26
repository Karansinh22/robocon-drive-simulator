// Saving to localStorage (per drive type) and share links (code compressed into the URL hash).
import LZString from 'lz-string';

const KEY = (drive) => `robocon-codelab:v1:code:${drive}`;
const BACKUP_KEY = (drive) => `robocon-codelab:v1:backup:${drive}`;

// localStorage can be blocked (private windows, school lockdowns): never let that break the page.
export function loadSaved(drive) {
  try { return localStorage.getItem(KEY(drive)); } catch { return null; }
}
export function saveCode(drive, code) {
  try { localStorage.setItem(KEY(drive), code); } catch { /* ignore */ }
}
export function backupCode(drive, code) {
  try { localStorage.setItem(BACKUP_KEY(drive), code); } catch { /* ignore */ }
}

/** base = the page URL without any hash, e.g. https://user.github.io/robocon-drive-simulator/codelab.html */
export function buildShareLink(base, code, drive) {
  return `${base}#drive=${drive}&code=${LZString.compressToEncodedURIComponent(code)}`;
}

/** Returns { drive, code } or null if the hash is not a share link. */
export function parseShareHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const packed = params.get('code');
  const drive = params.get('drive');
  if (!packed || (drive !== 'skid' && drive !== 'mecanum')) return null;
  // URLSearchParams turns "+" into a space; the compressed alphabet uses "+", so turn them back.
  try {
    const code = LZString.decompressFromEncodedURIComponent(packed.replace(/ /g, '+'));
    return code ? { drive, code } : null;
  } catch {
    return null; // a damaged link must never break the page
  }
}
