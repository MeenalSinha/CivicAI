// ============================================================
// CivicAI API integration tests: spawns the real server (own temp DB), exercises REST + WebSocket.
// Run: cd backend && node tests/integration.test.js
// ============================================================
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';
import { WebSocket } from 'ws';
import { createHarness, assert } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const h = createHarness('API integration tests');
const procs = [];

async function startServer(port, env = {}) {
  const db = join(tmpdir(), `civicai_int_${port}_${Date.now()}.db`);
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_PATH: db, JWT_SECRET: 'integration-secret', AI_SERVICE_URL: 'http://127.0.0.1:9', POLICY_NARRATION: 'off', NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', d => log += d); p.stderr.on('data', d => log += d);
  procs.push({ p, db });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return { base, port, log: () => log }; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not start:\n' + log.slice(-800));
}
const call = async (base, method, path, { token, body, headers } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
};
const login = async (base, u, p) => (await call(base, 'POST', '/auth/login', { body: { username: u, password: p } })).body?.token;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const A = await startServer(3961, { CHANNEL_WEBHOOK_SECRET: 'hook-secret', DEMO_MODE: 'true' });
const B = await startServer(3962, { DEMO_MODE: 'false', LOAD_DEMO_DATA: 'false' });
const base = A.base;
const officer = await login(base, 'officer', 'CivicAI@2024');
const admin = await login(base, 'admin', 'Admin@CivicAI2024');
const policy = await login(base, 'policymaker', 'Policy@CivicAI2026');

h.section('Backward compatibility (existing features)');
await h.test('health reports v4 with demo instance', async () => { const r = await call(base, 'GET', '/health'); assert.eq(r.status, 200); assert.eq(r.body.version, '4.0.0'); assert.eq(r.body.instance, 'in-demo'); });
await h.test('officer login works; wrong password rejected', async () => { assert.ok(officer); assert.eq((await call(base, 'POST', '/auth/login', { body: { username: 'officer', password: 'nope' } })).status, 401); });
await h.test('officer complaint list, analytics, insights, predictions, map, notifications still work', async () => {
  const c = await call(base, 'GET', '/officer/complaints', { token: officer }); assert.eq(c.status, 200); assert.gte(c.body.complaints.length, 6);
  assert.eq((await call(base, 'GET', '/officer/analytics', { token: officer })).status, 200);
  assert.eq((await call(base, 'GET', '/officer/insights', { token: officer })).status, 200);
  assert.eq((await call(base, 'GET', '/officer/predictions', { token: officer })).status, 200);
  assert.eq((await call(base, 'GET', '/map/complaints')).status, 200);
  assert.eq((await call(base, 'GET', '/notifications')).status, 200);
});
await h.test('complaint tracking by ticket id and upvotes', async () => {
  const t = await call(base, 'GET', '/complaints/TKT-001'); assert.eq(t.status, 200); assert.eq(t.body.ticketId, 'TKT-001');
  const before = t.body.upvotes; const u = await call(base, 'POST', `/complaints/${t.body.id}/upvote`); assert.eq(u.body.upvotes, before + 1);
  assert.eq((await call(base, 'GET', '/complaints/DOES-NOT-EXIST')).status, 404);
});
await h.test('officer workflow: status/priority update + validation', async () => {
  const t = (await call(base, 'GET', '/complaints/TKT-002')).body;
  const ok = await call(base, 'PATCH', `/officer/complaints/${t.id}`, { token: officer, body: { status: 'in_progress', notes: 'crew assigned', priority: 'HIGH' } });
  assert.eq(ok.status, 200); assert.eq(ok.body.complaint.status, 'in_progress');
  assert.eq((await call(base, 'PATCH', `/officer/complaints/${t.id}`, { token: officer, body: { status: 'bogus' } })).status, 400);
});
await h.test('unauthenticated officer routes are rejected', async () => assert.eq((await call(base, 'GET', '/officer/complaints')).status, 401));

