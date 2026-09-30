// ============================================================
// Demand aggregation + configurable Demand Score.
// Programmatic and fully explainable - no LLM involved.
// ============================================================
import { clamp, round, normalizeWeights } from './config.js';
import { getCategory, getSubcategory } from './taxonomy.js';
import { gridKey } from './clustering.js';

const DAY = 86_400_000;

export function computeDemands({ requests, duplicates = [], clusters, regionsById, weights, now = new Date() }) {
  const p = weights.params;
  const w = normalizeWeights(weights.demand);
  const nowMs = now.getTime();
  const winMs = p.windowDays * DAY;
  const active = requests.filter(r => r.status === 'active');
  const clusterById = Object.fromEntries(clusters.map(c => [c.id, c]));

  const groups = new Map();
  for (const r of active) {
    if (!r.regionId) continue;
    const k = `${r.regionId}|${r.category}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dupCount = {};
  for (const d of duplicates) if (d.regionId) { const k = `${d.regionId}|${d.category}`; dupCount[k] = (dupCount[k] || 0) + 1; }

  const regionTotals = {};
  for (const r of active) if (r.regionId) regionTotals[r.regionId] = (regionTotals[r.regionId] || 0) + 1;

  const demands = [];
  for (const [key, rs] of groups) {
    const [regionId, category] = key.split('|');
    const region = regionsById[regionId];
    if (!region) continue;
    const n = rs.length;
    const times = rs.map(r => new Date(r.createdAt).getTime());
    const recent = times.filter(t => nowMs - t <= winMs).length;
    const prior = times.filter(t => nowMs - t > winMs && nowMs - t <= 2 * winMs).length;
    const growthRate = (recent - prior) / Math.max(prior, 3);

    const weeks = p.persistenceWeeks;
    const series = new Array(weeks).fill(0);
    for (const t of times) {
      const wk = Math.floor((nowMs - t) / (7 * DAY));
      if (wk >= 0 && wk < weeks) series[weeks - 1 - wk]++;
    }
    const persistence = series.filter(x => x > 0).length / weeks;

    // Spatial concentration = coherence of the hotspot (share in the largest cluster), damped for tiny samples
    const cCount = {};
    for (const r of rs) if (r.clusterId) cCount[r.clusterId] = (cCount[r.clusterId] || 0) + 1;
    const topShare = Math.max(0, ...Object.values(cCount)) / n;
    const concentration = topShare * Math.min(1, n / 5);

    // Affected population: sum of cluster footprints in this region/need, capped at population
    const cl = [...new Set(rs.map(r => r.clusterId).filter(Boolean))].map(id => clusterById[id]).filter(Boolean);
    const affectedPopulation = Math.min(region.population, cl.reduce((s, c) => s + (c.affectedPopulation || 0), 0));

    const avgUrgency = rs.reduce((s, r) => s + (r.urgency || 0), 0) / n;
    const upvotes = rs.reduce((s, r) => s + (r.upvotes || 0), 0);
    const safetyImpact = rs.reduce((s, r) => s + (getSubcategory(category, r.subcategory)?.safetyWeight ?? getCategory(category)?.safetyWeight ?? 0.3), 0) / n;
    const uniqueLocations = new Set(rs.map(gridKey)).size;
    const avgConfidence = rs.reduce((s, r) => s + (r.confidence || 0), 0) / n;
    const lowLocationShare = rs.filter(r => r.locationSource !== 'gps').length / n; // location inferred from text instead of GPS

    const perCapita = n / Math.max(region.population / 10000, 0.1);
    const comp = {
      volume: 0.5 * clamp(perCapita / p.perCapitaCap) + 0.5 * clamp(Math.log(1 + n) / Math.log(1 + p.absoluteVolumeCap)),
      growth: clamp(growthRate),
      persistence,
      concentration,
      population: clamp(Math.log10(1 + affectedPopulation) / Math.log10(1 + p.populationCap)),
      urgency: avgUrgency,
      support: clamp(Math.log(1 + upvotes) / Math.log(1 + p.supportCap))
    };
    const demandScore = 100 * Object.keys(w).reduce((s, k) => s + w[k] * (comp[k] || 0), 0);

    const subCount = {};
    for (const r of rs) subCount[r.subcategory] = (subCount[r.subcategory] || 0) + 1;
    const topSubcategories = Object.entries(subCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, count]) => ({ id, label: getSubcategory(category, id)?.label || id, count }));

    demands.push({
      id: key, regionId, category, requestCount: n, duplicatesMerged: dupCount[key] || 0, uniqueLocations,
      recentCount: recent, priorCount: prior, growthRate: round(growthRate, 3), persistence: round(persistence, 3),
      concentration: round(concentration, 3), affectedPopulation: Math.round(affectedPopulation),
      avgUrgency: round(avgUrgency, 3), upvotes, safetyImpact: round(safetyImpact, 3),
      categoryShare: round(n / regionTotals[regionId], 3), // category concentration: share of the region's requests that this need represents
      demandScore: round(demandScore, 1),
      components: Object.fromEntries(Object.keys(comp).map(k => [k, { value: round(comp[k], 3), weight: round(w[k], 3), contribution: round(100 * w[k] * comp[k], 1) }])),
      topSubcategories, weightsVersion: weights.version,
      firstSeen: new Date(Math.min(...times)).toISOString(), lastSeen: new Date(Math.max(...times)).toISOString(),
      weeklySeries: series, computedAt: now.toISOString(),
      avgConfidence: round(avgConfidence, 3), lowLocationShare: round(lowLocationShare, 3)
    });
  }
  return demands.sort((a, b) => b.demandScore - a.demandScore);
}
