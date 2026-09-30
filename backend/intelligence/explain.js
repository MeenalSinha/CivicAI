// ============================================================
// Explainability: builds a human-readable evidence trail for every recommendation.
// Pure function of already-computed data - the trail is what was actually computed.
// ============================================================
import { categoryLabel } from './taxonomy.js';

export function buildEvidenceTrail({ project, demand, gap, alignment, region, clusters, weights, instance }) {
  const trail = [];
  const p = weights.params;
  trail.push({ step: 1, title: 'Citizen signals', detail: demand
    ? `${demand.requestCount} independent citizen requests about ${categoryLabel(project.category)} in ${region.name} (${demand.duplicatesMerged || 0} repeat/duplicate submissions excluded); this need is ${Math.round((demand.categoryShare || 0) * 100)}% of all requests from the region. Channels and languages are normalised to one schema before analysis.`
    : `No citizen requests recorded for ${categoryLabel(project.category)} in ${region.name}; this item was surfaced from infrastructure indicators.`, values: demand ? { requests: demand.requestCount, uniqueLocations: demand.uniqueLocations, duplicatesExcluded: demand.duplicatesMerged } : {} });
  if (demand) {
    trail.push({ step: 2, title: 'Development need classification', detail: `Top needs: ${demand.topSubcategories.map(s => `${s.label} (${s.count})`).join(', ')}. Classified with the deterministic multilingual taxonomy (LLM only consulted for low-confidence text).`, values: {} });
    const cl = clusters.filter(c => c.regionId === region.id && c.category === project.category).sort((a, b) => b.requestCount - a.requestCount);
    trail.push({ step: 3, title: 'Aggregation into demand clusters', detail: `${cl.length} spatial cluster(s); the largest holds ${cl[0]?.requestCount || 0} requests within ~${cl[0]?.radiusKm ?? 0} km. Similar requests in the same area are grouped, not counted as separate complaints.`, values: { clusters: cl.length, largest: cl[0]?.requestCount || 0 } });
    trail.push({ step: 4, title: `Demand score ${demand.demandScore}/100`, detail: 'Weighted sum of normalised components (weights are configurable).', table: Object.entries(demand.components).map(([k, c]) => ({ factor: k, value: c.value, weight: c.weight, contribution: c.contribution })) });
  }
  if (gap) trail.push({ step: 5, title: 'Infrastructure gap analysis', detail: gap.reasoning.join(' '), values: { availability: gap.availability, gap: gap.gap, populationInGap: gap.populationInGap, severity: gap.severity, band: gap.severityBand } });
  if (alignment) trail.push({ step: 6, title: 'Investment alignment', detail: alignment.note, values: { coverage: alignment.coverage, classification: alignment.classification }, projects: alignment.matched });
  trail.push({ step: 7, title: `Priority score ${project.priorityScore}/100 (${project.band})`, detail: 'Transparent weighted score; each row shows value x weight = contribution to the score.', table: Object.entries(project.components).map(([k, c]) => ({ factor: k, value: c.value, weight: c.weight, contribution: c.contribution })) });
  const caveats = [];
  if (gap?.dataStatus !== 'assessed') caveats.push('No infrastructure indicators for this need; gap is not measured.');
  if ((project.confidence ?? 0) < 0.5) caveats.push(`Confidence is ${Math.round(project.confidence * 100)}% - below the review floor; treat as indicative.`);
  if (demand && demand.lowLocationShare > 0.5) caveats.push(`${Math.round(demand.lowLocationShare * 100)}% of requests had locations inferred from text rather than GPS, which limits spatial precision.`);
  if (demand && demand.requestCount < 5) caveats.push('Small number of requests; scores may be volatile.');
  if (alignment) caveats.push('Investment coverage reflects only projects present in the loaded datasets.');
  if (instance?.dataLabel && /SYNTHETIC/i.test(instance.dataLabel)) caveats.push(instance.dataLabel + '.');
  trail.push({ step: 8, title: 'Uncertainty and caveats', detail: caveats.join(' ') || 'No specific caveats.', values: { confidence: project.confidence } });
  trail.push({ step: 9, title: 'Governance', detail: 'This is a decision-support recommendation. It is not binding and requires human review before any action. Review status and reviewer are audit-logged.', values: {} });
  return trail;
}

/** Compact natural-language explanation used by the policy Q&A ("why was X prioritised?"). */
export function explainProject(project, demand, gap, alignment, region) {
  const lines = [];
  lines.push(`${region.name} - ${categoryLabel(project.category)} is ranked #${project.rank} with a priority score of ${project.priorityScore}/100 (${project.band}).`);
  lines.push(project.rationale);
  const top = Object.entries(project.components).sort((a, b) => b[1].contribution - a[1].contribution).slice(0, 3);
  lines.push(`Largest contributors to the score: ${top.map(([k, c]) => `${k} (${c.contribution} pts)`).join(', ')}.`);
  lines.push(`Proposed intervention (for human review): ${project.proposedIntervention}.`);
  lines.push(`Confidence ${Math.round(project.confidence * 100)}%.`);
  return lines.join(' ');
}
