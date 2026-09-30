// ============================================================
// Multi-country / multi-instance demo management.
// Extends loadDemo.js with Brazil support and cross-country switching.
// The SAME intelligence engine runs for both instances — only the
// active configuration and data adapter change.
// ============================================================
import { join } from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as dev from '../database/devdb.js';
import { dbRun } from '../database/db.js';
import { JsonFileAdapter, ADAPTERS, importDataset } from '../adapters/index.js';
import { loadInstanceById, getInstance, setInstance, SAMPLE_DIR } from '../intelligence/config.js';
import { normalizeRequest } from '../intelligence/normalize.js';
import { generateBrazilSyntheticRequests } from './syntheticBrazil.js';
import { resolveRelativeDates } from './loadDemo.js';

// --- Relative-date JSON adapter (a separate ID so it doesn't conflict with the India loader) ---
class RelativeDateJsonAdapterMulti extends JsonFileAdapter {
  static adapterId = 'json-file-relative-dates-multi';
  async fetch() { return resolveRelativeDates(await super.fetch()); }
}
ADAPTERS[RelativeDateJsonAdapterMulti.adapterId] = RelativeDateJsonAdapterMulti;


/** Map of instance-id → synthetic source-id for foreign-country requests */
export const COUNTRY_SOURCE_IDS = {
  'in-demo': 'demo-synthetic-requests',        // handled by loadDemo.js
  'br-demo': 'br-demo-synthetic-requests',
};

/** Load structural data (regions, assets, investments) for any instance. */
export async function loadStructuralDataForInstance(instId, actor = { type: 'system', id: 'demo-loader' }) {
  const inst = loadInstanceById(instId);
  const dir = join(SAMPLE_DIR, instId);
  if (!existsSync(dir)) throw new Error(`No sample data directory for instance "${instId}"`);

  // Read metadata from first record of each file if present
  const getMeta = (path, defaultTitle) => {
    if (!existsSync(path)) return null;
    let data = [];
    try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
    const isSynthetic = data[0]?.isSynthetic ?? true;
    const prov = data[0]?.provenance || {};
    return {
      path,
      source: {
        id: `${instId}-${defaultTitle.toLowerCase().replace(/\\s+/g, '-')}`,
        name: `${inst.name} – ${defaultTitle}`,
        isSynthetic,
        license: isSynthetic ? 'Synthetic — created for demonstration' : 'Public Domain / Open Data',
        description: prov.source ? `Source: ${prov.source} (Coverage: ${prov.coverage || '100%'})` : inst.dataLabel,
        publishedAt: prov.date || '2025-06-30'
      }
    };
  };

  const results = [];
  const metaRegions = getMeta(join(dir, 'regions.json'), 'Administrative Boundaries');
  const metaAssets = getMeta(join(dir, 'assets.json'), 'Public Infrastructure Data');
  const metaInv = getMeta(join(dir, 'investments.json'), 'Public Investment Projects');

  if (metaRegions) {
    results.push(await importDataset({ type: 'regions', adapter: 'json-file', options: { path: metaRegions.path }, source: metaRegions.source, actor }));
  }
  if (metaAssets) {
    results.push(await importDataset({ type: 'assets', adapter: 'json-file', options: { path: metaAssets.path }, source: metaAssets.source, actor }));
  }
  if (metaInv) {
    results.push(await importDataset({ type: 'investments', adapter: 'json-file-relative-dates-multi', options: { path: metaInv.path }, source: metaInv.source, actor }));
  }
  return results;
}

/** Insert Brazil-specific synthetic requests through the shared normalisation pipeline. */
export function insertBrazilSyntheticRequests(now = new Date()) {
  // Temporarily set active instance to Brazil so normalization uses BR regions/config
  const prev = getInstance();
  try {
    setInstance('br-demo');
    const regions = dev.getRegions().filter(r => r.countryCode === 'BR');
    if (!regions.length) { console.warn('[MultiDemo] No Brazil regions found, skipping BR synthetic requests.'); return 0; }
    const reqs = generateBrazilSyntheticRequests(regions, now);
    let inserted = 0;
    for (const r of reqs) {
      const n = normalizeRequest({ ...r, regions, sourceId: 'br-demo-synthetic-requests' });
      dev.insertRequest({
        id: `REQ-BR${uuidv4().replace(/-/g, '').slice(0, 9)}`,
        ...n, description: n.descriptionRedacted, createdAt: n.timestamp, complaintId: null
      });
      inserted++;
    }
    dev.upsertDataSource({
      id: 'br-demo-synthetic-requests',
      name: 'Brazil demo citizen requests (synthetic, Portuguese)',
      kind: 'citizen_requests', adapter: 'synthetic-generator',
      description: 'Reproducible synthetic Portuguese-language requests for São Paulo metropolitan area. Classification and scoring are computed by the same real pipeline as India.',
      license: 'Synthetic', isSynthetic: true, recordCount: inserted
    });
    return inserted;
  } finally {
    setInstance(prev.id);
  }
}

/** Clear Brazil synthetic requests. */
export function clearBrazilSyntheticRequests() {
  dbRun(`DELETE FROM citizen_requests WHERE sourceId = 'br-demo-synthetic-requests'`);
}

/** Get country-switching status for the API. */
export function getInstanceRegistry() {
  return [
    {
      id: 'in-demo',
      country: 'IN',
      countryName: 'India',
      scope: 'National Capital Region (Demonstration)',
      languages: ['en', 'hi', 'hinglish'],
      currency: 'INR',
      currencySymbol: '₹',
      adminLevels: ['country', 'state', 'district', 'ward'],
      mapCenter: { lat: 28.62, lng: 77.22, zoom: 11 },
      status: 'active',
      dataLabel: 'DEMONSTRATION / SYNTHETIC DATA',
      engineNote: 'Same CivicAI intelligence engine — India configuration'
    },
    {
      id: 'br-demo',
      country: 'BR',
      countryName: 'Brazil',
      scope: 'São Paulo Metropolitan Region (Demonstration)',
      languages: ['pt', 'en'],
      currency: 'BRL',
      currencySymbol: 'R$',
      adminLevels: ['country', 'state', 'municipality', 'bairro'],
      mapCenter: { lat: -23.55, lng: -46.63, zoom: 11 },
      status: 'active',
      dataLabel: 'DEMONSTRATION / SYNTHETIC DATA',
      engineNote: 'Same CivicAI intelligence engine — Brazil configuration'
    }
  ];
}
