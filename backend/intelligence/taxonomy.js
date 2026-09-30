// ============================================================
// Development-need taxonomy engine.
// Deterministic, multilingual, config-driven. LLM is only consulted
// (in normalize.js) when confidence here is low.
// ============================================================
import { readJson, CONFIG_DIR, clamp } from './config.js';
import { getLanguages } from './language.js';
import { join } from 'path';
import { readdirSync, existsSync } from 'fs';

let _tax = null;
let _index = null;

export function loadTaxonomy(force = false) {
  if (_tax && !force) return _tax;
  _tax = readJson(join(CONFIG_DIR, 'taxonomy.json'));
  // Merge language lexicon overlays (config/lexicons/*.json)
  const dir = join(CONFIG_DIR, 'lexicons');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const lang = f.replace('.json', '');
      const overlay = readJson(join(dir, f));
      for (const [key, words] of Object.entries(overlay)) {
        if (key.startsWith('_')) continue;
        const [catId, subId] = key.split('.');
        const cat = _tax.categories.find(c => c.id === catId);
        if (!cat) continue;
        const target = subId ? cat.subcategories.find(s => s.id === subId) : cat;
        if (!target) continue;
        target.keywords = target.keywords || {};
        target.keywords[lang] = [...(target.keywords[lang] || []), ...words];
      }
    }
  }
  _index = null;
  return _tax;
}

/** Runtime extension: add a category/subcategory without touching engine code. */
export function extendTaxonomy({ categoryId, label, subcategory }) {
  const tax = loadTaxonomy();
  let cat = tax.categories.find(c => c.id === categoryId);
  if (!cat) {
    cat = { id: categoryId, label: label || categoryId, safetyWeight: 0.3, keywords: {}, interventions: [], subcategories: [] };
    tax.categories.splice(tax.categories.length - 1, 0, cat); // keep "other" last
  }
  if (subcategory) {
    const existing = cat.subcategories.find(s => s.id === subcategory.id);
    if (existing) Object.assign(existing, subcategory); else cat.subcategories.push(subcategory);
  }
  _index = null;
  return cat;
}

export function getCategory(id) { return loadTaxonomy().categories.find(c => c.id === id) || null; }
export function getSubcategory(catId, subId) { return getCategory(catId)?.subcategories.find(s => s.id === subId) || null; }
export function categoryLabel(id) { return getCategory(id)?.label || id; }
export function isValidCategory(id, subId) {
  const c = getCategory(id);
  return !!c && (!subId || c.subcategories.some(s => s.id === subId));
}

function buildIndex() {
  const tax = loadTaxonomy();
  const entries = [];
  const norm = s => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  for (const cat of tax.categories) {
    for (const [lang, words] of Object.entries(cat.keywords || {})) {
      for (const w of words) entries.push({ cat: cat.id, sub: null, lang, kw: norm(w), level: 'category' });
    }
    for (const sub of cat.subcategories) {
      for (const [lang, words] of Object.entries(sub.keywords || {})) {
        for (const w of words) entries.push({ cat: cat.id, sub: sub.id, lang, kw: norm(w), level: 'sub' });
      }
    }
  }
  _index = entries;
  return entries;
}

const NON_LATIN = /[^\u0000-\u024F]/;
function matches(text, kw) {
  if (!kw) return false;
  if (NON_LATIN.test(kw)) return text.includes(kw);
  // Latin: match on word-boundaries; allow simple plural / suffix on the last word
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}[a-z]{0,2}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Classify free text into (category, subcategory) with evidence. */
export function classifyText(text) {
  const entries = _index || buildIndex();
  const t = String(text || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
  const subScores = new Map(); // "cat.sub" -> {cat,sub,max,count,terms}
  const catScores = new Map(); // cat -> {max,count,terms}

  for (const e of entries) {
    if (!matches(t, e.kw)) continue;
    const words = e.kw.split(' ').length;
    if (e.level === 'sub') {
      const k = `${e.cat}.${e.sub}`;
      const s = subScores.get(k) || { cat: e.cat, sub: e.sub, max: 0, count: 0, terms: [] };
      s.max = Math.max(s.max, words); s.count++; s.terms.push(e.kw); subScores.set(k, s);
    } else {
      const s = catScores.get(e.cat) || { cat: e.cat, max: 0, count: 0, terms: [] };
      s.max = Math.max(s.max, words); s.count++; s.terms.push(e.kw); catScores.set(e.cat, s);
    }
  }

  const cands = [];
  for (const s of subScores.values()) {
    const catBonus = catScores.get(s.cat) ? 0.3 : 0;
    cands.push({ cat: s.cat, sub: s.sub, score: s.max + 0.3 * (s.count - 1) + catBonus, terms: s.terms });
  }
  for (const s of catScores.values()) {
    if (!cands.some(c => c.cat === s.cat)) cands.push({ cat: s.cat, sub: null, score: 0.5 * s.max + 0.15 * (s.count - 1), terms: s.terms });
  }
  if (!cands.length) {
    return { category: 'other', subcategory: 'general', confidence: 0.3, matchedTerms: [], method: 'lexicon-none', alternatives: [] };
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0], second = cands[1];
  const margin = second ? (top.score - second.score) / Math.max(top.score, 1) : 1;
  let confidence = 0.45 + 0.11 * Math.min(top.score, 3) + 0.2 * margin;
  if (!top.sub) confidence -= 0.1;
  confidence = clamp(confidence, 0.3, 0.96);
  return {
    category: top.cat,
    subcategory: top.sub || 'general',
    confidence: Math.round(confidence * 100) / 100,
    matchedTerms: [...new Set(top.terms)].slice(0, 6),
    method: 'lexicon-v1',
    alternatives: cands.slice(1, 3).map(c => ({ category: c.cat, subcategory: c.sub || 'general', score: Math.round(c.score * 100) / 100 }))
  };
}

// ---- Legacy bridge: keep the existing complaint table/UI working ----
export function legacyIssueType(catId, subId) {
  const sub = getSubcategory(catId, subId);
  if (sub?.legacyIssueType) return sub.legacyIssueType;
  const map = { roads_transport: 'Damaged Infrastructure', waste_management: 'Garbage Overflow', electricity: 'Broken Streetlight', water_supply: 'Water Leakage', drainage_flood: 'Water Leakage' };
  return map[catId] || 'Other';
}

/** Reverse bridge: map an old issueType (from Mistral / vision / rules) into the new taxonomy. */
export function fromLegacyIssueType(issueType) {
  const m = {
    'Pothole': ['roads_transport', 'pothole'],
    'Garbage Overflow': ['waste_management', 'garbage_overflow'],
    'Broken Streetlight': ['electricity', 'streetlight'],
    'Water Leakage': ['water_supply', 'pipe_leak'],
    'Damaged Infrastructure': ['roads_transport', 'road_damage'],
    'Other': ['other', 'general']
  };
  const [category, subcategory] = m[issueType] || m.Other;
  return { category, subcategory };
}

export function listTaxonomy() {
  return loadTaxonomy().categories.map(c => ({
    id: c.id, label: c.label,
    subcategories: c.subcategories.map(s => ({ id: s.id, label: s.label }))
  }));
}
export function supportedLanguageCodes() { return getLanguages().map(l => l.code); }
