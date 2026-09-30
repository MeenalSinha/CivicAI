// ============================================================
// Read models for the policy dashboard. AGGREGATES ONLY:
// no names, phones, ticket ids or raw text ever leave this module.
// ============================================================
import * as dev from '../database/devdb.js';
import { getComplaintsForOutcomes } from './outcomeSource.js';
import { getInstance, formatMoney, round, clamp } from './config.js';
import { categoryLabel, listTaxonomy } from './taxonomy.js';
import { getWeights } from './pipeline.js';
import { classifyTrends, computeOutcomes } from './trends.js';
import { CLASSES } from './investment.js';

const CELL = 0.005; // ~500 m privacy grid for citizen-request layer

function ctx() {
  const inst = getInstance();
  const allRegions = dev.getRegions();
  // Filter to active instance country — ensures multi-country DB doesn't leak cross-country data
  const regions = allRegions.filter(r => !r.countryCode || r.countryCode === inst.country);
  return { regions, byId: Object.fromEntries(regions.map(r => [r.id, r])), weights: getWeights(), inst };
}
const rName = (c, id) => c.byId[id]?.name || id;

export function getOverview() {
  const c = ctx();
  const p = c.weights.params;
  const regionIds = new Set(c.regions.map(r => r.id));
  const allRequests = dev.getRequests();
  const requests = allRequests.filter(r => !r.regionId || regionIds.has(r.regionId));
  const active = requests.filter(r => r.status === 'active');
  const clusters = dev.getClusters().filter(cl => !cl.regionId || regionIds.has(cl.regionId));
  const demands = dev.getDemands().filter(d => regionIds.has(d.regionId));
  const gaps = dev.getGaps().filter(g => regionIds.has(g.regionId));
  const aligns = dev.getAlignments().filter(a => !a.regionId || regionIds.has(a.regionId));
  const projects = dev.getProjects().filter(pr => regionIds.has(pr.regionId));
  const recs = dev.getRecommendations();
  const sources = dev.listDataSources();
  const investments = dev.getInvestments().filter(i => !(i.regionIds?.length) || i.regionIds.some(rid => regionIds.has(rid)));
  const trends = classifyTrends(demands, c.weights);
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x) ?? 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});

  const hotClusters = clusters.filter(cl => cl.requestCount >= 3 && (Date.now() - new Date(cl.lastSeen).getTime()) <= 45 * 86_400_000);
  const highGaps = gaps.filter(g => ['high', 'critical'].includes(g.severityBand));
  const topProjects = projects.filter(pr => pr.band.startsWith('P1') || pr.band.startsWith('P2'));
  const regionPeak = {};
  for (const pr of topProjects) regionPeak[pr.regionId] = Math.max(regionPeak[pr.regionId] || 0, pr.affectedPopulation);
  const affectedPopulation = Object.values(regionPeak).reduce((s, x) => s + x, 0);

  const highDemand = demands.filter(d => d.demandScore >= p.highDemand);
  const alignByKey = Object.fromEntries(aligns.map(a => [a.id, a]));
  const coveredHigh = highDemand.filter(d => (alignByKey[d.id]?.coverage ?? 0) >= p.limitedInvestment).length;
  const totalPop = c.regions.reduce((s, r) => s + r.population, 0);
  const sevenAgo = Date.now() - 7 * 86_400_000;
  const recent7 = active.filter(r => new Date(r.createdAt).getTime() >= sevenAgo).length;
  const prev7 = active.filter(r => { const t = new Date(r.createdAt).getTime(); return t < sevenAgo && t >= sevenAgo - 7 * 86_400_000; }).length;
  const reviewCounts = count(recs, r => r.status);

  return {
    instance: { id: c.inst.id, name: c.inst.name, scope: c.inst.scope, country: c.inst.countryInfo.name, currency: c.inst.countryInfo.currency, dataLabel: c.inst.dataLabel, languages: c.inst.languages, adminLevels: c.inst.adminLevels },
    isSyntheticData: sources.some(s => s.isSynthetic),
    totals: {
      citizenRequests: active.length, duplicatesMerged: requests.filter(r => r.status === 'duplicate').length,
      spamBlocked: requests.filter(r => r.status === 'spam').length, awaitingLocation: active.filter(r => !r.regionId).length,
      activeDemandClusters: hotClusters.length, developmentDemands: demands.length,
      infrastructureGaps: highGaps.length, assessedGaps: gaps.filter(g => g.dataStatus === 'assessed').length,
      highPriorityRegions: Object.keys(regionPeak).length, highPriorityProjects: topProjects.length,
      affectedPopulation, coveredPopulation: totalPop, regions: c.regions.length,
      mappedInvestments: investments.length, mappedBudget: investments.reduce((s, i) => s + (i.budget || 0), 0),
      mappedBudgetFormatted: formatMoney(investments.reduce((s, i) => s + (i.budget || 0), 0), c.inst)
    },
    investmentCoverage: {
      highDemandNeeds: highDemand.length, withMappedInvestment: coveredHigh,
      share: highDemand.length ? round(coveredHigh / highDemand.length, 2) : null,
      byClass: Object.fromEntries(Object.entries(count(aligns, a => a.classification)).map(([k, v]) => [k, { count: v, label: CLASSES[k] || k }]))
    },
    trendIndicators: {
      weeklyRequests: { last7Days: recent7, previous7Days: prev7, change: prev7 ? round((recent7 - prev7) / prev7, 2) : null },
      emerging: trends.emerging.length, rapidlyGrowing: trends.rapidlyGrowing.length, persistent: trends.persistent.length, declining: trends.declining.length
    },
    mix: { channels: count(active, r => r.channel), languages: count(active, r => r.language), categories: Object.fromEntries(Object.entries(count(active, r => r.category)).map(([k, v]) => [k, { label: categoryLabel(k), count: v }])) },
    review: { pending: reviewCounts.pending_review || 0, approved: reviewCounts.approved || 0, rejected: reviewCounts.rejected || 0, needsClassificationReview: active.filter(r => r.needsReview).length },
    topPriorities: projects.slice(0, 5).map(pr => ({ id: pr.id, rank: pr.rank, region: rName(c, pr.regionId), category: pr.category, categoryLabel: categoryLabel(pr.category), priorityScore: pr.priorityScore, band: pr.band, affectedPopulation: pr.affectedPopulation })),
    lastPipelineRun: dev.lastPipelineRun(), weightsVersion: c.weights.version
  };
}

