// Registry-driven language detection (no per-language code paths).
import { readJson, CONFIG_DIR } from './config.js';
import { join } from 'path';

let _langs = null;
export function getLanguages() {
  if (!_langs) _langs = readJson(join(CONFIG_DIR, 'languages.json')).languages;
  return _langs;
}
export function languageName(code) {
  return getLanguages().find(l => l.code === code)?.name || code;
}
// Legacy display names used by the existing complaint table
export function legacyLanguageName(code) {
  return languageName(code);
}

export function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}\u0900-\u097F]+/u).filter(Boolean);
}

export function detectLanguage(text) {
  const t = String(text || '');
  if (!t.trim()) return { code: 'en', name: 'English', confidence: 0.3, method: 'default' };
  const letters = [...t].filter(ch => /\p{L}/u.test(ch));
  const total = Math.max(letters.length, 1);
  // Script-based detection first
  for (const l of getLanguages().filter(l => l.detect.type === 'script')) {
    const re = new RegExp(l.detect.regex, 'g');
    const hits = (t.match(re) || []).length;
    if (hits / total >= (l.detect.minRatio ?? 0.25)) {
      return { code: l.code, name: l.name, confidence: Math.min(0.99, 0.7 + hits / total * 0.3), method: 'script' };
    }
  }
  // Marker-based detection for Latin-script languages
  const tokens = new Set(tokenize(t));
  let best = null;
  for (const l of getLanguages().filter(l => l.detect.type === 'markers')) {
    const hits = l.detect.markers.filter(m => tokens.has(m)).length;
    if (hits >= (l.detect.minHits ?? 2) && (!best || hits > best.hits)) best = { l, hits };
  }
  if (best) return { code: best.l.code, name: best.l.name, confidence: Math.min(0.95, 0.6 + best.hits * 0.08), method: 'markers' };
  const def = getLanguages().find(l => l.detect.type === 'latin-default');
  return { code: def?.code || 'en', name: def?.name || 'English', confidence: 0.75, method: 'default' };
}
