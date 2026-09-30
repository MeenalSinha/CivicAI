// ============================================================
// Trend intelligence + outcome measurement (feedback loop)
// ============================================================
import { round } from './config.js';

export function classifyTrends(demands, weights) {
  const p = weights.params;
  const out = { emerging: [], rapidlyGrowing: [], persistent: [], declining: [], stable: [] };
  for (const d of demands) {
    const item = { id: d.id, regionId: d.regionId, category: d.category, requestCount: d.requestCount, recentCount: d.recentCount, priorCount: d.priorCount, growthRate: d.growthRate, persistence: d.persistence, demandScore: d.demandScore, weeklySeries: d.weeklySeries };
    const weeksActive = Math.round(d.persistence * p.persistenceWeeks);
    const firstAgeDays = (Date.now() - new Date(d.firstSeen).getTime()) / 86_400_000;
    if (d.recentCount >= 3 && d.priorCount <= 1 && firstAgeDays <= 2 * p.windowDays + 7) out.emerging.push({ ...item, label: 'Emerging' });
    else if (d.growthRate >= 0.5 && d.recentCount >= 4) out.rapidlyGrowing.push({ ...item, label: 'Rapidly growing' });
    else if (d.growthRate <= -0.3 && d.priorCount >= 3) out.declining.push({ ...item, label: 'Declining' });
    else if (weeksActive >= Math.ceil(p.persistenceWeeks * 0.65) && d.requestCount >= 8) out.persistent.push({ ...item, label: 'Persistent' });
    else out.stable.push({ ...item, label: 'Stable' });
  }
  const byGrowth = (a, b) => b.growthRate - a.growthRate;
  out.emerging.sort(byGrowth); out.rapidlyGrowing.sort(byGrowth);
  out.declining.sort((a, b) => a.growthRate - b.growthRate);
  out.persistent.sort((a, b) => b.persistence - a.persistence || b.requestCount - a.requestCount);
  return out;
}

/**
 * Outcome measurement: for completed projects, compare demand before vs after completion.
 * Plus citizen-facing service outcomes (resolution rate, satisfaction).
 * Only reports what the data shows; small samples are flagged.
 */
export function computeOutcomes({ investments, requests, complaints, feedback, now = new Date() }) {
  const projectOutcomes = [];
  for (const inv of investments.filter(i => i.stage === 'completed' && i.completedAt)) {
    const t0 = new Date(inv.completedAt).getTime();
    const win = 45 * 86_400_000;
    for (const regionId of Object.keys(inv.coverage || {})) {
      const rs = requests.filter(r => r.status === 'active' && r.regionId === regionId && r.category === inv.sector);
      const before = rs.filter(r => { const t = new Date(r.createdAt).getTime(); return t < t0 && t >= t0 - win; }).length;
      const after = rs.filter(r => { const t = new Date(r.createdAt).getTime(); return t >= t0 && t <= Math.min(t0 + win, now.getTime()); }).length;
      const daysSince = Math.floor((now.getTime() - t0) / 86_400_000);
      if (before + after === 0) continue;
      projectOutcomes.push({
        investmentId: inv.id, name: inv.name, regionId, sector: inv.sector, completedAt: inv.completedAt,
        requestsBefore: before, requestsAfter: after, windowDays: 45, daysSinceCompletion: daysSince,
        change: before ? round((after - before) / before, 2) : null,
        note: before < 5 ? 'Small sample; interpret with caution. Correlation, not proof of causation.' : 'Change in citizen requests for the same need 45 days before vs after completion. Correlation, not proof of causation.',
        isSynthetic: !!inv.isSynthetic
      });
    }
  }
  const resolved = complaints.filter(c => c.status === 'resolved');
  const resTimes = resolved.map(c => new Date(c.updatedAt) - new Date(c.timestamp)).filter(x => x > 0);
  const ratings = feedback.map(f => f.rating);
  return {
    projectOutcomes,
    service: {
      complaintsTotal: complaints.length, resolved: resolved.length,
      resolutionRate: complaints.length ? round(resolved.length / complaints.length, 3) : null,
      avgResolutionHours: resTimes.length ? round(resTimes.reduce((s, x) => s + x, 0) / resTimes.length / 3_600_000, 1) : null,
      feedbackCount: ratings.length, avgSatisfaction: ratings.length ? round(ratings.reduce((s, x) => s + x, 0) / ratings.length, 2) : null
    }
  };
}