export function getGeo({ category = null, sector = null } = {}) {
  const c = ctx();
  const regionIds = new Set(c.regions.map(r => r.id));
  const k = c.inst.governance?.kAnonymityThreshold ?? c.weights.params.kAnonymity;
  const active = dev.getRequests({ status: 'active', category: category || undefined })
    .filter(r => r.lat != null && (!r.regionId || regionIds.has(r.regionId)));
  const cells = new Map();
  for (const r of active) {
    const key = `${Math.round(r.lat / CELL)}:${Math.round(r.lng / CELL)}`;
    const cell = cells.get(key) || { lat: Math.round(r.lat / CELL) * CELL, lng: Math.round(r.lng / CELL) * CELL, count: 0, categories: {} };
    cell.count++; cell.categories[r.category] = (cell.categories[r.category] || 0) + 1; cells.set(key, cell);
  }
  const shown = [...cells.values()].filter(x => x.count >= k);
  const suppressed = [...cells.values()].filter(x => x.count < k).reduce((s, x) => s + x.count, 0);
  const demands = dev.getDemands().filter(d => regionIds.has(d.regionId));
  const gaps = dev.getGaps().filter(g => regionIds.has(g.regionId) && (!sector || g.sector === sector));
  const aligns = dev.getAlignments().filter(a => !a.regionId || regionIds.has(a.regionId));
  const investments = dev.getInvestments().filter(i => !(i.regionIds?.length) || i.regionIds.some(rid => regionIds.has(rid)));
  const projects = dev.getProjects().filter(pr => regionIds.has(pr.regionId));
  const clusters = dev.getClusters().filter(cl => (!cl.regionId || regionIds.has(cl.regionId)) && cl.requestCount >= 3 && (!category || cl.category === category));
  return {
    center: c.inst.mapCenter, privacyGridMeters: 500, kAnonymity: k,
    requestCells: shown, suppressedRequests: suppressed,
    hotspots: clusters.map(cl => ({ id: cl.id, category: cl.category, categoryLabel: categoryLabel(cl.category), subcategory: cl.subcategory, lat: cl.centroidLat, lng: cl.centroidLng, radiusKm: cl.radiusKm, requestCount: cl.requestCount, uniqueLocations: cl.uniqueLocations, affectedPopulation: cl.affectedPopulation, avgUrgency: cl.avgUrgency, region: rName(c, cl.regionId), regionId: cl.regionId })),
    regions: c.regions.map(r => {
      const rg = gaps.filter(g => g.regionId === r.id);
      const worst = rg.slice().sort((a, b) => b.severity - a.severity)[0];
      const meanSeverity = rg.length ? rg.reduce((s, g) => s + g.severity, 0) / rg.length : null;
      return { id: r.id, name: r.name, lat: r.lat, lng: r.lng, radiusKm: r.radiusKm, population: r.population, density: r.density,
        gapSeverity: sector ? (rg[0]?.severity ?? null) : (worst?.severity ?? null), gapBand: sector ? rg[0]?.severityBand : worst?.severityBand, meanGapSeverity: meanSeverity == null ? null : round(meanSeverity, 1),
        worstSector: worst ? { sector: worst.sector, label: categoryLabel(worst.sector), severity: worst.severity } : null,
        topDemand: demands.filter(d => d.regionId === r.id && (!category || d.category === category)).slice(0, 1).map(d => ({ category: d.category, label: categoryLabel(d.category), demandScore: d.demandScore }))[0] || null,
        investments: investments.filter(i => i.coverage?.[r.id] != null && (!sector || i.sector === sector)).map(i => ({ id: i.id, name: i.name, sector: i.sector, stage: i.stage, share: i.coverage[r.id], budgetFormatted: formatMoney(i.budget, c.inst), isSynthetic: i.isSynthetic })) };
    }),
    recommended: projects.filter(p => !category || p.category === category).slice(0, 12).map(p => ({ id: p.id, rank: p.rank, region: rName(c, p.regionId), regionId: p.regionId, lat: c.byId[p.regionId]?.lat, lng: c.byId[p.regionId]?.lng, category: p.category, categoryLabel: categoryLabel(p.category), priorityScore: p.priorityScore, band: p.band })),
    alignmentClasses: CLASSES
  };
}

