// ============================================================
// CivicAI Intelligence - Instance & registry configuration
// Nothing country- or city-specific is hardcoded in the engines;
// everything is resolved through the active instance config.
// ============================================================
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONFIG_DIR = join(__dirname, '..', 'config');
export const SAMPLE_DIR = join(__dirname, '..', 'data', 'samples');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let _instance = null;
let _countries = null;

export function getCountries() {
  if (!_countries) _countries = readJson(join(CONFIG_DIR, 'countries.json')).countries;
  return _countries;
}

export function loadInstanceById(id) {
  const dirCfg = join(CONFIG_DIR, 'instances', id, 'instance.json');
  const fileCfg = join(CONFIG_DIR, 'instances', `${id}.json`);
  const path = existsSync(dirCfg) ? dirCfg : existsSync(fileCfg) ? fileCfg : null;
  if (!path) throw new Error(`Instance config not found: ${id}`);
  const cfg = readJson(path);
  const country = getCountries().find(c => c.code === cfg.country);
  if (!country) throw new Error(`Instance ${id} references unknown country ${cfg.country}`);
  return { ...cfg, countryInfo: country, _dir: existsSync(dirCfg) ? dirname(dirCfg) : null };
}

export function getInstance() {
  if (!_instance) _instance = loadInstanceById(process.env.CIVICAI_INSTANCE || 'in-demo');
  return _instance;
}

/** Test/BRICS-pluggability hook: swap the active instance at runtime. */
export function setInstance(cfgOrId) {
  _instance = typeof cfgOrId === 'string' ? loadInstanceById(cfgOrId) : cfgOrId;
  return _instance;
}

export function formatMoney(amount, instance = getInstance()) {
  const cur = instance.countryInfo?.currency || { symbol: '', code: '' };
  if (amount == null || isNaN(amount)) return 'n/a';
  const abs = Math.abs(amount);
  // Scale per the country's convention; falls back to millions.
  if (cur.unitScale === 'crore') {
    if (abs >= 1e7) return `${cur.symbol}${(amount / 1e7).toFixed(1)} crore`;
    if (abs >= 1e5) return `${cur.symbol}${(amount / 1e5).toFixed(1)} lakh`;
  } else if (cur.unitScale === 'billion' && abs >= 1e9) {
    return `${cur.symbol}${(amount / 1e9).toFixed(1)} billion`;
  } else if (abs >= 1e6) {
    return `${cur.symbol}${(amount / 1e6).toFixed(1)} million`;
  }
  return `${cur.symbol}${Math.round(amount).toLocaleString('en-US')}`;
}

// ---- Tunable scoring configuration (weights are configurable) ----
export const DEFAULT_WEIGHTS = {
  version: 'demand-v1',
  demand: { volume: 0.20, growth: 0.15, persistence: 0.12, concentration: 0.10, population: 0.15, urgency: 0.16, support: 0.12 },
  priority: { demand: 0.22, gap: 0.20, population: 0.12, urgency: 0.08, safety: 0.10, persistence: 0.06, growth: 0.06, investmentGap: 0.10, equity: 0.06 },
  params: {
    windowDays: 30,            // growth comparison window
    persistenceWeeks: 12,      // weeks considered for persistence
    perCapitaCap: 12,          // requests per 10k residents that saturates volume
    absoluteVolumeCap: 40,     // absolute request count that saturates the log-volume term
    populationCap: 150000,     // affected population that saturates population term
    supportCap: 150,           // upvotes that saturate support term
    clusterEpsKm: 1.2,         // spatial clustering radius
    duplicateSimilarity: 0.8,  // Jaccard threshold for near-duplicate text
    duplicateWindowHours: 48,
    spamPerHour: 15,           // max submissions per submitter per hour
    highDemand: 55,            // demand score threshold for "high demand"
    limitedInvestment: 0.2,    // coverage below this is "limited mapped investment"
    kAnonymity: 3,
    reviewConfidenceFloor: 0.5
  }
};

export function normalizeWeights(w) {
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / sum]));
}

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 2) => (x == null || isNaN(x)) ? null : Math.round(x * 10 ** d) / 10 ** d;
