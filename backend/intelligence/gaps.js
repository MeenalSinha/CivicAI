// ============================================================
// Infrastructure-gap intelligence: citizen demand x infrastructure availability.
// availability = mean(min(1, value / benchmark)) over the region's asset indicators for that sector.
// ============================================================
import { clamp, round } from './config.js';
import { categoryLabel } from './taxonomy.js';

const fmt = n => (n == null ? 'n/a' : Math.round(n).toLocaleString('en-US'));
export const severityBand = s => s >= 70 ? 'critical' : s >= 50 ? 'high' : s >= 30 ? 'moderate' : 'low';

export function computeGaps({ regions, assets, demands, weights, now = new Date() }) {
  const demandByKey = Object.fromEntries(demands.map(d => [`${d.regionId}|${d.category}`, d]));
  const assetsByKey = {};
  for (const a of assets) (assetsByKey[`${a.regionId}|${a.sector}`] ||= []).push(a);

  const keys = new Set([...Object.keys(demandByKey), ...Object.keys(assetsByKey)]);
  const out = [];
  for (const key of keys) {
    const [regionId, sector] = key.split('|');
    const region = regions.find(r => r.id === regionId);
    if (!region) continue;
    const d = demandByKey[key] || null;
    const as = assetsByKey[key] || [];
    const demandScore = d?.demandScore ?? 0;
    const reasoning = [];

    if (d) {
      const growthTxt = d.priorCount === 0 && d.recentCount > 0 ? 'new in the recent window' :
        `${d.growthRate >= 0 ? '+' : ''}${Math.round(d.growthRate * 100)}% vs the prior ${weights.params.windowDays} days`;
      reasoning.push(`Demand: ${d.requestCount} independent requests from ${d.uniqueLocations} locations (${d.recentCount} in the last ${weights.params.windowDays} days, ${growthTxt}); demand score ${d.demandScore}.`);
    } else {
      reasoning.push('Demand: no citizen requests recorded for this need in this region.');
    }

    let availability = null, gap = null, populationInGap = null, populationAffected = d?.affectedPopulation ?? 0, dataStatus = 'demand_only';
    let dataCompleteness = 0;
    if (as.length) {
      const ratios = as.map(a => clamp(a.value / a.benchmark));
      availability = ratios.reduce((s, x) => s + x, 0) / ratios.length;
      gap = 1 - availability;
      populationInGap = Math.round(region.population * gap);
      populationAffected = populationInGap;
      dataStatus = 'assessed';
      const year = as.map(a => parseInt(String(a.asOf || '').slice(0, 4))).filter(Boolean);
      const age = year.length ? now.getFullYear() - Math.max(...year) : 3;
      dataCompleteness = age <= 1 ? 1 : age <= 3 ? 0.75 : 0.5;
      for (const a of as) {
        reasoning.push(`Availability: ${a.metric.replace(/_/g, ' ')} = ${a.value} vs benchmark ${a.benchmark}${a.unit ? ' ' + a.unit : ''} (${Math.round(clamp(a.value / a.benchmark) * 100)}% of benchmark${a.asOf ? ', as of ' + String(a.asOf).slice(0, 10) : ''}${a.isSynthetic ? ', SYNTHETIC' : ''}).`);
      }
      reasoning.push(`Gap: ${Math.round(gap * 100)}% below benchmark, so an estimated ${fmt(populationInGap)} of ${fmt(region.population)} residents live in an under-served catchment for ${categoryLabel(sector).toLowerCase()}.`);
    } else {
      reasoning.push(`Availability: no infrastructure indicators loaded for ${categoryLabel(sector)} in ${region.name}; gap cannot be measured. Severity is estimated from demand alone and confidence is reduced.`);
      if (d) reasoning.push(`Population: ${fmt(d.affectedPopulation)} residents estimated within reporting clusters (cluster footprint x local density).`);
    }

    const severity = gap != null ? clamp(gap * 0.65 + 0.35 * demandScore / 100) * 100 : clamp(0.6 * demandScore / 100) * 100;
    const nFactor = d ? clamp(d.requestCount / 12) : 0;
    const confidence = clamp(0.35 * dataCompleteness + 0.35 * nFactor + 0.2 * (d?.avgConfidence ?? 0.5) + 0.1 * (1 - 0.5 * (d?.lowLocationShare ?? 0.5)));
    reasoning.push(`Confidence ${Math.round(confidence * 100)}%: infrastructure data ${dataCompleteness ? 'available' : 'missing'}, ${d?.requestCount || 0} supporting requests, mean classification confidence ${Math.round((d?.avgConfidence ?? 0) * 100)}%.`);

    out.push({
      id: key, regionId, sector, demandScore: round(demandScore, 1),
      availability: availability == null ? null : round(availability, 3),
      gap: gap == null ? null : round(gap, 3), populationInGap, populationAffected: Math.round(populationAffected),
      severity: round(severity, 1), severityBand: severityBand(severity), confidence: round(confidence, 2),
      dataStatus, reasoning, computedAt: now.toISOString()
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
