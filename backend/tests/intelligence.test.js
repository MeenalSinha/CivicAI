// ============================================================
// CivicAI intelligence-layer tests (engines, privacy, governance).
// Run: cd backend && node tests/intelligence.test.js
// ============================================================
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
const TEST_DB = join(tmpdir(), `civicai_intel_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DB_PATH = TEST_DB;
process.env.POLICY_NARRATION = 'off';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable on purpose: proves graceful degradation
process.env.PRIVACY_SALT = 'test-salt';

const { createHarness, assert } = await import('./harness.js');
const { initDatabase, getAllComplaints } = await import('../database/db.js');
const dev = await import('../database/devdb.js');
const { detectLanguage } = await import('../intelligence/language.js');
const tax = await import('../intelligence/taxonomy.js');
const { normalizeRequest } = await import('../intelligence/normalize.js');
const txt = await import('../intelligence/textutils.js');
const { assessSubmission, clusterRequests } = await import('../intelligence/clustering.js');
const { computeDemands } = await import('../intelligence/demand.js');
const { computeGaps } = await import('../intelligence/gaps.js');
const { computeAlignments } = await import('../intelligence/investment.js');
const { computePriorities } = await import('../intelligence/priority.js');
const { runPipeline, getWeights } = await import('../intelligence/pipeline.js');
const { DEFAULT_WEIGHTS } = await import('../intelligence/config.js');
const { ensureDemoData } = await import('../demo/loadDemo.js');
const { generateSyntheticRequests, SUB_CATEGORY } = await import('../demo/synthetic.js');
const { answerPolicyQuestion, narrationIsSupported, detectIntent } = await import('../intelligence/policyQuery.js');
const { validateRecords } = await import('../adapters/schemas.js');
const adapters = await import('../adapters/index.js');
const { ingestRequest, IntakeError } = await import('../intelligence/intake.js');
const { classifyTrends, computeOutcomes } = await import('../intelligence/trends.js');
const { readFileSync } = await import('fs');

const h = createHarness('Intelligence tests');
const { test, section } = h;

await initDatabase();
dev.initDevSchema();
const demo = await ensureDemoData();
const regions = dev.getRegions();
const W = getWeights();

section('Multilingual understanding');
await test('language detection: English / Hindi / Hinglish / Portuguese / Russian', () => {
  assert.eq(detectLanguage('There is a big pothole near the market').code, 'en');
  assert.eq(detectLanguage('सड़क पर बड़ा गड्ढा है').code, 'hi');
  assert.eq(detectLanguage('Hamare mohalla mein paani nahi aa raha hai').code, 'hinglish');
  assert.eq(detectLanguage('Não temos água há dias no bairro').code, 'pt');
  assert.eq(detectLanguage('Нет воды уже неделю').code, 'ru');
});
await test('"main road" in English is not mistaken for Hinglish', () => assert.eq(detectLanguage('Pothole on the main road near the station').code, 'en'));
await test('classifier recovers the true need for >=97% of 660+ synthetic multilingual requests', () => {
  const reqs = generateSyntheticRequests(regions);
  assert.gt(reqs.length, 500);
  let ok = 0;
  for (const r of reqs) {
    const sub = r._profile.split('.')[1];
    const n = normalizeRequest({ ...r, regions });
    if (n.category === SUB_CATEGORY[sub] && n.subcategory === sub) ok++;
  }
  assert.gte(ok / reqs.length, 0.97, `accuracy ${(ok / reqs.length).toFixed(3)}`);
});
await test('all channels produce the same normalised schema', () => {
  const base = { text: 'No water supply in Western Settlement for days', regions };
  const keys = c => Object.keys(normalizeRequest({ ...base, channel: c })).sort().join(',');
  const ref = keys('chat');
  for (const c of ['text', 'voice', 'image', 'messaging', 'api']) assert.eq(keys(c), ref, `channel ${c} schema differs`);
});
await test('required fields are extracted (category, subcategory, language, location, urgency, population, confidence, timestamp, channel)', () => {
  const n = normalizeRequest({ text: 'Eastern Periphery mein hospital nahi hai, 300 parivar pareshan hain', channel: 'voice', regions });
  for (const f of ['category', 'subcategory', 'description', 'language', 'locationText', 'lat', 'lng', 'regionId', 'urgency', 'populationRelevance', 'affectedInfrastructure', 'confidence', 'timestamp', 'channel']) assert.ok(n[f] !== undefined && n[f] !== null, `missing ${f}`);
  assert.eq(n.category, 'public_healthcare'); assert.eq(n.regionId, 'r08'); assert.eq(n.statedHouseholds, 300);
});
await test('unresolvable location is flagged, not guessed', () => {
  const n = normalizeRequest({ text: 'Pothole on the road', channel: 'chat', regions });
  assert.eq(n.regionId, null); assert.eq(n.locationSource, 'unresolved'); assert.ok(n.needsReview);
});
await test('GPS coordinates map to the correct region', () => {
  const n = normalizeRequest({ text: 'Garbage overflow', lat: 28.6301, lng: 77.3201, regions });
  assert.eq(n.locationSource, 'gps'); assert.eq(n.regionId, 'r08');
});
await test('taxonomy is extensible without touching engine code', () => {
  tax.extendTaxonomy({ categoryId: 'digital_identity', label: 'Digital Identity', subcategory: { id: 'kiosk', label: 'ID kiosk', keywords: { en: ['identity kiosk'] }, intervention: 'Deploy enrolment kiosks' } });
  const r = tax.classifyText('We need an identity kiosk in our ward');
  assert.eq(r.category, 'digital_identity'); assert.eq(r.subcategory, 'kiosk');
});
await test('taxonomy has all 16 required top-level development categories', () => {
  const ids = tax.listTaxonomy().map(c => c.id);
  for (const id of ['roads_transport', 'water_supply', 'drainage_flood', 'sanitation', 'waste_management', 'electricity', 'public_healthcare', 'education', 'public_safety', 'public_mobility', 'digital_connectivity', 'housing_urban_services', 'public_spaces', 'environmental_infrastructure', 'accessibility', 'other']) assert.ok(ids.includes(id), id);
});

section('Privacy and safety');
await test('PII is redacted (phones, emails)', () => {
  const r = txt.redactPII('Call me on +91 98765 43210 or a.b@mail.com about the drain');
  assert.notIncludes(r, '98765'); assert.notIncludes(r, '@mail'); assert.includes(r, '[number]'); assert.includes(r, '[email]');
});
await test('identity is hashed and never stored in citizen_requests', async () => {
  const before = dev.getRequests().length;
  const res = await ingestRequest({ text: 'Pothole near Lajpat Nagar is dangerous', channel: 'text', citizenName: 'Secret Name', citizenPhone: '+91 90000 11111', submitterKey: '+91 90000 11111', skipPipeline: true });
  const stored = dev.getRequestById(res.request.id);
  const blob = JSON.stringify(stored);
  assert.notIncludes(blob, 'Secret Name'); assert.notIncludes(blob, '90000 11111'); assert.ok(stored.submitterHash && stored.submitterHash.length === 24);
  assert.eq(dev.getRequests().length, before + 1);
  const legacy = getAllComplaints().find(c => c.requestId === res.request.id);
  assert.eq(legacy.citizenName, 'Secret Name', 'identity stays only in the officer-side complaint record');
});
await test('duplicate submissions by the same submitter are merged, independent citizens are not', async () => {
  const a = await ingestRequest({ text: 'Big pothole near Sector 14 Ward gate', channel: 'text', submitterKey: 'u-1', skipPipeline: true });
  const b = await ingestRequest({ text: 'Big pothole near Sector 14 Ward gate', channel: 'text', submitterKey: 'u-1', skipPipeline: true });
  const c = await ingestRequest({ text: 'Big pothole near Sector 14 Ward gate', channel: 'text', submitterKey: 'u-2', skipPipeline: true });
  assert.ok(!a.duplicate); assert.ok(b.duplicate, 'repeat by same submitter must be a duplicate'); assert.ok(!c.duplicate, 'different citizen is an independent signal');
});
await test('spam: rate limit blocks a flood from one submitter', async () => {
  let blocked = false;
  for (let i = 0; i < W.params.spamPerHour + 3; i++) {
    try { await ingestRequest({ text: `Streetlight broken lane ${i} in Lajpat Nagar with unique wording ${Math.random()}`, channel: 'text', submitterKey: 'flooder', skipPipeline: true }); }
    catch (e) { if (e instanceof IntakeError && e.status === 429) { blocked = true; break; } }
  }
  assert.ok(blocked, 'flood should be rate limited');
});
await test('policy views never expose names, phones or ticket ids', async () => {
  const { getOverview, getGeo, getPriorities } = await import('../intelligence/views.js');
  runPipeline({ trigger: 'test' });
  const blob = JSON.stringify([getOverview(), getGeo(), getPriorities({ limit: 100 })]);
  for (const bad of ['Secret Name', '90000 11111', 'Rahul Sharma', 'citizenPhone', 'TKT-0']) assert.notIncludes(blob, bad, `leaked ${bad}`);
});
await test('k-anonymity: map cells below the threshold are suppressed', async () => {
  const { getGeo } = await import('../intelligence/views.js');
  const g = getGeo();
  for (const c of g.requestCells) assert.gte(c.count, g.kAnonymity);
  assert.gt(g.suppressedRequests, -1);
});

section('Clustering and demand aggregation');
const mk = (id, lat, lng, extra = {}) => ({ id, status: 'active', category: 'roads_transport', subcategory: 'pothole', lat, lng, regionId: 'r04', urgency: 0.5, upvotes: 0, createdAt: new Date(Date.now() - 86400000).toISOString(), ...extra });
const regionsById = Object.fromEntries(regions.map(r => [r.id, r]));
await test('nearby same-need requests cluster; distant or different-need requests do not', () => {
  const reqs = [mk('a', 28.6050, 77.2430), mk('b', 28.6055, 77.2435), mk('c', 28.6052, 77.2428), mk('far', 28.6500, 77.2430), mk('other', 28.6050, 77.2430, { subcategory: 'road_damage' })];
  const { clusters } = clusterRequests(reqs, regionsById, W.params);
  assert.eq(clusters.length, 3);
  assert.eq(Math.max(...clusters.map(c => c.requestCount)), 3);
});
await test('cluster estimates affected population from footprint x density (capped by region population)', () => {
  const { clusters } = clusterRequests([mk('a', 28.6050, 77.2430), mk('b', 28.6060, 77.2440)], regionsById, W.params);
  assert.gt(clusters[0].affectedPopulation, 0); assert.ok(clusters[0].affectedPopulation <= regionsById.r04.population);
});
await test('demand score components sum to the score and respect weights', () => {
  const rs = Array.from({ length: 12 }, (_, i) => mk(`x${i}`, 28.605 + i * 0.0002, 77.243, { clusterId: 'CL-1', createdAt: new Date(Date.now() - i * 3 * 86400000).toISOString(), upvotes: 3 }));
  const { clusters } = clusterRequests(rs, regionsById, W.params);
  const withCl = rs.map(r => ({ ...r, clusterId: clusters[0].id }));
  const [d] = computeDemands({ requests: withCl, clusters, regionsById, weights: DEFAULT_WEIGHTS });
  const sum = Object.values(d.components).reduce((s, c) => s + c.contribution, 0);
  assert.near(sum, d.demandScore, 0.6);
  const heavy = { ...DEFAULT_WEIGHTS, demand: { ...DEFAULT_WEIGHTS.demand, urgency: 5 } };
  const [d2] = computeDemands({ requests: withCl, clusters, regionsById, weights: heavy });
  assert.ok(d2.demandScore !== d.demandScore, 'weights must be configurable');
});
await test('demand rises with volume and growth (not raw counting)', () => {
  const score = n => {
    const rs = Array.from({ length: n }, (_, i) => mk(`v${n}-${i}`, 28.605 + i * 0.0001, 77.243, { createdAt: new Date(Date.now() - i * 86400000).toISOString() }));
    const { clusters, assignments } = clusterRequests(rs, regionsById, W.params); const m = new Map(assignments);
    return computeDemands({ requests: rs.map(r => ({ ...r, clusterId: m.get(r.id) })), clusters, regionsById, weights: DEFAULT_WEIGHTS })[0].demandScore;
  };
  assert.gt(score(20), score(4));
});
await test('growth rate compares last window to prior window', () => {
  const day = 86400000; const rs = [];
  for (let i = 0; i < 8; i++) rs.push(mk(`r${i}`, 28.605, 77.243, { createdAt: new Date(Date.now() - (2 + i) * day).toISOString() }));
  for (let i = 0; i < 4; i++) rs.push(mk(`p${i}`, 28.605, 77.243, { createdAt: new Date(Date.now() - (35 + i) * day).toISOString() }));
  const { clusters, assignments } = clusterRequests(rs, regionsById, W.params); const m = new Map(assignments);
  const [d] = computeDemands({ requests: rs.map(r => ({ ...r, clusterId: m.get(r.id) })), clusters, regionsById, weights: DEFAULT_WEIGHTS });
  assert.eq(d.recentCount, 8); assert.eq(d.priorCount, 4); assert.near(d.growthRate, 1, 0.01);
});

section('Infrastructure gaps, investment alignment, prioritisation');
const demands = dev.getDemands(), gaps = dev.getGaps(), aligns = dev.getAlignments(), projects = dev.getProjects();
await test('gap = 1 - availability and population-in-gap derives from region population', () => {
  const g = gaps.find(x => x.id === 'r08|public_healthcare');
  assert.near(g.availability, 0.28, 0.01); assert.near(g.gap, 0.72, 0.01); assert.eq(g.populationInGap, Math.round(120000 * g.gap));
  assert.ok(g.reasoning.length >= 3, 'reasoning must be shown');
});
await test('category concentration (share of a region\'s requests) is computed and stored', () => {
  const d = dev.getDemands().find(x => x.id === 'r08|public_healthcare');
  assert.gt(d.categoryShare, 0); assert.ok(d.categoryShare <= 1);
  const total = dev.getDemands().filter(x => x.regionId === 'r08').reduce((s, x) => s + x.categoryShare, 0);
  assert.near(total, 1, 0.02, 'shares within a region must sum to ~1');
});
await test('missing infrastructure data yields demand-only gap with reduced confidence and explicit reasoning', () => {
  const regs = [{ id: 'z', name: 'Z', population: 10000, areaKm2: 5, lat: 0, lng: 0, radiusKm: 2 }];
  const dm = [{ id: 'z|education', regionId: 'z', category: 'education', demandScore: 60, requestCount: 10, uniqueLocations: 5, recentCount: 5, priorCount: 3, growthRate: 0.5, affectedPopulation: 2000, avgConfidence: 0.9, lowLocationShare: 0.2 }];
  const [g] = computeGaps({ regions: regs, assets: [], demands: dm, weights: DEFAULT_WEIGHTS });
  assert.eq(g.dataStatus, 'demand_only'); assert.eq(g.gap, null); assert.ok(g.reasoning.join(' ').includes('gap cannot be measured'));
  const withData = computeGaps({ regions: regs, assets: [{ regionId: 'z', sector: 'education', metric: 'm', value: 2, benchmark: 6, asOf: '2026-01-01' }], demands: dm, weights: DEFAULT_WEIGHTS })[0];
  assert.gt(withData.confidence, g.confidence);
});
await test('investment alignment classes: limited / ongoing / aligned / overlap', () => {
  const by = Object.fromEntries(aligns.map(a => [a.id, a]));
  assert.eq(by['r08|public_healthcare'].classification, 'high_demand_limited_investment');
  assert.ok(aligns.some(a => a.classification === 'high_demand_ongoing_project'), 'expected an ongoing-project class');
  assert.ok(aligns.some(a => a.overlap && a.regionId === 'r04' && a.category === 'roads_transport'), 'Lajpat Nagar road packages should be flagged as overlapping');
});
await test('alignment language is neutral and never claims ineffectiveness', () => {
  const text = JSON.stringify(aligns.map(a => a.note)).toLowerCase();
  for (const bad of ['ineffective', 'failed', 'wasted', 'corrupt', 'mismanag']) assert.notIncludes(text, bad);
  assert.includes(text, 'limited mapped investment coverage');
});
await test('priority score is the weighted sum of shown components, and every item carries a "because" rationale', () => {
  for (const p of projects.slice(0, 15)) {
    const sum = Object.values(p.components).reduce((s, c) => s + c.contribution, 0);
    assert.near(sum, p.priorityScore, 0.6, `${p.id} components do not sum to score`);
    assert.includes(p.rationale, 'Priority increased because');
    assert.ok(p.topEvidence.length >= 3); assert.ok(p.responsibleDepartment && p.proposedIntervention);
  }
  assert.ok(projects.every((p, i) => i === 0 || projects[i - 1].priorityScore >= p.priorityScore), 'sorted by score');
});
await test('intended demo story is computed (Eastern Periphery healthcare is top priority) rather than hardcoded', () => {
  assert.eq(projects[0].id, 'r08|public_healthcare');
  const flipped = computePriorities({ demands: demands.map(d => d.id === 'r08|public_healthcare' ? { ...d, demandScore: 5, avgUrgency: 0, growthRate: 0, persistence: 0 } : d), gaps, alignments: aligns, regions, requests: [], clusters: [], weights: DEFAULT_WEIGHTS });
  assert.ok(flipped[0].id !== 'r08|public_healthcare', 'changing inputs must change the ranking');
});
await test('every recommendation has a >=8-step evidence trail, review status and model trace', () => {
  const recs = dev.getRecommendations();
  assert.eq(recs.length, projects.length);
  for (const r of recs.slice(0, 10)) {
    assert.gte(r.evidenceTrail.length, 8); assert.eq(r.status, 'pending_review'); assert.eq(r.modelTrace.llmUsedForScores, false);
    assert.includes(r.evidenceTrail.at(-1).detail, 'not binding');
  }
});
await test('human review status survives pipeline recomputation', () => {
  dev.reviewRecommendation('r08|public_healthcare', { status: 'approved', reviewer: 'tester', note: 'ok' });
  runPipeline({ trigger: 'test' });
  assert.eq(dev.getRecommendationByProject('r08|public_healthcare').status, 'approved');
  dev.reviewRecommendation('r08|public_healthcare', { status: 'pending_review', reviewer: 'tester', note: '' });
});
await test('changing scoring weights changes priorities and pipeline stays deterministic', () => {
  const a = JSON.stringify(dev.getProjects().map(p => [p.id, p.priorityScore]));
  runPipeline({ trigger: 'test' });
  assert.eq(JSON.stringify(dev.getProjects().map(p => [p.id, p.priorityScore])), a, 'recompute must be idempotent');
  dev.setConfigValue('weights', { priority: { equity: 0.9 } }, 'test'); runPipeline({ trigger: 'test' });
  const b = JSON.stringify(dev.getProjects().map(p => [p.id, p.priorityScore]));
  assert.ok(a !== b);
  dev.setConfigValue('weights', null, 'test'); runPipeline({ trigger: 'test' });
});

section('Trends and outcomes');
await test('trend classes are produced from data (emerging / rapidly growing / persistent / declining)', () => {
  const t = classifyTrends(dev.getDemands(), W);
  assert.gt(t.persistent.length + t.rapidlyGrowing.length + t.emerging.length, 0);
  assert.ok(t.declining.some(x => x.id === 'r01|waste_management' || x.id === 'r02|electricity'), 'declining synthetic needs should be detected');
});
await test('outcome measurement compares demand before/after completed projects and flags small samples', () => {
  const o = computeOutcomes({ investments: dev.getInvestments(), requests: dev.getRequests(), complaints: [], feedback: [] });
  const w = o.projectOutcomes.find(x => x.investmentId === 'INV-001');
  assert.ok(w, 'completed waste project should have an outcome'); assert.gt(w.requestsBefore, w.requestsAfter);
  assert.includes(w.note, 'causation');
});

section('Data-source adapters (interoperability)');
await test('schema validation rejects malformed records with reasons', () => {
  const v = validateRecords('assets', [{ id: 'a', regionId: 'r01', sector: 'not_a_sector', metric: 'm', value: -1, benchmark: 0 }], { regionIds: new Set(['r01']) });
  assert.eq(v.valid.length, 0); assert.includes(v.errors[0].error, 'unknown sector');
});
await test('CSV adapter imports investments and registers a labelled data source', async () => {
  const csv = 'id,name,sector,stage,coverage,budget,targetPopulation\nINV-T1,Test School,education,ongoing,"{""r01"":0.5}",5000000,9000\nINV-BAD,Bad,education,weird,"{""r01"":0.5}",1,1';
  const r = await adapters.importDataset({ type: 'investments', adapter: 'inline-csv', options: { csv }, source: { id: 'test-csv', name: 'Test CSV', isSynthetic: true } });
  assert.eq(r.imported, 1); assert.eq(r.rejected, 1);
  assert.ok(dev.listDataSources().find(s => s.id === 'test-csv').isSynthetic);
});
await test('HTTP adapter refuses hosts that are not allow-listed (SSRF guard)', async () => {
  await assert.throws(() => adapters.importDataset({ type: 'regions', adapter: 'http-json', options: { url: 'https://example.com/x.json' } }));
});
await test('GeoJSON boundary adapter produces valid regions', async () => {
  const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'g1', name: 'Geo Ward', population: 30000, areaKm2: 4 }, geometry: { type: 'Polygon', coordinates: [[[77.0, 28.0], [77.02, 28.0], [77.02, 28.02], [77.0, 28.02], [77.0, 28.0]]] } }] };
  const r = await adapters.importDataset({ type: 'regions', adapter: 'geojson-boundaries', options: { geojson }, source: { id: 'test-geo', isSynthetic: true } });
  assert.eq(r.imported, 1); assert.ok(dev.getRegions().find(x => x.id === 'g1').geometry);
});
await test('synthetic demo data is always labelled synthetic; nothing is presented as official', () => {
  const sources = dev.listDataSources().filter(s => s.id.startsWith('demo-'));
  assert.gte(sources.length, 4); assert.ok(sources.every(s => s.isSynthetic));
  assert.ok(dev.getRegions().filter(r => r.sourceId?.startsWith('demo-')).every(r => r.isSynthetic));
});

section('Policy query interface');
await test('intents are parsed for the four canonical policy questions', () => {
  assert.eq(detectIntent('Which districts have the highest unmet road-development demand?'), 'top_unmet');
  assert.eq(detectIntent('Where is healthcare demand growing faster than infrastructure availability?'), 'growth_vs_infra');
  assert.eq(detectIntent('Which regions have high citizen demand but limited mapped investment coverage?'), 'limited_investment');
  assert.eq(detectIntent('Which development needs are emerging fastest this quarter?'), 'emerging');
});
await test('answers come from data with tables + filters; unsupported questions are refused (no fabrication)', async () => {
  const a = await answerPolicyQuestion('Which districts have the highest unmet road-development demand?', { narrate: false });
  assert.eq(a.filters.category, 'roads_transport'); assert.gte(a.table.rows.length, 3); assert.ok(a.answer.includes('demand score'));
  const b = await answerPolicyQuestion('What will the GDP of the country be next year?', { narrate: false });
  assert.eq(b.intent, 'unknown'); assert.includes(b.answer, 'do not have information'); assert.eq(b.table, null);
});
await test('"why" questions explain from the stored evidence and contain real numbers', async () => {
  const a = await answerPolicyQuestion('Why was Eastern Periphery prioritized for healthcare?', { narrate: false });
  assert.eq(a.intent, 'explain'); assert.includes(a.answer, 'Priority increased because'); assert.includes(a.answer, 'residents');
  assert.gte(a.table.rows.length, 8);
});
await test('LLM narration is discarded when it contains numbers absent from the facts', () => {
  const facts = { answer: 'Eastern Periphery has demand score 67 and 86,400 residents affected' };
  assert.ok(narrationIsSupported('Demand score is 67 with 86,400 residents affected.', facts, facts.answer));
  assert.ok(!narrationIsSupported('Demand score is 67 and 250,000 residents affected.', facts, facts.answer));
});
await test('policy query works when AI models are unavailable', async () => {
  const a = await answerPolicyQuestion('Which regions have high citizen demand but limited mapped investment coverage?', { narrate: true });
  assert.ok(a.answer.length > 20); assert.eq(a.narration, null);
});

section('Governance: audit log');
await test('audit log is hash-chained and detects tampering', async () => {
  assert.ok(dev.verifyAuditChain().valid); assert.gt(dev.verifyAuditChain().entries, 10);
  const { dbRun } = await import('../database/db.js');
  dbRun(`UPDATE audit_logs SET action='tampered' WHERE seq = (SELECT MIN(seq) FROM audit_logs)`);
  assert.ok(!dev.verifyAuditChain().valid, 'tampering must be detected');
});
await test('AI decision traceability: each request keeps classifier, matched terms and trace', () => {
  const r = dev.getRequests({ status: 'active' }).find(x => x.sourceId === 'demo-synthetic-requests');
  assert.ok(r.classifier); assert.ok(Array.isArray(r.matchedTerms)); assert.ok(r.trace.length >= 1);
});

const s = h.summary();
if (existsSync(TEST_DB)) try { unlinkSync(TEST_DB); } catch {}
process.exit(s.failed ? 1 : 0);
