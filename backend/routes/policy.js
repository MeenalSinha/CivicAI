// ============================================================
// /api/policy/*  - policy intelligence API (aggregates only, role-protected)
// /api/judge/*   - Judge Mode helpers (enabled only when DEMO_MODE=true)
// /api/channels/* - messaging webhooks (enabled only with CHANNEL_WEBHOOK_SECRET)
// ============================================================
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import * as dev from '../database/devdb.js';
import { findOfficerByUsername } from '../database/db.js';
import * as views from '../intelligence/views.js';
import { runPipeline, getWeights } from '../intelligence/pipeline.js';
import { answerPolicyQuestion, EXAMPLE_QUESTIONS } from '../intelligence/policyQuery.js';
import { ingestRequest, IntakeError } from '../intelligence/intake.js';
import { isValidCategory, categoryLabel } from '../intelligence/taxonomy.js';
import { importDataset, listAdapters } from '../adapters/index.js';
import { SCHEMAS } from '../adapters/schemas.js';
import { DEFAULT_WEIGHTS, getInstance } from '../intelligence/config.js';
import { ensureDemoData } from '../demo/loadDemo.js';
import { transcribeVoice } from '../ai/aiService.js';
import { normalizeChannelPayload } from './channels.js';

const READ_ROLES = ['officer', 'policymaker', 'admin'];
const DECIDE_ROLES = ['policymaker', 'admin'];

export const demoMode = () => String(process.env.DEMO_MODE ?? 'true') === 'true';

