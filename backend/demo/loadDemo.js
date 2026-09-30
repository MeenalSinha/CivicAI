// ============================================================
// Demonstration dataset loader (Judge Mode needs no manual DB editing).
// Everything loaded here is labelled SYNTHETIC in data_sources and in the UI.
// Structural datasets go through the SAME adapters a real deployment would use.
// ============================================================
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as dev from '../database/devdb.js';
import { dbRun } from '../database/db.js';
import { JsonFileAdapter, InlineJsonAdapter, importDataset, ADAPTERS } from '../adapters/index.js';
import { getInstance, SAMPLE_DIR } from '../intelligence/config.js';
import { normalizeRequest } from '../intelligence/normalize.js';
import { generateSyntheticRequests } from './synthetic.js';
import { backfillLegacyComplaints } from '../intelligence/intake.js';
import { runPipeline } from '../intelligence/pipeline.js';

/** Sample datasets express dates as "T-55d" / "T+150d" so the demo stays fresh; resolved at load time. */
export function resolveRelativeDates(records, now = new Date()) {
  const conv = v => {
    const m = typeof v === 'string' && v.match(/^T([+-])(\d+)d$/);
    return m ? new Date(now.getTime() + (m[1] === '+' ? 1 : -1) * Number(m[2]) * 86_400_000).toISOString().slice(0, 10) : v;
  };
  return records.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, conv(v)])));
}

class RelativeDateJsonAdapter extends JsonFileAdapter {
  static adapterId = 'json-file-relative-dates';
  async fetch() { return resolveRelativeDates(await super.fetch()); }
}
ADAPTERS[RelativeDateJsonAdapter.adapterId] = RelativeDateJsonAdapter;

export function demoDataDir() {
  const inst = getInstance();
  return join(SAMPLE_DIR, inst.id);
}

export async function loadStructuralDemoData(actor = { type: 'system', id: 'demo-loader' }) {
  const inst = getInstance();
  const dir = demoDataDir();
  const label = inst.dataLabel || 'SYNTHETIC DEMONSTRATION DATA';
  const common = { isSynthetic: true, license: 'Synthetic - created for demonstration; not real government data' };
  const results = [];
  results.push(await importDataset({ type: 'regions', adapter: 'json-file', options: { path: join(dir, 'regions.json') }, source: { ...common, id: 'demo-regions', name: 'Demo regions & population (synthetic)', description: label }, actor }));
  results.push(await importDataset({ type: 'assets', adapter: 'json-file', options: { path: join(dir, 'assets.json') }, source: { ...common, id: 'demo-infrastructure', name: 'Demo infrastructure indicators (synthetic)', description: label }, actor }));
  results.push(await importDataset({ type: 'investments', adapter: 'json-file-relative-dates', options: { path: join(dir, 'investments.json') }, source: { ...common, id: 'demo-investments', name: 'Demo public investments (synthetic)', description: label }, actor }));
  return results;
}

export function insertSyntheticRequests(now = new Date()) {
  const regions = dev.getRegions();
  const reqs = generateSyntheticRequests(regions, now);
  let inserted = 0;
  for (const r of reqs) {
    const n = normalizeRequest({ ...r, regions, sourceId: 'demo-synthetic-requests' });
    dev.insertRequest({ id: `REQ-S${uuidv4().replace(/-/g, '').slice(0, 9)}`, ...n, description: n.descriptionRedacted, createdAt: n.timestamp, complaintId: null });
    inserted++;
  }
  dev.upsertDataSource({ id: 'demo-synthetic-requests', name: 'Demo citizen requests (synthetic, multilingual)', kind: 'citizen_requests', adapter: 'synthetic-generator',
    description: 'Reproducible synthetic Hindi/Hinglish/English requests. Every classification, cluster and score is computed by the real pipeline.', license: 'Synthetic', isSynthetic: true, recordCount: inserted });
  return inserted;
}

export function clearSyntheticRequests() {
  dbRun(`DELETE FROM citizen_requests WHERE sourceId = 'demo-synthetic-requests'`);
}

/** Load (or refresh when stale) the demo instance. Safe to call on every boot. */
export async function ensureDemoData({ force = false, now = new Date() } = {}) {
  const regions = dev.getRegions();
  const syntheticRows = dev.getRequests().filter(r => r.sourceId === 'demo-synthetic-requests');
  const newest = syntheticRows.length ? Math.max(...syntheticRows.map(r => new Date(r.createdAt).getTime())) : 0;
  const stale = !syntheticRows.length || now.getTime() - newest > 36 * 3600_000;
  if (!force && regions.length && !stale) return { loaded: false, reason: 'demo data present and fresh' };
  await loadStructuralDemoData();
  if (syntheticRows.length) clearSyntheticRequests();
  const inserted = insertSyntheticRequests(now);
  const backfilled = backfillLegacyComplaints();
  const run = runPipeline({ trigger: 'demo-load' });
  dev.audit({ action: 'demo.load', entityType: 'data_source', entityId: 'demo', details: { syntheticRequests: inserted, legacyBackfilled: backfilled, refreshed: syntheticRows.length > 0 } });
  return { loaded: true, syntheticRequests: inserted, legacyBackfilled: backfilled, pipeline: run.stats };
}