h.section('Citizen intake: multilingual, voice, image, geolocation');
let hiComplaint;
await h.test('chat: Hinglish request creates a complaint AND a normalised anonymised request', async () => {
  const r = await call(base, 'POST', '/chat', { body: { message: 'Western Settlement mein paani nahi aa raha 4 din se, poore mohalla ke log pareshan hain', clientId: 'client-chat-0001' } });
  assert.eq(r.status, 200); assert.ok(r.body.complaint.ticketId); assert.eq(r.body.request.category, 'water_supply'); assert.eq(r.body.request.language, 'hinglish'); assert.eq(r.body.request.regionName, 'Western Settlement');
  assert.ok(!('submitterHash' in r.body.request));
});
await h.test('text complaint in Hindi (Devanagari) is classified with the new taxonomy', async () => {
  const r = await call(base, 'POST', '/complaints', { body: { text: 'Eastern Periphery में अस्पताल नहीं है, बहुत दूर जाना पड़ता है', citizenName: 'Asha', citizenPhone: '9811100001', clientId: 'client-hi-000001' } });
  assert.eq(r.status, 201); assert.eq(r.body.request.category, 'public_healthcare'); assert.eq(r.body.request.language, 'hi'); hiComplaint = r.body.complaint;
});
await h.test('text complaint in English with GPS is placed in the right region', async () => {
  const r = await call(base, 'POST', '/complaints', { body: { text: 'Large pothole and broken road surface', lat: 28.6302, lng: 77.3198, clientId: 'client-en-000001' } });
  assert.eq(r.status, 201); assert.eq(r.body.request.regionName, 'Eastern Periphery'); assert.eq(r.body.request.locationSource, 'gps'); assert.eq(r.body.request.category, 'roads_transport');
});
await h.test('malformed GPS is ignored safely (no crash, location left unresolved)', async () => {
  const r = await call(base, 'POST', '/complaints', { body: { text: 'Garbage overflow near the bin', lat: 9999, lng: 'abc', clientId: 'client-bad-00001' } });
  assert.eq(r.status, 201); assert.eq(r.body.request.locationSource, 'unresolved');
});
await h.test('voice transcript submission (Hinglish) works', async () => {
  const r = await call(base, 'POST', '/voice-complaint', { body: { transcript: 'Northern Fringe mein network nahi aata, signal nahi milta', clientId: 'client-voice-0001' } });
  assert.eq(r.status, 201); assert.eq(r.body.request.category, 'digital_connectivity'); assert.eq(r.body.request.channel, 'voice');
});
await h.test('raw audio without Whisper fails gracefully (503, no internals leaked)', async () => {
  const r = await call(base, 'POST', '/transcribe-audio', { body: { audio: 'UklGRg==', mimeType: 'audio/wav' } });
  assert.ok([503, 500].includes(r.status)); assert.notIncludes(JSON.stringify(r.body), 'PRELOAD_WHISPER'); assert.notIncludes(JSON.stringify(r.body), 'at ');
});
await h.test('image submission falls back gracefully when vision models are unavailable', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const r = await call(base, 'POST', '/analyze-image', { body: { image: png, location: 'Lajpat Nagar', clientId: 'client-img-000001' } });
  assert.ok([200, 201].includes(r.status)); assert.ok(r.body.complaint.ticketId); assert.eq(r.body.request.channel, 'image');
  assert.eq((await call(base, 'POST', '/analyze-image', { body: { image: 'data:text/html;base64,AAAA' } })).status, 400);
});
await h.test('duplicate: same citizen repeating the same request is linked, not double counted', async () => {
  const body = { text: 'Pothole near Sector 14 Ward gate is dangerous', clientId: 'client-dup-000001' };
  const a = await call(base, 'POST', '/complaints', { body }); const b = await call(base, 'POST', '/complaints', { body });
  assert.eq(a.status, 201); assert.eq(b.status, 200); assert.ok(b.body.duplicate); assert.eq(b.body.complaint.ticketId, a.body.complaint.ticketId);
});
await h.test('spam: flooding from one client is rate limited (429)', async () => {
  let got429 = false;
  for (let i = 0; i < 25 && !got429; i++) {
    const r = await call(base, 'POST', '/complaints', { body: { text: `Streetlight not working on lane ${i} ${Math.random().toString(36).slice(2)} near Lajpat Nagar`, clientId: 'client-flood-0001' } });
    if (r.status === 429) got429 = true;
  }
  assert.ok(got429);
});
await h.test('input validation: empty text rejected', async () => { assert.eq((await call(base, 'POST', '/complaints', { body: { text: '   ' } })).status, 400); assert.eq((await call(base, 'POST', '/chat', { body: {} })).status, 400); });
await h.test('feedback loop: only after resolution, once, rating 1-5', async () => {
  assert.eq((await call(base, 'POST', `/complaints/${hiComplaint.id}/feedback`, { body: { rating: 5 } })).status, 409);
  await call(base, 'PATCH', `/officer/complaints/${hiComplaint.id}`, { token: officer, body: { status: 'resolved' } });
  assert.eq((await call(base, 'POST', `/complaints/${hiComplaint.id}/feedback`, { body: { rating: 9 } })).status, 400);
  assert.eq((await call(base, 'POST', `/complaints/${hiComplaint.id}/feedback`, { body: { rating: 4, comment: 'Thanks' } })).status, 201);
  assert.eq((await call(base, 'POST', `/complaints/${hiComplaint.id}/feedback`, { body: { rating: 4 } })).status, 409);
});
await h.test('messaging webhook: disabled without secret, rejects bad secret, accepts WhatsApp-format payload', async () => {
  assert.eq((await call(B.base, 'POST', '/channels/whatsapp-cloud/webhook', { body: {} })).status, 503);
  assert.eq((await call(base, 'POST', '/channels/whatsapp-cloud/webhook', { body: {}, headers: { 'x-channel-secret': 'wrong' } })).status, 401);
  const payload = { entry: [{ changes: [{ value: { messages: [{ from: '919800000001', type: 'text', text: { body: 'Yamuna Riverside mein sewer overflow ho raha hai, sadak par sewage hai' } }] } }] }] };
  const r = await call(base, 'POST', '/channels/whatsapp-cloud/webhook', { body: payload, headers: { 'x-channel-secret': 'hook-secret' } });
  assert.eq(r.status, 201); assert.eq(r.body.request.category, 'sanitation'); assert.eq(r.body.request.channel, 'messaging');
  assert.eq((await call(base, 'POST', '/channels/unknown/webhook', { body: {}, headers: { 'x-channel-secret': 'hook-secret' } })).status, 404);
});