export function createPolicyRouter({ requireAuth, broadcast, sanitize, jwtSecret, jwtExpires }) {
  const router = Router();
  const role = (...allowed) => (req, res, next) =>
    allowed.includes(req.officer?.role) ? next() : res.status(403).json({ error: `Your role (${req.officer?.role || 'none'}) is not permitted to perform this action.` });
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[policy]', e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal error while computing policy intelligence.' }); } };
  const actor = req => ({ actorType: 'user', actorId: req.officer?.username });

  // ---------- read models ----------
  router.get('/policy/meta', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, ...views.getPolicyMeta(), examples: EXAMPLE_QUESTIONS })));
  router.get('/policy/overview', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, ...views.getOverview() })));
  router.get('/policy/geo', requireAuth, role(...READ_ROLES), wrap((req, res) => {
    const category = req.query.category && isValidCategory(String(req.query.category)) ? String(req.query.category) : null;
    const sector = req.query.sector && isValidCategory(String(req.query.sector)) ? String(req.query.sector) : null;
    res.json({ success: true, ...views.getGeo({ category, sector }) });
  }));
  router.get('/policy/priorities', requireAuth, role(...READ_ROLES), wrap((req, res) => {
    const { band, category, regionId } = req.query;
    res.json({ success: true, priorities: views.getPriorities({ band: band && String(band).slice(0, 2), category: category && String(category), regionId: regionId && String(regionId), limit: parseInt(req.query.limit) || 50 }) });
  }));
  router.get('/policy/priorities/:id', requireAuth, role(...READ_ROLES), wrap((req, res) => {
    const d = views.getProjectDetail(decodeURIComponent(req.params.id));
    if (!d) return res.status(404).json({ error: 'Priority item not found.' });
    res.json({ success: true, ...d });
  }));
  router.get('/policy/trends', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, ...views.getTrends() })));
  router.get('/policy/regions', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, regions: views.getRegionList() })));
  router.get('/policy/gaps', requireAuth, role(...READ_ROLES), wrap((req, res) => res.json({ success: true, gaps: views.getGapsView({ regionId: req.query.regionId && String(req.query.regionId), sector: req.query.sector && String(req.query.sector) }) })));
  router.get('/policy/investments', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, ...views.getInvestmentsView() })));
  router.get('/policy/outcomes', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, ...views.getOutcomes() })));

  // ---------- policy Q&A ----------
  router.post('/policy/query', requireAuth, role(...READ_ROLES), wrap(async (req, res) => {
    const question = sanitize(req.body.question || '', 400);
    if (!question) return res.status(400).json({ error: 'A question is required.' });
    const context = req.body.context && typeof req.body.context === 'object' ? { regionId: sanitize(String(req.body.context.regionId || ''), 30), category: sanitize(String(req.body.context.category || ''), 40) } : {};
    const result = await answerPolicyQuestion(question, { context, narrate: req.body.narrate !== false });
    dev.audit({ ...actor(req), action: 'policy.query', entityType: 'query', details: { question, intent: result.intent, narrated: !!result.narration?.verified } });
    res.json({ success: true, ...result });
  }));

  // ---------- human review workflow ----------
  router.get('/policy/review/recommendations', requireAuth, role(...READ_ROLES), wrap((req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const pri = Object.fromEntries(views.getPriorities({ limit: 200 }).map(p => [p.id, p]));
    const items = dev.getRecommendations().filter(r => !status || r.status === status).map(r => ({ projectId: r.projectId, status: r.status, reviewer: r.reviewer, reviewNote: r.reviewNote, reviewedAt: r.reviewedAt, version: r.version, priority: pri[r.projectId] || null }))
      .filter(r => r.priority).sort((a, b) => a.priority.rank - b.priority.rank);
    res.json({ success: true, recommendations: items });
  }));
  router.post('/policy/priorities/:id/review', requireAuth, role(...DECIDE_ROLES), wrap((req, res) => {
    const id = decodeURIComponent(req.params.id);
    const status = String(req.body.status || '');
    if (!['approved', 'rejected', 'needs_info', 'pending_review'].includes(status)) return res.status(400).json({ error: 'status must be approved, rejected, needs_info or pending_review.' });
    const note = sanitize(req.body.note || '', 600);
    if (['rejected', 'needs_info'].includes(status) && !note) return res.status(400).json({ error: 'A note is required when rejecting or requesting more information.' });
    if (!dev.getRecommendationByProject(id)) return res.status(404).json({ error: 'Recommendation not found.' });
    const rec = dev.reviewRecommendation(id, { status, reviewer: req.officer.username, note });
    dev.audit({ ...actor(req), action: `recommendation.${status}`, entityType: 'policy_recommendation', entityId: id, details: { note, version: rec.version } });
    broadcast('recommendation_reviewed', { projectId: id, status });
    res.json({ success: true, recommendation: rec });
  }));
  router.get('/policy/review/requests', requireAuth, role(...DECIDE_ROLES), wrap((_q, res) => {
    // redacted text only, no submitter/complaint identifiers
    const items = dev.getRequests({ status: 'active' }).filter(r => r.needsReview).slice(-50).reverse().map(r => ({ id: r.id, text: r.description, language: r.language, category: r.category, subcategory: r.subcategory, confidence: r.confidence, classifier: r.classifier, reason: r.reviewReason, regionId: r.regionId, createdAt: r.createdAt }));
    res.json({ success: true, requests: items });
  }));
  router.post('/policy/review/requests/:id', requireAuth, role(...DECIDE_ROLES), wrap((req, res) => {
    const r = dev.getRequestById(String(req.params.id).slice(0, 40));
    if (!r) return res.status(404).json({ error: 'Request not found.' });
    const category = String(req.body.category || ''), subcategory = req.body.subcategory ? String(req.body.subcategory) : 'general';
    if (!isValidCategory(category, subcategory === 'general' ? undefined : subcategory)) return res.status(400).json({ error: 'Unknown category/subcategory.' });
    reclassify(r.id, category, subcategory, req.officer.username);
    runPipeline({ trigger: 'human-review', actor: req.officer.username });
    res.json({ success: true });
  }));

  // ---------- operations ----------
  router.post('/policy/pipeline/run', requireAuth, role(...DECIDE_ROLES), wrap((req, res) => {
    const run = runPipeline({ trigger: 'manual', actor: req.officer.username });
    broadcast('intelligence_updated', { stats: run.stats });
    res.json({ success: true, run });
  }));
  router.get('/policy/config/weights', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, weights: getWeights(), defaults: DEFAULT_WEIGHTS })));
  router.put('/policy/config/weights', requireAuth, role('admin'), wrap((req, res) => {
    const cur = getWeights();
    const next = { ...cur, version: `custom-${new Date().toISOString().slice(0, 19)}` };
    for (const grp of ['demand', 'priority']) {
      if (!req.body[grp]) continue;
      for (const [k, v] of Object.entries(req.body[grp])) {
        if (!(k in DEFAULT_WEIGHTS[grp])) return res.status(400).json({ error: `Unknown ${grp} weight "${k}".` });
        if (typeof v !== 'number' || v < 0 || v > 1) return res.status(400).json({ error: `Weight ${k} must be a number between 0 and 1.` });
        next[grp] = { ...next[grp], [k]: v };
      }
    }
    if (req.body.params) for (const [k, v] of Object.entries(req.body.params)) {
      if (!(k in DEFAULT_WEIGHTS.params) || typeof v !== 'number' || !(v >= 0)) return res.status(400).json({ error: `Invalid parameter "${k}".` });
      next.params = { ...next.params, [k]: v };
    }
    dev.setConfigValue('weights', next, req.officer.username);
    dev.audit({ ...actor(req), action: 'config.weights_updated', entityType: 'config', entityId: 'weights', details: { version: next.version, demand: next.demand, priority: next.priority } });
    const run = runPipeline({ trigger: 'weights-changed', actor: req.officer.username });
    broadcast('intelligence_updated', { stats: run.stats });
    res.json({ success: true, weights: next, run });
  }));
  router.post('/policy/config/weights/reset', requireAuth, role('admin'), wrap((req, res) => {
    dev.setConfigValue('weights', null, req.officer.username);
    dev.audit({ ...actor(req), action: 'config.weights_reset', entityType: 'config', entityId: 'weights' });
    const run = runPipeline({ trigger: 'weights-reset', actor: req.officer.username });
    res.json({ success: true, weights: getWeights(), run });
  }));
  router.get('/policy/audit', requireAuth, role('admin'), wrap((req, res) => res.json({ success: true, logs: dev.getAuditLogs({ limit: parseInt(req.query.limit) || 100, entityType: req.query.entityType && String(req.query.entityType), entityId: req.query.entityId && String(req.query.entityId), action: req.query.action && String(req.query.action) }), chain: dev.verifyAuditChain() })));
  router.get('/policy/datasets', requireAuth, role(...READ_ROLES), wrap((_q, res) => res.json({ success: true, sources: dev.listDataSources(), adapters: listAdapters(), schemas: SCHEMAS })));
  router.post('/policy/datasets/import', requireAuth, role('admin'), wrap(async (req, res) => {
    const { type, adapter, records, csv, url, recordsPath, geojson, name, isSynthetic, license } = req.body || {};
    if (!type || !adapter) return res.status(400).json({ error: 'type and adapter are required.' });
    const options = adapter === 'inline-json' ? { records } : adapter === 'inline-csv' ? { csv } : adapter === 'http-json' ? { url, recordsPath } : adapter === 'geojson-boundaries' ? { geojson } : null;
    if (!options) return res.status(400).json({ error: `Adapter "${adapter}" is not available through the API (file adapters are server-side only).` });
    try {
      const result = await importDataset({ type, adapter, options, source: { name: sanitize(name || '', 120) || undefined, isSynthetic: !!isSynthetic, license: sanitize(license || '', 120) }, actor: { type: 'user', id: req.officer.username } });
      const run = runPipeline({ trigger: 'dataset-import', actor: req.officer.username });
      broadcast('intelligence_updated', { stats: run.stats });
      res.status(result.imported ? 201 : 422).json({ success: !!result.imported, ...result });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  router.post('/policy/demo/reset', requireAuth, role('admin'), wrap(async (req, res) => {
    const r = await ensureDemoData({ force: true });
    dev.audit({ ...actor(req), action: 'demo.reset', entityType: 'data_source', entityId: 'demo' });
    broadcast('intelligence_updated', { stats: r.pipeline });
    res.json({ success: true, ...r });
  }));
  router.get('/taxonomy', (_q, res) => res.json({ success: true, categories: views.getPolicyMeta().taxonomy }));

  // ---------- Judge Mode (demo only) ----------
  const judgeGuard = (_req, res, next) => demoMode() ? next() : res.status(404).json({ error: 'Judge Mode is disabled on this deployment (DEMO_MODE=false).' });
  router.get('/judge/status', (_req, res) => res.json({ enabled: demoMode() }));
  router.post('/judge/session', judgeGuard, wrap((_req, res) => {
    const user = findOfficerByUsername('policymaker');
    if (!user) return res.status(503).json({ error: 'Demo policymaker account is not available.' });
    const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, judge: true }, jwtSecret, { expiresIn: '2h' });
    res.json({ success: true, token, officer: { id: user.id, username: user.username, name: user.name, role: user.role } });
  }));
  router.get('/judge/scenario', judgeGuard, wrap((_q, res) => {
    const inst = getInstance();
    const countryCode = inst.country;
    const samples = JUDGE_SAMPLES.filter(s => s.country === countryCode || s.country === 'ALL');
    const defaultSample = countryCode === 'BR' ? 'pt-water-jardim' : 'hinglish-healthcare';
    res.json({ success: true, dataLabel: inst.dataLabel, voiceSamples: samples.length ? samples : JUDGE_SAMPLES, defaultSample, instance: { id: inst.id, country: inst.countryInfo.name, languages: inst.languages, adminLevels: inst.adminLevels } });
  }));
  router.post('/judge/transcribe', judgeGuard, wrap(async (req, res) => {
    const { audio, mimeType } = req.body || {};
    if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'Base64 audio is required.' });
    try {
      const t = await transcribeVoice(audio.replace(/^data:[^;]+;base64,/, ''), mimeType || 'audio/webm');
      res.json({ success: true, transcript: t.transcript, language: t.language, source: 'whisper' });
    } catch (e) {
      res.status(503).json({ error: 'Whisper transcription is not enabled on this deployment. Use a sample transcript or type the request.', code: 'WHISPER_UNAVAILABLE' });
    }
  }));
  router.post('/judge/submit', judgeGuard, wrap(async (req, res) => {
    const transcript = sanitize(req.body.transcript || '', 1500);
    if (!transcript) return res.status(400).json({ error: 'Transcript is required.' });
    const runId = sanitize(String(req.body.runId || ''), 40) || String(Date.now());
    const result = await ingestRequest({
      text: transcript, channel: 'voice', legacyChannel: 'voice', submitterKey: `judge-${runId}`, citizenName: 'Judge Demo Citizen', citizenPhone: 'Not provided',
      skipPipeline: true, lat: req.body.lat, lng: req.body.lng, fallbackLat: 28.63, fallbackLng: 77.32
    });
    if (result.duplicate) return res.json({ success: true, duplicate: true, message: result.reason });
    const t0 = Date.now();
    const run = runPipeline({ trigger: 'judge-submit' });
    if (result.complaint) broadcast('new_complaint', result.complaint);
    broadcast('intelligence_updated', { stats: run.stats });
    res.status(201).json({ success: true, transcriptSource: req.body.transcriptSource || 'typed', trace: buildTrace(result.request.id), pipelineMs: Date.now() - t0 });
  }));

  return router;
}

