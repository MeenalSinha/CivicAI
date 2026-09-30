// ============================================================
// Development Prioritisation Engine - transparent weighted score.
// Every component, weight and contribution is returned for the explainability panel.
// ============================================================
import { clamp, round, normalizeWeights, getInstance } from './config.js';
import { getCategory, getSubcategory, categoryLabel } from './taxonomy.js';

export const priorityBand = s => s >= 70 ? 'P1 - Critical' : s >= 55 ? 'P2 - High' : s >= 40 ? 'P3 - Medium' : 'P4 - Watch';

export function computePriorities({ demands, gaps, alignments, regions, requests, clusters, weights, now = new Date() }) {
  const inst = getInstance();
  const w = normalizeWeights(weights.priority);
  const p = weights.params;
  const regionById = Object.fromEntries(regions.map(r => [r.id, r]));
  const gapByKey = Object.fromEntries(gaps.map(g => [g.id, g]));
  const alignByKey = Object.fromEntries(alignments.map(a => [a.id, a]));
  const demandByKey = Object.fromEntries(demands.map(d => [d.id, d]));

  // Equity: deprivation index per region (provided, else 1 - mean availability across assessed sectors)
  const deprivation = {};
  for (const r of regions) {
    if (r.deprivation != null) { deprivation[r.id] = r.deprivation; continue; }
    const av = gaps.filter(g => g.regionId === r.id && g.availability != null).map(g => g.availability);
    deprivation[r.id] = av.length ? 1 - av.reduce((s, x) => s + x, 0) / av.length : 0.5;
  }

  const keys = new Set([...demands.map(d => d.id), ...alignments.filter(a => a.classification === 'potentially_underserved').map(a => a.id)]);
  const items = [];
  for (const key of keys) {
    const [regionId, category] = key.split('|');
    const region = regionById[regionId]; if (!region) continue;
    const d = demandByKey[key], g = gapByKey[key], a = alignByKey[key];
    const demandScore = d?.demandScore ?? 0;
    const affected = g?.populationAffected ?? d?.affectedPopulation ?? 0;
    const comp = {
      demand: demandScore / 100,
      gap: (g?.severity ?? demandScore * 0.6) / 100,
      population: clamp(Math.log10(1 + affected) / Math.log10(1 + p.populationCap)),
      urgency: d?.avgUrgency ?? 0,
      safety: d?.safetyImpact ?? (getCategory(category)?.safetyWeight ?? 0.3),
      persistence: d?.persistence ?? 0,
      growth: clamp(d?.growthRate ?? 0),
      investmentGap: 1 - (a?.coverage ?? 0),
      equity: clamp(deprivation[regionId] ?? 0.5)
    };
    const score = 100 * Object.keys(w).reduce((s, k) => s + w[k] * comp[k], 0);
    const breakdown = Object.fromEntries(Object.keys(w).map(k => [k, { value: round(comp[k], 3), weight: round(w[k], 3), contribution: round(100 * w[k] * comp[k], 1) }]));
    const confidence = g?.confidence ?? 0.3;

    const topSub = d?.topSubcategories?.[0];
    const sub = topSub ? getSubcategory(category, topSub.id) : null;
    const cat = getCategory(category);
    let intervention = sub?.intervention || cat?.interventions?.[0]?.label || 'Departmental review';
    const ongoing = a?.matched?.find(m => m.stage === 'ongoing');
    if (a?.classification === 'high_demand_ongoing_project' && a.matched?.length) {
      intervention = `Review the scope and timeline of mapped project "${a.matched[0].name}" against demand; consider supplementing with: ${intervention}`;
    } else if (a?.classification === 'investment_aligned' && ongoing) {
      intervention = `Continue delivery of "${ongoing.name}" and monitor demand for change`;
    }

    // Evidence
    const evidence = [];
    if (d) {
      evidence.push({ type: 'demand', text: `${d.requestCount} independent citizen requests from ${d.uniqueLocations} locations (${d.recentCount} in the last ${p.windowDays} days).` });
      if (d.growthRate > 0.1 && d.recentCount >= 2) evidence.push({ type: 'trend', text: `Demand ${d.priorCount === 0 ? 'appeared in the last' : `rose ${Math.round(d.growthRate * 100)}% over the last`} ${p.windowDays} days${d.priorCount === 0 ? '' : ` (${d.priorCount} -> ${d.recentCount} requests)`}.` });
      if (d.persistence >= 0.5) evidence.push({ type: 'persistence', text: `Requests were logged in ${Math.round(d.persistence * p.persistenceWeeks)} of the last ${p.persistenceWeeks} weeks.` });
    }
    if (g?.dataStatus === 'assessed') evidence.push({ type: 'gap', text: g.reasoning.find(r => r.startsWith('Availability')) || '' });
    if (g?.populationAffected) evidence.push({ type: 'population', text: `Estimated ${g.populationAffected.toLocaleString('en-US')} residents affected.` });
    if (a) evidence.push({ type: 'investment', text: a.note.split(' Coverage reflects')[0] });
    // representative, PII-redacted excerpts only when k-anonymity threshold is met
    const k = inst.governance?.kAnonymityThreshold ?? p.kAnonymity;
    const sample = (requests || []).filter(r => r.regionId === regionId && r.category === category && r.status === 'active');
    if (sample.length >= k) {
      const rep = sample.slice().sort((x, y) => (y.urgency || 0) - (x.urgency || 0))[0];
      if (rep) evidence.push({ type: 'excerpt', text: `Representative anonymised excerpt (${rep.language}): "${(rep.descriptionRedacted || rep.description).slice(0, 140)}"` });
    }

    const growthTxt = d && d.priorCount > 0 ? `citizen demand ${d.growthRate >= 0.1 ? `rose ${Math.round(d.growthRate * 100)}%` : d.growthRate <= -0.1 ? `fell ${Math.round(-d.growthRate * 100)}%` : 'was broadly stable'} over ${p.windowDays} days`
      : d ? `${d.requestCount} citizen requests were recorded` : 'citizen reporting is currently low';
    const gapTxt = g?.dataStatus === 'assessed' ? `service availability is ${Math.round(g.availability * 100)}% of benchmark` : 'no infrastructure indicators were available to measure the gap';
    const rationale = `Priority increased because ${growthTxt}, ${gapTxt}, and an estimated ${Math.round(affected).toLocaleString('en-US')} residents in ${region.name} are affected. ${a ? a.note.split(' Coverage reflects')[0] : ''}`.trim();

    items.push({
      id: key, regionId, category, priorityScore: round(score, 1), band: priorityBand(score),
      affectedPopulation: Math.round(affected), topEvidence: evidence.filter(e => e.text).slice(0, 6),
      proposedIntervention: intervention,
      responsibleDepartment: inst.departments?.[category] || inst.departments?.other || 'Unassigned',
      rationale, components: breakdown, confidence: round(confidence, 2),
      investmentClass: a?.classification || 'monitor', computedAt: now.toISOString()
    });
  }
  items.sort((x, y) => y.priorityScore - x.priorityScore);
  items.forEach((it, i) => { it.rank = i + 1; });
  return items;
}