h.section('Real-time (WebSocket)');
await h.test('new_complaint and intelligence_updated events are pushed to connected clients', async () => {
  const events = [];
  const ws = new WebSocket(`ws://127.0.0.1:${A.port}`);
  ws.on('message', m => { try { events.push(JSON.parse(m).event); } catch {} }); // attach first: 'connected' is sent immediately
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  for (let i = 0; i < 20 && !events.includes('connected'); i++) await sleep(50);
  await call(base, 'POST', '/complaints', { body: { text: 'Blocked drain in Riverside Colony, dirty water overflowing', clientId: 'client-ws-0000001' } });
  for (let i = 0; i < 30 && !(events.includes('new_complaint') && events.includes('intelligence_updated')); i++) await sleep(150);
  ws.close();
  assert.ok(events.includes('connected')); assert.ok(events.includes('new_complaint'), 'no new_complaint event'); assert.ok(events.includes('intelligence_updated'), 'no intelligence_updated event');
});

h.section('Role-based access and privacy');
await h.test('policy endpoints require authentication', async () => { assert.eq((await call(base, 'GET', '/policy/overview')).status, 401); assert.eq((await call(base, 'POST', '/policy/query', { body: { question: 'x' } })).status, 401); });
await h.test('policymaker cannot read individual complaints (PII) but can read aggregates', async () => {
  assert.eq((await call(base, 'GET', '/officer/complaints', { token: policy })).status, 403);
  assert.eq((await call(base, 'PATCH', '/officer/complaints/x', { token: policy, body: { status: 'resolved' } })).status, 403);
  assert.eq((await call(base, 'GET', '/policy/overview', { token: policy })).status, 200);
});
await h.test('only admin can change weights, view audit logs, import datasets', async () => {
  for (const [m, p, b] of [['PUT', '/policy/config/weights', { priority: { gap: 0.3 } }], ['GET', '/policy/audit'], ['POST', '/policy/datasets/import', { type: 'assets', adapter: 'inline-json', records: [] }]]) {
    assert.eq((await call(base, m, p, { token: policy, body: b })).status, 403, p); assert.eq((await call(base, m, p, { token: officer, body: b })).status, 403, p);
  }
});
await h.test('policy API responses contain no citizen identity or ticket identifiers', async () => {
  const blob = JSON.stringify([(await call(base, 'GET', '/policy/overview', { token: policy })).body, (await call(base, 'GET', '/policy/geo', { token: policy })).body, (await call(base, 'GET', '/policy/priorities?limit=100', { token: policy })).body, (await call(base, 'GET', '/policy/review/requests', { token: policy })).body]);
  for (const bad of ['Asha', '9811100001', 'Rahul Sharma', 'Priya Patel', '+91 98765', 'TKT-0', 'submitterHash', 'citizenPhone']) assert.notIncludes(blob, bad, `leaked ${bad}`);
});