function reclassify(reqId, category, subcategory, by) {
  const r = dev.getRequestById(reqId);
  dev.updateRequestClassification(reqId, category, subcategory, r?.trace || [], by);
  dev.audit({ actorType: 'user', actorId: by, action: 'request.reclassified', entityType: 'citizen_request', entityId: reqId, details: { from: `${r.category}.${r.subcategory}`, to: `${category}.${subcategory}` } });
}

export const JUDGE_SAMPLES = [
  // India samples
  { id: 'hinglish-healthcare', label: 'Hinglish — Healthcare Access', language: 'Hinglish', country: 'IN', text: 'South West Delhi mein koi hospital nahi hai, aspatal bahut door hai. Hamare mohalla ke kai parivar pareshan hain, kripya jaldi dhyan dein.' },
  { id: 'hindi-healthcare', label: 'Hindi (Devanagari) — Healthcare', language: 'Hindi', country: 'IN', text: 'South West Delhi में अस्पताल नहीं है, इलाज के लिए बहुत दूर जाना पड़ता है। हमारे मोहल्ले के सभी परिवार परेशान हैं।' },
  { id: 'hinglish-water', label: 'Hinglish — Water Supply', language: 'Hinglish', country: 'IN', text: 'West Delhi mein paani nahi aa raha 5 din se, poore mohalla ke log pareshan hain.' },
  // Brazil samples
  { id: 'pt-water-jardim', label: 'Português — Falta de Água', language: 'Portuguese', country: 'BR', text: 'Falta de água há 5 dias no Jardim Ângela. Estamos sem abastecimento e as famílias estão sofrendo muito.' },
  { id: 'pt-flood-capao', label: 'Português — Alagamento', language: 'Portuguese', country: 'BR', text: 'Alagamento na rua do Capão Redondo toda vez que chove. A água chega até o joelho, carros ficam presos e crianças não conseguem ir para a escola.' },
  { id: 'pt-health-parelheiros', label: 'Português — Falta de UBS', language: 'Portuguese', country: 'BR', text: 'Não tem UBS perto do Parelheiros. Para ir ao posto de saúde são mais de 8km. A população está muito carente de atendimento médico.' }
];