export function getPriorities({ band, category, regionId, limit = 50 } = {}) {
  const c = ctx();
  const regionIds = new Set(c.regions.map(r => r.id));
  const demands = Object.fromEntries(dev.getDemands().filter(d => regionIds.has(d.regionId)).map(d => [d.id, d]));
  const gaps = Object.fromEntries(dev.getGaps().filter(g => regionIds.has(g.regionId)).map(g => [g.id, g]));
  const aligns = Object.fromEntries(dev.getAlignments().filter(a => !a.regionId || regionIds.has(a.regionId)).map(a => [a.id, a]));
  const recs = Object.fromEntries(dev.getRecommendations().map(r => [r.projectId, r]));
  let items = dev.getProjects().filter(pr => regionIds.has(pr.regionId));
  if (band) items = items.filter(p => p.band.startsWith(band));
  if (category) items = items.filter(p => p.category === category);
  if (regionId) items = items.filter(p => p.regionId === regionId);
  return items.slice(0, Math.min(200, limit)).map(p => {
    const d = demands[p.id], g = gaps[p.id], a = aligns[p.id];
    return {
      id: p.id, rank: p.rank, regionId: p.regionId, region: rName(c, p.regionId), category: p.category, categoryLabel: categoryLabel(p.category),
      priorityScore: p.priorityScore, band: p.band, confidence: p.confidence, affectedPopulation: p.affectedPopulation,
      demandScore: d?.demandScore ?? null, growthRate: d?.growthRate ?? null, requestCount: d?.requestCount ?? 0,
      infrastructureGap: g ? { gap: g.gap, availability: g.availability, severity: g.severity, band: g.severityBand, dataStatus: g.dataStatus } : null,
      existingInvestment: a ? { classification: a.classification, label: CLASSES[a.classification], coverage: a.coverage, projects: a.matched.map(m => ({ name: m.name, stage: m.stage })) } : null,
      proposedIntervention: p.proposedIntervention, responsibleDepartment: p.responsibleDepartment, rationale: p.rationale,
      evidence: p.topEvidence, reviewStatus: recs[p.id]?.status || 'pending_review'
    };
  });
}

export function getProjectDetail(id) {
  const c = ctx();
  const project = dev.getProjects().find(p => p.id === id);
  if (!project) return null;
  const demand = dev.getDemands().find(d => d.id === id) || null;
  const gap = dev.getGaps().find(g => g.id === id) || null;
  const alignment = dev.getAlignments().find(a => a.id === id) || null;
  const rec = dev.getRecommendationByProject(id);
  const region = c.byId[project.regionId];
  const clusters = dev.getClusters().filter(cl => cl.regionId === project.regionId && cl.category === project.category);
  return {
    project: { ...project, region: region?.name, categoryLabel: categoryLabel(project.category) },
    demand, gap, alignment: alignment ? { ...alignment, label: CLASSES[alignment.classification], matched: alignment.matched.map(m => ({ ...m, budgetFormatted: formatMoney(m.budget, c.inst) })) } : null,
    recommendation: rec, region: region && { id: region.id, name: region.name, population: region.population, density: region.density, isSynthetic: region.isSynthetic },
    clusters: clusters.map(cl => ({ id: cl.id, subcategory: cl.subcategory, requestCount: cl.requestCount, uniqueLocations: cl.uniqueLocations, radiusKm: cl.radiusKm, affectedPopulation: cl.affectedPopulation, lat: cl.centroidLat, lng: cl.centroidLng })),
    weights: { demand: c.weights.demand, priority: c.weights.priority }
  };
}