h.section('Policy intelligence API');
let top;
await h.test('overview: totals, investment coverage, trend indicators, synthetic-data label', async () => {
  const r = (await call(base, 'GET', '/policy/overview', { token: policy })).body;
  assert.gt(r.totals.citizenRequests, 600); assert.gt(r.totals.activeDemandClusters, 10); assert.gt(r.totals.infrastructureGaps, 0); assert.gt(r.totals.affectedPopulation, 0);
  assert.ok(r.isSyntheticData); assert.includes(r.instance.dataLabel, 'SYNTHETIC'); assert.ok(r.investmentCoverage.byClass.high_demand_limited_investment); assert.ok(r.trendIndicators.weeklyRequests);
});
await h.test('geo layers: requests, hotspots, gaps, density, investments, recommended projects', async () => {
  const g = (await call(base, 'GET', '/policy/geo', { token: policy })).body;
  assert.gt(g.requestCells.length, 5); assert.gt(g.hotspots.length, 5); assert.eq(g.regions.length, 10); assert.ok(g.regions.every(r => r.density > 0)); assert.gt(g.recommended.length, 3);
  assert.ok(g.regions.some(r => r.investments.length > 0));
  const f = (await call(base, 'GET', '/policy/geo?category=public_healthcare&sector=public_healthcare', { token: policy })).body;
  assert.ok(f.hotspots.every(x => x.category === 'public_healthcare'));
});
await h.test('priorities list has all required fields and filters work', async () => {
  const r = (await call(base, 'GET', '/policy/priorities?limit=20', { token: policy })).body; top = r.priorities[0];
  for (const f of ['region', 'categoryLabel', 'demandScore', 'infrastructureGap', 'affectedPopulation', 'existingInvestment', 'proposedIntervention', 'evidence', 'rationale', 'responsibleDepartment', 'band', 'priorityScore']) assert.ok(top[f] !== undefined, f);
  const hcare = (await call(base, 'GET', '/policy/priorities?category=public_healthcare', { token: policy })).body.priorities; assert.ok(hcare.length > 0 && hcare.every(p => p.category === 'public_healthcare'));
});
await h.test('explainability: detail returns full evidence trail, weights and clusters', async () => {
  const r = (await call(base, 'GET', `/policy/priorities/${encodeURIComponent(top.id)}`, { token: policy })).body;
  assert.gte(r.recommendation.evidenceTrail.length, 8); assert.ok(r.weights.priority); assert.ok(r.clusters.length > 0); assert.ok(r.gap.reasoning.length >= 3);
  assert.eq((await call(base, 'GET', '/policy/priorities/nope%7Cnope', { token: policy })).status, 404);
});
await h.test('trends, regions, gaps, investments, outcomes endpoints', async () => {
  const t = (await call(base, 'GET', '/policy/trends', { token: policy })).body; assert.ok(Array.isArray(t.emerging) && Array.isArray(t.persistent) && Array.isArray(t.rapidlyGrowing) && Array.isArray(t.declining));
  assert.eq((await call(base, 'GET', '/policy/regions', { token: policy })).body.regions.length, 10);
  assert.gt((await call(base, 'GET', '/policy/gaps?sector=public_healthcare', { token: policy })).body.gaps.length, 5);
  const inv = (await call(base, 'GET', '/policy/investments', { token: policy })).body; assert.eq(inv.projects.length, 12); assert.ok(inv.projects[0].budgetFormatted.includes('₹'));
  const o = (await call(base, 'GET', '/policy/outcomes', { token: policy })).body; assert.ok(o.service.complaintsTotal > 0); assert.ok(o.projectOutcomes.length >= 1);
});
await h.test('policy Q&A: four canonical questions answered from data', async () => {
  for (const q of ['Which districts have the highest unmet road-development demand?', 'Where is healthcare demand growing faster than infrastructure availability?', 'Which regions have high citizen demand but limited mapped investment coverage?', 'Which development needs are emerging fastest this quarter?']) {
    const r = (await call(base, 'POST', '/policy/query', { token: policy, body: { question: q } })).body;
    assert.ok(r.success && r.table && r.table.rows.length > 0, q); assert.notIncludes(r.intent, 'unknown');
  }
  const why = (await call(base, 'POST', '/policy/query', { token: policy, body: { question: 'Why was this region prioritized?', context: { regionId: 'r08', category: 'public_healthcare' } } })).body;
  assert.eq(why.intent, 'explain'); assert.includes(why.answer, 'Eastern Periphery');
  const off = (await call(base, 'POST', '/policy/query', { token: policy, body: { question: 'Who won the cricket match yesterday?' } })).body; assert.eq(off.intent, 'unknown');
});