/** Everything the pipeline derived from one request, for the Judge Mode walkthrough. */
export function buildTrace(requestId) {
  const r = dev.getRequestById(requestId);
  if (!r) return null;
  const inst = getInstance();
  const region = dev.getRegions().find(x => x.id === r.regionId) || null;
  const key = r.regionId ? `${r.regionId}|${r.category}` : null;
  const demand = key ? dev.getDemands().find(d => d.id === key) : null;
  const gap = key ? dev.getGaps().find(g => g.id === key) : null;
  const alignment = key ? dev.getAlignments().find(a => a.id === key) : null;
  const project = key ? dev.getProjects().find(p => p.id === key) : null;
  const cluster = r.clusterId ? dev.getClusters().find(c => c.id === r.clusterId) : null;
  const rec = project ? dev.getRecommendationByProject(project.id) : null;
  return {
    request: { id: r.id, channel: r.channel, language: r.language, category: r.category, categoryLabel: categoryLabel(r.category), subcategory: r.subcategory, text: r.description, locationText: r.locationText, lat: r.lat, lng: r.lng, locationSource: r.locationSource, regionId: r.regionId, regionName: region?.name, urgency: r.urgency, urgencyBand: r.urgencyBand, populationRelevance: r.populationRelevance, affectedInfrastructure: r.affectedInfrastructure, confidence: r.confidence, classifier: r.classifier, matchedTerms: r.matchedTerms, createdAt: r.createdAt },
    cluster: cluster && { id: cluster.id, requestCount: cluster.requestCount, uniqueLocations: cluster.uniqueLocations, radiusKm: cluster.radiusKm, affectedPopulation: cluster.affectedPopulation, lat: cluster.centroidLat, lng: cluster.centroidLng },
    demand, gap, alignment: alignment && { ...alignment, label: CLASS_LABEL(alignment.classification) }, project, recommendation: rec && { status: rec.status, evidenceTrail: rec.evidenceTrail, modelTrace: rec.modelTrace },
    region: region && { id: region.id, name: region.name, population: region.population },
    dataLabel: inst.dataLabel
  };
}
import { CLASSES } from '../intelligence/investment.js';
const CLASS_LABEL = k => CLASSES[k] || k;
