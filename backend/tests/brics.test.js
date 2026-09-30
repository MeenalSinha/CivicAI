// ============================================================
// BRICS-readiness test: run the SAME engines for a different country/language/currency
// using only configuration + adapter-loaded data. No engine code changes.
// Run: cd backend && node tests/brics.test.js
// ============================================================
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
const TEST_DB = join(tmpdir(), `civicai_brics_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB; process.env.AI_SERVICE_URL = 'http://127.0.0.1:9'; process.env.CIVICAI_INSTANCE = 'br-template';

const { createHarness, assert } = await import('./harness.js');
const { initDatabase } = await import('../database/db.js');
const dev = await import('../database/devdb.js');
const cfg = await import('../intelligence/config.js');
const adapters = await import('../adapters/index.js');
const { ingestRequest } = await import('../intelligence/intake.js');
const { runPipeline } = await import('../intelligence/pipeline.js');
const views = await import('../intelligence/views.js');
const { answerPolicyQuestion } = await import('../intelligence/policyQuery.js');

const h = createHarness('BRICS readiness tests');
await initDatabase(); dev.initDevSchema();

await h.test('instance config selects Brazil (country, currency, languages, admin levels) without code changes', () => {
  const i = cfg.getInstance();
  assert.eq(i.country, 'BR'); assert.eq(i.countryInfo.currency.code, 'BRL'); assert.ok(i.languages.includes('pt'));
  assert.eq(i.adminLevels[3], 'bairro');
  assert.includes(cfg.formatMoney(12_500_000, i), 'R$');
});
await h.test('country registry covers BRICS members and partners', () => {
  const codes = cfg.getCountries().map(c => c.code);
  for (const c of ['IN', 'BR', 'RU', 'CN', 'ZA', 'EG', 'ET', 'IR', 'AE', 'ID']) assert.ok(codes.includes(c), c);
});
await h.test('Brazilian datasets load through generic adapters', async () => {
  const regions = [
    { id: 'br-1', name: 'Jardim Esperança', aliases: ['jardim esperanca'], lat: -23.55, lng: -46.63, population: 60000, areaKm2: 6, radiusKm: 2, countryCode: 'BR' },
    { id: 'br-2', name: 'Vila Nova', aliases: [], lat: -23.60, lng: -46.70, population: 40000, areaKm2: 5, radiusKm: 2, countryCode: 'BR' }
  ];
  const r1 = await adapters.importDataset({ type: 'regions', adapter: 'inline-json', options: { records: regions }, source: { id: 'br-regions', isSynthetic: true } });
  const r2 = await adapters.importDataset({ type: 'assets', adapter: 'inline-json', options: { records: [
    { id: 'a1', regionId: 'br-1', sector: 'water_supply', metric: 'households_with_tap_pct', value: 45, benchmark: 95, asOf: '2026-01-01' },
    { id: 'a2', regionId: 'br-2', sector: 'water_supply', metric: 'households_with_tap_pct', value: 90, benchmark: 95, asOf: '2026-01-01' }] }, source: { id: 'br-assets', isSynthetic: true } });
  const r3 = await adapters.importDataset({ type: 'investments', adapter: 'inline-json', options: { records: [
    { id: 'i1', name: 'Rede de água - Vila Nova', sector: 'water_supply', stage: 'ongoing', coverage: { 'br-2': 0.5 }, budget: 8_000_000, currency: 'BRL', targetPopulation: 20000 }] }, source: { id: 'br-inv', isSynthetic: true } });
  assert.eq(r1.imported, 2); assert.eq(r2.imported, 2); assert.eq(r3.imported, 1);
});
await h.test('Portuguese requests are understood, located and aggregated', async () => {
  const texts = ['Falta de água há dias no bairro Jardim Esperança, muito preocupante.', 'Não tem água em Jardim Esperança, precisamos de ajuda urgente.', 'Sem água na rua, Jardim Esperança há semanas.', 'Falta de água no Jardim Esperança, os moradores estão sem água.'];
  for (let i = 0; i < texts.length; i++) {
    const r = await ingestRequest({ text: texts[i], channel: 'text', submitterKey: `pt-${i}`, skipPipeline: true, skipAI: true });
    assert.eq(r.request.language, 'pt'); assert.eq(r.request.category, 'water_supply'); assert.eq(r.request.regionId, 'br-1');
  }
  const run = runPipeline({ trigger: 'test' });
  assert.gt(run.stats.demands, 0);
});
await h.test('prioritisation, departments and currency come from the Brazilian instance config', () => {
  const p = views.getPriorities({ limit: 5 })[0];
  assert.eq(p.regionId, 'br-1'); assert.eq(p.responsibleDepartment, 'Companhia de Saneamento');
  const inv = views.getInvestmentsView().projects[0];
  assert.includes(inv.budgetFormatted, 'R$');
  const ov = views.getOverview();
  assert.eq(ov.instance.country, 'Brazil'); assert.eq(ov.instance.currency.code, 'BRL'); assert.includes(ov.totals.mappedBudgetFormatted, 'R$');
});
await h.test('policy Q&A runs on the foreign instance and reports its own regions', async () => {
  const a = await answerPolicyQuestion('Which regions have the highest unmet water demand?', { narrate: false });
  assert.includes(a.answer, 'Jardim Esperança');
});
await h.test('no India-specific constants leak into Brazilian outputs', () => {
  const blob = JSON.stringify([views.getOverview(), views.getPriorities({ limit: 10 }), views.getGeo()]);
  for (const bad of ['₹', 'INR', 'crore', 'BBMP', 'Delhi', 'Public Works Department']) assert.notIncludes(blob, bad, `leaked ${bad}`);
});

const s = h.summary();
if (existsSync(TEST_DB)) try { unlinkSync(TEST_DB); } catch {}
process.exit(s.failed ? 1 : 0);