h.section('Human review, configuration and audit');
await h.test('review workflow: reject/needs-info require a note; approval is audit-logged', async () => {
  const id = encodeURIComponent(top.id);
  assert.eq((await call(base, 'POST', `/policy/priorities/${id}/review`, { token: policy, body: { status: 'rejected' } })).status, 400);
  assert.eq((await call(base, 'POST', `/policy/priorities/${id}/review`, { token: policy, body: { status: 'weird' } })).status, 400);
  assert.eq((await call(base, 'POST', `/policy/priorities/${id}/review`, { token: officer, body: { status: 'approved' } })).status, 403);
  const ok = await call(base, 'POST', `/policy/priorities/${id}/review`, { token: policy, body: { status: 'approved', note: 'Verified with district health office' } });
  assert.eq(ok.status, 200); assert.eq(ok.body.recommendation.status, 'approved'); assert.eq(ok.body.recommendation.reviewer, 'policymaker');
  const q = (await call(base, 'GET', '/policy/review/recommendations?status=approved', { token: policy })).body; assert.ok(q.recommendations.some(r => r.projectId === top.id));
  const audit = (await call(base, 'GET', '/policy/audit?action=recommendation.approved', { token: admin })).body; assert.ok(audit.logs.length >= 1); assert.ok(audit.chain.valid);
});
await h.test('human correction of a low-confidence classification is applied and traced', async () => {
  const q = (await call(base, 'GET', '/policy/review/requests', { token: policy })).body.requests; assert.ok(q.length > 0, 'expected unresolved-location requests in the review queue');
  const r = await call(base, 'POST', `/policy/review/requests/${q[0].id}`, { token: policy, body: { category: 'waste_management', subcategory: 'garbage_overflow' } }); assert.eq(r.status, 200);
  assert.eq((await call(base, 'POST', `/policy/review/requests/${q[0].id}`, { token: policy, body: { category: 'made_up' } })).status, 400);
});
await h.test('scoring weights: validated, applied, audit-logged, resettable', async () => {
  assert.eq((await call(base, 'PUT', '/policy/config/weights', { token: admin, body: { priority: { nonsense: 0.5 } } })).status, 400);
  assert.eq((await call(base, 'PUT', '/policy/config/weights', { token: admin, body: { priority: { gap: 3 } } })).status, 400);
  const before = (await call(base, 'GET', '/policy/priorities?limit=3', { token: policy })).body.priorities.map(p => p.priorityScore).join();
  const up = await call(base, 'PUT', '/policy/config/weights', { token: admin, body: { priority: { equity: 0.8 } } }); assert.eq(up.status, 200);
  const after = (await call(base, 'GET', '/policy/priorities?limit=3', { token: policy })).body.priorities.map(p => p.priorityScore).join(); assert.ok(before !== after);
  assert.eq((await call(base, 'POST', '/policy/config/weights/reset', { token: admin })).status, 200);
  assert.eq((await call(base, 'GET', '/policy/priorities?limit=3', { token: policy })).body.priorities.map(p => p.priorityScore).join(), before);
});
await h.test('dataset import via API: valid records accepted, invalid rejected with reasons, pipeline re-run', async () => {
  const r = await call(base, 'POST', '/policy/datasets/import', { token: admin, body: { type: 'investments', adapter: 'inline-json', name: 'API test', isSynthetic: true, records: [
    { id: 'INV-API-1', name: 'Test bus depot', sector: 'public_mobility', stage: 'planned', coverage: { r08: 0.6 }, budget: 100000000, targetPopulation: 40000 },
    { id: 'INV-API-2', name: 'Bad', sector: 'nope', stage: 'planned', coverage: { r08: 0.6 } }] } });
  assert.eq(r.status, 201); assert.eq(r.body.imported, 1); assert.eq(r.body.rejected, 1); assert.includes(r.body.errors[0].error, 'unknown sector');
  assert.eq((await call(base, 'POST', '/policy/datasets/import', { token: admin, body: { type: 'assets', adapter: 'json-file', path: '/etc/passwd' } })).status, 400);
  assert.ok((await call(base, 'GET', '/policy/datasets', { token: policy })).body.sources.some(s => s.name === 'API test' && s.isSynthetic));
});

