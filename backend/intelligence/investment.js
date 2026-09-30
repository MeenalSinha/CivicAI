// ============================================================
// Investment Alignment Engine. Uses NEUTRAL language and never asserts
// ineffectiveness: it can only say what the mapped data shows.
// ============================================================
import { clamp, round } from './config.js';
import { categoryLabel } from './taxonomy.js';

export const STAGE_FACTOR = { completed: 0.9, ongoing: 0.7, tender: 0.4, approved: 0.3, planned: 0.3, stalled: 0.15, cancelled: 0 };
const ACTIVE = new Set(['ongoing', 'tender', 'approved', 'planned']);

export const CLASSES = {
  high_demand_limited_investment: 'High citizen demand with limited mapped investment coverage',
  high_demand_ongoing_project: 'High citizen demand with mapped project(s) in progress',
  investment_aligned: 'Mapped investment appears aligned with citizen demand',
  potentially_underserved: 'Potentially underserved (service gap indicators, low reported demand)',
  monitor: 'No strong alignment signal'
};

export function investmentsFor(regionId, sector, investments) {
  return investments.filter(i => i.sector === sector && (i.coverage?.[regionId] != null || i.regionIds?.includes(regionId)))
    .map(i => ({ ...i, share: i.coverage?.[regionId] ?? 1 / Math.max(i.regionIds.length, 1) }));
}

export function computeAlignments({ demands, gaps, investments, weights, now = new Date() }) {
  const p = weights.params;
  const demandByKey = Object.fromEntries(demands.map(d => [d.id, d]));
  const keys = new Set([...demands.map(d => d.id), ...gaps.map(g => g.id)]);
  const gapByKey = Object.fromEntries(gaps.map(g => [g.id, g]));
  const out = [];
  for (const key of keys) {
    const [regionId, category] = key.split('|');
    const d = demandByKey[key], g = gapByKey[key];
    const demandScore = d?.demandScore ?? 0;
    const inv = investmentsFor(regionId, category, investments).filter(i => i.stage !== 'cancelled');
    const coverage = clamp(inv.reduce((s, i) => s + i.share * (STAGE_FACTOR[i.stage] ?? 0.3), 0));
    const active = inv.filter(i => ACTIVE.has(i.stage) && i.share >= 0.3);
    const overlap = active.length >= 2;
    const matched = inv.map(i => ({
      id: i.id, name: i.name, stage: i.stage, budget: i.budget, currency: i.currency, share: round(i.share, 2),
      plannedCompletion: i.plannedCompletion, targetPopulation: i.targetPopulation, department: i.department, isSynthetic: i.isSynthetic
    }));

    let classification = 'monitor', note = 'No strong alignment signal in the mapped data.';
    const highDemand = demandScore >= p.highDemand;
    const highGap = (g?.gap ?? 0) >= 0.5;
    if (highDemand) {
      if (coverage < p.limitedInvestment) {
        classification = 'high_demand_limited_investment';
        note = `High citizen demand with limited mapped investment coverage (${Math.round(coverage * 100)}% of the region covered by mapped ${categoryLabel(category).toLowerCase()} projects).`;
      } else if (coverage >= 0.5 && !inv.some(i => ACTIVE.has(i.stage))) {
        classification = 'investment_aligned';
        note = 'Mapped investment appears aligned with citizen demand (completed works cover most of the region).';
      } else if (coverage >= 0.5 && inv.some(i => i.stage === 'ongoing')) {
        classification = 'investment_aligned';
        note = `Mapped investment appears aligned with citizen demand; ${inv.filter(i => i.stage === 'ongoing').length} project(s) in progress.`;
      } else {
        classification = 'high_demand_ongoing_project';
        note = `High citizen demand; ${inv.length} mapped project(s) cover about ${Math.round(coverage * 100)}% of the region. Track delivery against demand.`;
      }
    } else if (highGap && coverage < p.limitedInvestment) {
      classification = 'potentially_underserved';
      note = 'Infrastructure indicators suggest a service gap with limited mapped investment. Citizen demand is currently low, which may reflect under-reporting rather than absence of need.';
    } else if (coverage >= 0.5 && demandScore >= 25) {
      classification = 'investment_aligned';
      note = 'Mapped investment appears aligned with the level of citizen demand.';
    }
    if (overlap) note += ` ${active.length} active mapped interventions overlap this need; verify scope to avoid duplication.`;
    // Adequacy: neutral comparison, never a judgement of effectiveness
    const targetPop = inv.reduce((s, i) => s + (i.targetPopulation || 0) * Math.min(1, i.share), 0);
    if (targetPop && g?.populationInGap) {
      note += ` Mapped target population (~${Math.round(targetPop).toLocaleString('en-US')}) compares with ~${g.populationInGap.toLocaleString('en-US')} residents in the estimated gap.`;
    }
    note += ' Coverage reflects only projects present in the loaded datasets.';
    out.push({ id: key, regionId, category, classification, overlap, coverage: round(coverage, 3), matched, note, computedAt: now.toISOString() });
  }
  return out;
}