export function getTrends() {
  const c = ctx();
  const regionIds = new Set(c.regions.map(r => r.id));
  const t = classifyTrends(dev.getDemands().filter(d => regionIds.has(d.regionId)), c.weights);
  const enrich = arr => arr.map(x => ({ ...x, region: rName(c, x.regionId), categoryLabel: categoryLabel(x.category) }));
  return { windowDays: c.weights.params.windowDays, weeks: c.weights.params.persistenceWeeks, emerging: enrich(t.emerging), rapidlyGrowing: enrich(t.rapidlyGrowing), persistent: enrich(t.persistent), declining: enrich(t.declining), stableCount: t.stable.length };
}

export function getRegionList() {
  const c = ctx();
  const demands = dev.getDemands(), gaps = dev.getGaps();
  return c.regions.map(r => ({
    id: r.id, name: r.name, population: r.population, densityPerKm2: r.density, level: r.level, isSynthetic: r.isSynthetic,
    topNeeds: demands.filter(d => d.regionId === r.id).slice(0, 3).map(d => ({ category: d.category, label: categoryLabel(d.category), demandScore: d.demandScore, requests: d.requestCount })),
    gaps: gaps.filter(g => g.regionId === r.id && g.dataStatus === 'assessed').map(g => ({ sector: g.sector, label: categoryLabel(g.sector), availability: g.availability, severity: g.severity, band: g.severityBand }))
  }));
}

export function getGapsView({ regionId, sector } = {}) {
  const c = ctx();
  const regionIds = new Set(c.regions.map(r => r.id));
  return dev.getGaps()
    .filter(g => regionIds.has(g.regionId) && (!regionId || g.regionId === regionId) && (!sector || g.sector === sector))
    .map(g => ({ ...g, region: rName(c, g.regionId), sectorLabel: categoryLabel(g.sector) }));
}

export function getInvestmentsView() {
  const c = ctx();
  const regionIds = new Set(c.regions.map(r => r.id));
  const investments = dev.getInvestments().filter(i => !(i.regionIds?.length) || i.regionIds.some(rid => regionIds.has(rid)));
  const aligns = dev.getAlignments()
    .filter(a => !a.regionId || regionIds.has(a.regionId))
    .map(a => ({ ...a, region: rName(c, a.regionId), categoryLabel: categoryLabel(a.category), label: CLASSES[a.classification] }));
  return {
    projects: investments.map(i => ({ ...i, budgetFormatted: formatMoney(i.budget, c.inst), regions: Object.keys(i.coverage || {}).map(id => ({ id, name: rName(c, id), share: i.coverage[id] })) })),
    alignments: aligns.filter(a => a.classification !== 'monitor').sort((x, y) => y.coverage - x.coverage), classes: CLASSES
  };
}

export function getOutcomes() {
  const c = ctx();
  const regionIds = new Set(c.regions.map(r => r.id));
  const investments = dev.getInvestments().filter(i => !(i.regionIds?.length) || i.regionIds.some(rid => regionIds.has(rid)));
  const requests = dev.getRequests().filter(r => !r.regionId || regionIds.has(r.regionId));
  const out = computeOutcomes({ investments, requests, complaints: getComplaintsForOutcomes(), feedback: dev.getFeedback() });
  out.projectOutcomes = out.projectOutcomes.map(o => ({ ...o, region: rName(c, o.regionId), sectorLabel: categoryLabel(o.sector) }));
  return out;
}

export function getPolicyMeta() {
  const c = ctx();
  return { instance: { id: c.inst.id, name: c.inst.name, country: c.inst.countryInfo, languages: c.inst.languages, adminLevels: c.inst.adminLevels, dataLabel: c.inst.dataLabel, departments: c.inst.departments },
    taxonomy: listTaxonomy(), weights: c.weights, dataSources: dev.listDataSources(), governance: c.inst.governance };
}