h.section('Judge Mode');
await h.test('judge session issues a policymaker token only in DEMO_MODE; disabled otherwise', async () => {
  const s = await call(base, 'POST', '/judge/session'); assert.eq(s.status, 200); assert.eq(s.body.officer.role, 'policymaker');
  assert.eq((await call(base, 'GET', '/policy/overview', { token: s.body.token })).status, 200);
  assert.eq((await call(B.base, 'POST', '/judge/session')).status, 404); assert.eq((await call(B.base, 'GET', '/judge/status')).body.enabled, false);
});
await h.test('judge flow: Hinglish voice request -> classify -> locate -> cluster -> gap -> investment -> priority -> evidence, no manual DB edits', async () => {
  const sc = (await call(base, 'GET', '/judge/scenario')).body; assert.ok(sc.voiceSamples.length >= 2);
  const before = (await call(base, 'GET', '/policy/overview', { token: policy })).body.totals.citizenRequests;
  const r = await call(base, 'POST', '/judge/submit', { body: { transcript: sc.voiceSamples[0].text, runId: 'int-test', transcriptSource: 'sample' } });
  assert.eq(r.status, 201); const t = r.body.trace;
  assert.eq(t.request.language, 'hinglish'); assert.eq(t.request.category, 'public_healthcare'); assert.eq(t.request.regionName, 'Eastern Periphery');
  assert.gte(t.cluster.requestCount, 2); assert.gt(t.demand.demandScore, 40); assert.gt(t.gap.populationAffected, 10000);
  assert.includes(t.alignment.label, 'limited mapped investment'); assert.ok(t.project.priorityScore > 50); assert.gte(t.recommendation.evidenceTrail.length, 8);
  assert.eq((await call(base, 'GET', '/policy/overview', { token: policy })).body.totals.citizenRequests, before + 1);
  assert.eq((await call(base, 'POST', '/judge/transcribe', { body: { audio: 'AAAA' } })).status, 503);
});
await h.test('judge transcript is validated', async () => assert.eq((await call(base, 'POST', '/judge/submit', { body: { transcript: '' } })).status, 400));

h.section('Empty states and degraded operation');
await h.test('deployment with no datasets returns empty (not error) policy views and a safe Q&A answer', async () => {
  const tk = await login(B.base, 'policymaker', 'Policy@CivicAI2026');
  const o = await call(B.base, 'GET', '/policy/overview', { token: tk }); assert.eq(o.status, 200); assert.eq(o.body.totals.citizenRequests, 0);
  assert.eq((await call(B.base, 'GET', '/policy/priorities', { token: tk })).body.priorities.length, 0);
  const q = await call(B.base, 'POST', '/policy/query', { token: tk, body: { question: 'Which regions have the highest unmet road demand?' } }); assert.eq(q.status, 200); assert.eq(q.body.intent, 'no_data');
  assert.eq((await call(B.base, 'GET', '/policy/geo', { token: tk })).status, 200);
});
await h.test('unknown routes return JSON 404; malformed JSON does not crash the server', async () => {
  assert.eq((await call(base, 'GET', '/nope')).status, 404);
  const r = await fetch(base + '/complaints', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' }); assert.ok(r.status >= 400 && r.status < 500);
  assert.eq((await call(base, 'GET', '/health')).status, 200);
});

const s = h.summary();
for (const { p, db } of procs) { try { p.kill('SIGTERM'); } catch {} if (existsSync(db)) try { unlinkSync(db); } catch {} }
process.exit(s.failed ? 1 : 0);
