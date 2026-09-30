// ============================================================
// Intelligence pipeline orchestrator.
// requests -> clusters -> demand -> gaps -> alignment -> priorities -> recommendations
// Deterministic and idempotent: recomputes derived tables from source tables.
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import * as dev from '../database/devdb.js';
import { DEFAULT_WEIGHTS, getInstance } from './config.js';
import { clusterRequests } from './clustering.js';
import { computeDemands } from './demand.js';
import { computeGaps } from './gaps.js';
import { computeAlignments } from './investment.js';
import { computePriorities } from './priority.js';
import { buildEvidenceTrail } from './explain.js';

export function getWeights() {
  const stored = dev.getConfigValue('weights', null);
  if (!stored) return DEFAULT_WEIGHTS;
  return {
    ...DEFAULT_WEIGHTS, ...stored,
    demand: { ...DEFAULT_WEIGHTS.demand, ...(stored.demand || {}) },
    priority: { ...DEFAULT_WEIGHTS.priority, ...(stored.priority || {}) },
    params: { ...DEFAULT_WEIGHTS.params, ...(stored.params || {}) }
  };
}

const listeners = [];
export function onPipelineComplete(cb) { listeners.push(cb); }

export function runPipeline({ trigger = 'manual', now = new Date(), actor = null } = {}) {
  const started = Date.now();
  const weights = getWeights();
  const inst = getInstance();
  const allRegions = dev.getRegions();
  // Scope pipeline to active country instance — multi-country DB support
  const regions = allRegions.filter(r => !r.countryCode || r.countryCode === inst.country);
  const regionIds = new Set(regions.map(r => r.id));
  const regionsById = Object.fromEntries(regions.map(r => [r.id, r]));
  const assets = dev.getAssets().filter(a => !a.regionId || regionIds.has(a.regionId));
  const investments = dev.getInvestments().filter(i => !(i.regionIds?.length) || i.regionIds.some(rid => regionIds.has(rid)));
  const all = dev.getRequests().filter(r => !r.regionId || regionIds.has(r.regionId));
  const active = all.filter(r => r.status === 'active');
  const duplicates = all.filter(r => r.status === 'duplicate');

  const { clusters, assignments } = clusterRequests(active, regionsById, weights.params, now);
  dev.replaceClusters(clusters, assignments);
  const assignMap = new Map(assignments);
  const activeWithCluster = active.map(r => ({ ...r, clusterId: assignMap.get(r.id) || null }));

  const demands = computeDemands({ requests: activeWithCluster, duplicates, clusters, regionsById, weights, now });
  dev.replaceDemands(demands);
  const gaps = computeGaps({ regions, assets, demands, weights, now });
  dev.replaceGaps(gaps);
  const alignments = computeAlignments({ demands, gaps, investments, weights, now });
  dev.replaceAlignments(alignments);
  const projects = computePriorities({ demands, gaps, alignments, regions, requests: activeWithCluster, clusters, weights, now });
  dev.replaceProjects(projects);

  // Recommendations: regenerate evidence trail; preserve human-review status
  const demandByKey = Object.fromEntries(demands.map(d => [d.id, d]));
  const gapByKey = Object.fromEntries(gaps.map(g => [g.id, g]));
  const alignByKey = Object.fromEntries(alignments.map(a => [a.id, a]));
  for (const p of projects) {
    const region = regionsById[p.regionId];
    const trail = buildEvidenceTrail({ project: p, demand: demandByKey[p.id], gap: gapByKey[p.id], alignment: alignByKey[p.id], region, clusters, weights, instance: inst });
    dev.upsertRecommendation({
      id: `REC-${uuidv4().slice(0, 8)}`, projectId: p.id, text: p.rationale, evidenceTrail: trail,
      modelTrace: {
        engine: 'deterministic-scoring', weightsVersion: weights.version, weights: { demand: weights.demand, priority: weights.priority },
        classifier: 'lexicon-v1 (+ Mistral/vision only for low-confidence or image input)', llmUsedForScores: false,
        inputs: { requests: demandByKey[p.id]?.requestCount ?? 0, assets: assets.filter(a => a.regionId === p.regionId && a.sector === p.category).length, investments: alignByKey[p.id]?.matched.length ?? 0 },
        computedAt: now.toISOString(), instance: inst.id
      }
    });
  }
  dev.pruneRecommendations(projects.map(p => p.id));

  const stats = {
    requestsTotal: all.length, requestsActive: active.length, duplicatesExcluded: duplicates.length,
    spamExcluded: all.filter(r => r.status === 'spam').length, unlocated: active.filter(r => !r.regionId).length,
    clusters: clusters.length, demands: demands.length, gaps: gaps.length, projects: projects.length, ms: Date.now() - started
  };
  const runRec = { id: `RUN-${uuidv4().slice(0, 8)}`, trigger, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), stats };
  dev.recordPipelineRun(runRec);
  dev.audit({ actorType: actor ? 'user' : 'system', actorId: actor, action: 'pipeline.run', entityType: 'pipeline', entityId: runRec.id, details: { trigger, ...stats } });
  const result = { ...runRec, weightsVersion: weights.version };
  listeners.forEach(cb => { try { cb(result); } catch {} });
  return result;
}

// Debounced background recompute for real-time intake (coalesces bursts of submissions)
let timer = null;
let pendingResolvers = [];
export function schedulePipeline(trigger = 'intake', delayMs = 400, onDone) {
  if (onDone) pendingResolvers.push(onDone);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const cbs = pendingResolvers; pendingResolvers = [];
    let res = null;
    try { res = runPipeline({ trigger }); } catch (e) { console.error('[Pipeline] failed:', e.message); }
    cbs.forEach(cb => { try { cb(res); } catch {} });
  }, delayMs);
}
