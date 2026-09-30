// ============================================================
// Data-source adapters. To connect a new government dataset, implement
// `fetch()` returning plain records that match adapters/schemas.js, and
// register the adapter below. Engines never read files/URLs directly.
// ============================================================
import { readFileSync, existsSync } from 'fs';
import { dbRows } from '../database/db.js';
import { upsertDataSource, upsertRegion, upsertAsset, upsertInvestment, audit, getRegions } from '../database/devdb.js';
import { validateRecords, SCHEMAS } from './schemas.js';
import { getInstance } from '../intelligence/config.js';

export class DataSourceAdapter {
  constructor(options = {}) { this.options = options; }
  get id() { return this.constructor.adapterId; }
  async fetch() { throw new Error('fetch() not implemented'); }
}

export class JsonFileAdapter extends DataSourceAdapter {
  static adapterId = 'json-file';
  async fetch() {
    if (!this.options.path || !existsSync(this.options.path)) throw new Error(`File not found: ${this.options.path}`);
    return JSON.parse(readFileSync(this.options.path, 'utf8'));
  }
}
export class InlineJsonAdapter extends DataSourceAdapter {
  static adapterId = 'inline-json';
  async fetch() { return this.options.records; }
}

export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(c => c !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), coerce(r[i])])));
}
function coerce(v) {
  if (v === undefined || v === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[\[{]/.test(v)) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
export class InlineCsvAdapter extends DataSourceAdapter {
  static adapterId = 'inline-csv';
  async fetch() { return parseCsv(this.options.csv || ''); }
}

/** HTTP JSON adapter with an explicit host allow-list (SSRF protection). */
export class HttpJsonAdapter extends DataSourceAdapter {
  static adapterId = 'http-json';
  async fetch() {
    const url = new URL(this.options.url);
    const allowed = (process.env.DATA_ADAPTER_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) throw new Error('Only https URLs are allowed');
    if (!allowed.includes(url.hostname)) throw new Error(`Host ${url.hostname} is not in DATA_ADAPTER_ALLOWED_HOSTS`);
    const res = await fetch(url, { headers: this.options.headers || {}, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
    const data = await res.json();
    return this.options.recordsPath ? this.options.recordsPath.split('.').reduce((o, k) => o?.[k], data) : data;
  }
}

/** GeoJSON boundary adapter: polygons -> regions (centroid + equivalent radius + geometry). Population/area from properties. */
export class GeoJsonBoundaryAdapter extends DataSourceAdapter {
  static adapterId = 'geojson-boundaries';
  async fetch() {
    const fc = this.options.geojson || JSON.parse(readFileSync(this.options.path, 'utf8'));
    const m = this.options.propertyMap || { id: 'id', name: 'name', population: 'population', areaKm2: 'areaKm2' };
    return (fc.features || []).map(f => {
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length, lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const area = f.properties[m.areaKm2];
      return { id: f.properties[m.id], name: f.properties[m.name], lat, lng, population: f.properties[m.population], areaKm2: area,
        radiusKm: area ? Math.sqrt(area / Math.PI) : 2, geometry: f.geometry, countryCode: this.options.countryCode || getInstance().country };
    });
  }
}

export const ADAPTERS = Object.fromEntries([JsonFileAdapter, InlineJsonAdapter, InlineCsvAdapter, HttpJsonAdapter, GeoJsonBoundaryAdapter].map(a => [a.adapterId, a]));
export function listAdapters() { return Object.keys(ADAPTERS); }

/**
 * Import a dataset through an adapter: fetch -> validate -> upsert -> register source -> audit.
 * Invalid records are reported and skipped (never silently accepted).
 */
export async function importDataset({ type, adapter, options = {}, source = {}, actor = { type: 'system', id: null } }) {
  if (!SCHEMAS[type]) throw new Error(`Unknown dataset type "${type}". Use one of: ${Object.keys(SCHEMAS).join(', ')}`);
  const A = ADAPTERS[adapter];
  if (!A) throw new Error(`Unknown adapter "${adapter}". Available: ${listAdapters().join(', ')}`);
  const inst = getInstance();
  const raw = await new A(options).fetch();
  const regionIds = new Set(getRegions().map(r => r.id));
  if (type === 'regions') (Array.isArray(raw) ? raw : []).forEach(r => regionIds.add(r?.id));
  const { valid, errors } = validateRecords(type, raw, { regionIds });
  const isSynthetic = !!source.isSynthetic;
  const sourceId = source.id || `${type}-${adapter}-${Date.now().toString(36)}`;
  for (const r of valid) {
    const rec = { ...r, sourceId, isSynthetic };
    if (type === 'regions') upsertRegion({ countryCode: inst.country, level: inst.adminLevels?.at(-1) || 'ward', ...rec });
    else if (type === 'assets') upsertAsset(rec);
    else upsertInvestment({ currency: inst.countryInfo.currency.code, ...rec });
  }
  upsertDataSource({ id: sourceId, name: source.name || sourceId, kind: type, adapter, description: source.description || SCHEMAS[type].description,
    license: source.license || '', isSynthetic, recordCount: valid.length, status: errors.length ? 'partial' : 'ok', config: { ...options, records: undefined, csv: undefined, geojson: undefined, headers: undefined } });
  audit({ actorType: actor.type, actorId: actor.id, action: 'dataset.import', entityType: 'data_source', entityId: sourceId, details: { type, adapter, imported: valid.length, rejected: errors.length, isSynthetic } });
  return { sourceId, type, imported: valid.length, rejected: errors.length, errors: errors.slice(0, 25), isSynthetic };
}
