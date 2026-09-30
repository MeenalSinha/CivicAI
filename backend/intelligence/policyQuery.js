// ============================================================
// Policy query interface. Questions are parsed into a structured intent,
// answered ONLY from computed tables, and returned with evidence.
// An LLM may optionally rephrase the result, but every number it writes is
// verified against the source facts; otherwise the deterministic answer is used.
// ============================================================
import * as dev from '../database/devdb.js';
import { getWeights } from './pipeline.js';
import { getInstance, round } from './config.js';
import { loadTaxonomy, classifyText, categoryLabel } from './taxonomy.js';
import { gazetteerMatch } from './normalize.js';
import { CLASSES } from './investment.js';
import { explainProject } from './explain.js';
import { narrateFacts } from '../ai/aiService.js';

const SYNONYMS = {
  roads_transport: ['road', 'roads', 'street', 'streets', 'pothole', 'potholes', 'highway', 'pavement'],
  water_supply: ['water', 'water supply', 'drinking water', 'tap'],
  drainage_flood: ['drainage', 'drain', 'drains', 'flood', 'flooding', 'waterlogging'],
  sanitation: ['sanitation', 'sewer', 'sewage', 'toilet'],
  waste_management: ['waste', 'garbage', 'trash', 'solid waste'],
  electricity: ['electricity', 'power', 'streetlight', 'streetlights'],
  public_healthcare: ['healthcare', 'health care', 'health', 'hospital', 'hospitals', 'clinic', 'clinics'],
  education: ['education', 'school', 'schools'],
  public_safety: ['safety', 'crime', 'cctv'],
  public_mobility: ['bus', 'buses', 'transit', 'mobility', 'public transport'],
  digital_connectivity: ['digital', 'internet', 'broadband', 'network', 'connectivity', 'mobile coverage'],
  housing_urban_services: ['housing', 'slum'],
  public_spaces: ['park', 'parks', 'playground'],
  environmental_infrastructure: ['pollution', 'environment', 'environmental'],
  accessibility: ['accessibility', 'accessible', 'wheelchair']
};

export const EXAMPLE_QUESTIONS = [
  'Which districts have the highest unmet road-development demand?',
  'Where is healthcare demand growing faster than infrastructure availability?',
  'Which regions have high citizen demand but limited mapped investment coverage?',
  'Which development needs are emerging fastest this quarter?',
  'Why was Eastern Periphery prioritized for healthcare?',
  'Which areas may be potentially underserved?',
  'Where do mapped interventions overlap?'
];

export function detectCategory(q) {
  const t = ` ${q.toLowerCase()} `;
  let best = null;
  for (const [cat, words] of Object.entries(SYNONYMS)) {
    for (const w of words) {
      const i = t.indexOf(` ${w}`);
      if (i >= 0 && (!best || w.length > best.len)) best = { cat, len: w.length };
    }
  }
  if (best) return best.cat;
  for (const c of loadTaxonomy().categories) if (c.id !== 'other' && t.includes(c.label.toLowerCase())) return c.id;
  const cls = classifyText(q); // Hindi / Hinglish questions
  return cls.category !== 'other' && cls.confidence >= 0.6 ? cls.category : null;
}

const DOMAIN_TERMS = /\b(request|requests|demand|demands|citizen|citizens|infrastructure|investment|investments|invested|funded|gap|gaps|priority|priorities|prioritized|prioritised|region|regions|ward|wards|district|districts|area|areas|locality|need|needs|project|projects|service|services|coverage|availability|development|population|residents|complaint|complaints|growing|emerging|underserved|overlap)\b/i;

export function detectIntent(q, hasEntity = false) {
  const t = q.toLowerCase();
  // Guard: only answer questions about the loaded development data
  if (!hasEntity && !DOMAIN_TERMS.test(t)) return 'unknown';
  if (/\b(why|explain|reason|justify|how was|kyon|kyun)\b|क्यों/.test(t)) return 'explain';
  if (/\b(overlap|overlaps|overlapping|duplicat\w*)\b/.test(t)) return 'overlap';
  if (/\b(underserved|under-served|neglected|latent|under-report\w*)\b/.test(t)) return 'underserved';
  if (/limited.*investment|\bno .*investment|without .*investment|\bunfunded\b|under-?funded|investment (gap|coverage)|not (been )?funded|lack.*investment/.test(t)) return 'limited_investment';
  if (/(grow|rising|increas|faster).*(infrastructure|availability|capacity|gap|service)|(infrastructure|availability|capacity).*(grow|slower|lag)/.test(t)) return 'growth_vs_infra';
  if (/\b(emerg\w*|fastest|newly|rapid\w*|quarter|trend\w*|spik\w*)\b/.test(t)) return 'emerging';
  if (/\b(unmet|highest|most|top|largest|worst|biggest|priorit\w*)\b/.test(t)) return 'top_unmet';
  if (/\b(how many|total|number of|count|overview|summary|status of)\b/.test(t)) return 'summary';
  return 'unknown';
}

const fmtPct = x => `${Math.round(x * 100)}%`;
const fmtN = n => Math.round(n).toLocaleString('en-US');

function windowGrowth(requests, days, now = Date.now()) {
  const half = days / 2 * 86_400_000, out = {};
  for (const r of requests) {
    if (r.status !== 'active' || !r.regionId) continue;
    const age = now - new Date(r.createdAt).getTime();
    if (age > 2 * half || age < 0) continue;
    const k = `${r.regionId}|${r.category}`;
    out[k] ||= { recent: 0, prior: 0 };
    if (age <= half) out[k].recent++; else out[k].prior++;
  }
  return out;
}

export async function answerPolicyQuestion(question, { context = {}, narrate = true } = {}) {
  const inst = getInstance();
  const weights = getWeights();
  const regions = dev.getRegions();
  const byId = Object.fromEntries(regions.map(r => [r.id, r]));
  const q = String(question || '').trim().slice(0, 400);
  if (!q) return { intent: 'invalid', answer: 'Please enter a question.', table: null, evidence: [], method: 'none' };

  const demands = dev.getDemands(), gaps = dev.getGaps(), aligns = dev.getAlignments(), projects = dev.getProjects();
  if (!demands.length) return { intent: 'no_data', question: q, answer: 'No analysed data is available yet. Submit citizen requests or load a dataset, then run the analysis pipeline.', table: null, evidence: [], method: 'none', examples: EXAMPLE_QUESTIONS };

  const gz = gazetteerMatch(q, regions);
  const detectedCat = detectCategory(q);
  const intent = detectIntent(q, !!gz || !!detectedCat);
  let category = detectedCat || (intent === 'explain' ? context.category : null) || null;
  let regionId = gz?.region.id || (intent === 'explain' ? context.regionId : null) || null;
  const filters = { category, region: regionId ? byId[regionId].name : null };
  const alignByKey = Object.fromEntries(aligns.map(a => [a.id, a]));
  const gapByKey = Object.fromEntries(gaps.map(g => [g.id, g]));
  const evidence = [];
  let answer = '', table = null, facts = null;
  const scope = category ? ` for ${categoryLabel(category).toLowerCase()}` : '';

  switch (intent) {
    case 'top_unmet': {
      const rows = demands.filter(d => !category || d.category === category).map(d => {
        const g = gapByKey[d.id];
        return { d, g, unmet: (g?.gap ?? 0.5) * d.demandScore, pop: g?.populationAffected ?? d.affectedPopulation };
      }).sort((a, b) => b.unmet - a.unmet).slice(0, 5);
      if (!rows.length) { answer = `No demand records exist${scope}.`; break; }
      table = { columns: ['Region', 'Need', 'Demand score', 'Availability vs benchmark', 'Est. residents affected', 'Requests'], rows: rows.map(({ d, g, pop }) => [byId[d.regionId].name, categoryLabel(d.category), d.demandScore, g?.availability != null ? fmtPct(g.availability) : 'not measured', fmtN(pop), d.requestCount]) };
      const top = rows[0];
      answer = `Highest unmet demand${scope}: ${byId[top.d.regionId].name} (${categoryLabel(top.d.category)}) - demand score ${top.d.demandScore}, ${top.g?.availability != null ? `service availability ${fmtPct(top.g.availability)} of benchmark` : 'infrastructure availability not measured'}, about ${fmtN(top.pop)} residents affected. Ranking = demand score x infrastructure gap (gap assumed 50% where no indicator exists).`;
      facts = { ranking: table.rows };
      rows.forEach(({ d }) => evidence.push({ ref: d.id, text: `${d.requestCount} requests, ${d.uniqueLocations} locations` }));
      break;
    }
    case 'growth_vs_infra': {
      const rows = demands.filter(d => (!category || d.category === category) && d.growthRate > 0.15 && d.recentCount >= 2).map(d => ({ d, g: gapByKey[d.id] }))
        .filter(x => x.g?.availability != null && x.g.availability < 0.7).sort((a, b) => b.d.growthRate - a.d.growthRate).slice(0, 6);
      if (!rows.length) { answer = `No region shows rising demand${scope} together with below-benchmark infrastructure availability in the loaded data.`; break; }
      table = { columns: ['Region', 'Need', `Demand change (${weights.params.windowDays}d)`, 'Availability vs benchmark', 'Requests (recent / prior)'], rows: rows.map(({ d, g }) => [byId[d.regionId].name, categoryLabel(d.category), `${d.growthRate >= 0 ? '+' : ''}${Math.round(d.growthRate * 100)}%`, fmtPct(g.availability), `${d.recentCount} / ${d.priorCount}`]) };
      const t = rows[0];
      answer = `${rows.length} region-need pair(s) show growing demand${scope} with service availability below 70% of benchmark. Fastest: ${byId[t.d.regionId].name} - ${categoryLabel(t.d.category)} demand ${t.d.growthRate >= 0 ? 'rose' : 'fell'} ${Math.abs(Math.round(t.d.growthRate * 100))}% over ${weights.params.windowDays} days (${t.d.priorCount} to ${t.d.recentCount} requests) while availability is ${fmtPct(t.g.availability)} of benchmark. Availability is a snapshot, not a trend; the comparison is demand growth vs current coverage.`;
      facts = { rows: table.rows }; rows.forEach(({ d }) => evidence.push({ ref: d.id, text: d.reasoning || `growth ${Math.round(d.growthRate * 100)}%` }));
      break;
    }
    case 'limited_investment': {
      const rows = aligns.filter(a => a.classification === 'high_demand_limited_investment' && (!category || a.category === category))
        .map(a => ({ a, d: demands.find(d => d.id === a.id), g: gapByKey[a.id] })).sort((x, y) => (y.d?.demandScore ?? 0) - (x.d?.demandScore ?? 0)).slice(0, 8);
      if (!rows.length) { answer = `No region combines high demand with limited mapped investment coverage${scope} in the loaded data.`; break; }
      table = { columns: ['Region', 'Need', 'Demand score', 'Mapped investment coverage', 'Est. residents affected'], rows: rows.map(({ a, d, g }) => [byId[a.regionId].name, categoryLabel(a.category), d?.demandScore, fmtPct(a.coverage), fmtN(g?.populationAffected ?? d?.affectedPopulation ?? 0)]) };
      answer = `${rows.length} region-need pair(s) show high citizen demand with limited mapped investment coverage${scope}. Highest demand: ${byId[rows[0].a.regionId].name} - ${categoryLabel(rows[0].a.category)} (demand score ${rows[0].d?.demandScore}, mapped coverage ${fmtPct(rows[0].a.coverage)}). This reflects only projects present in the loaded datasets and does not imply that any existing investment is ineffective.`;
      facts = { rows: table.rows }; rows.forEach(({ a }) => evidence.push({ ref: a.id, text: a.note.split(' Coverage reflects')[0] }));
      break;
    }
    case 'emerging': {
      const requests = dev.getRequests();
      const win = windowGrowth(requests, 90);
      const rows = Object.entries(win).filter(([k]) => !category || k.endsWith(`|${category}`)).map(([k, v]) => ({ k, ...v, rate: (v.recent - v.prior) / Math.max(v.prior, 3) }))
        .filter(x => x.recent >= 3 && x.rate > 0).sort((a, b) => b.rate - a.rate || b.recent - a.recent).slice(0, 6);
      if (!rows.length) { answer = `No development need shows clear growth over the last quarter${scope}.`; break; }
      table = { columns: ['Region', 'Need', 'Requests (prior 45d)', 'Requests (last 45d)', 'Change'], rows: rows.map(x => { const [rid, cat] = x.k.split('|'); return [byId[rid].name, categoryLabel(cat), x.prior, x.recent, `${x.prior === 0 ? 'new' : '+' + Math.round((x.recent - x.prior) / x.prior * 100) + '%'}`]; }) };
      const [rid, cat] = rows[0].k.split('|');
      answer = `Fastest-emerging needs this quarter${scope}: ${byId[rid].name} - ${categoryLabel(cat)} (${rows[0].prior} requests in the earlier 45 days vs ${rows[0].recent} in the latest 45 days). The quarter is split into two 45-day halves; counts are unique requests after duplicate removal.`;
      facts = { rows: table.rows }; rows.forEach(x => evidence.push({ ref: x.k, text: `${x.prior} -> ${x.recent}` }));
      break;
    }
    case 'underserved': {
      const rows = aligns.filter(a => a.classification === 'potentially_underserved' && (!category || a.category === category)).map(a => ({ a, g: gapByKey[a.id] })).sort((x, y) => (y.g?.severity ?? 0) - (x.g?.severity ?? 0)).slice(0, 8);
      if (!rows.length) { answer = `No potentially underserved areas${scope} were identified (all high-gap needs already show citizen demand or mapped investment).`; break; }
      table = { columns: ['Region', 'Need', 'Availability vs benchmark', 'Citizen requests', 'Mapped investment coverage'], rows: rows.map(({ a, g }) => [byId[a.regionId].name, categoryLabel(a.category), g?.availability != null ? fmtPct(g.availability) : 'n/a', demands.find(d => d.id === a.id)?.requestCount ?? 0, fmtPct(a.coverage)]) };
      answer = `${rows.length} area(s) show large infrastructure gaps${scope} but little citizen reporting and limited mapped investment. Low reporting may indicate under-reporting rather than lack of need; field verification is recommended.`;
      facts = { rows: table.rows };
      break;
    }
    case 'overlap': {
      const rows = aligns.filter(a => a.overlap && (!category || a.category === category)).slice(0, 8);
      if (!rows.length) { answer = `No overlapping active interventions${scope} were found in the mapped investment data.`; break; }
      table = { columns: ['Region', 'Need', 'Overlapping projects'], rows: rows.map(a => [byId[a.regionId].name, categoryLabel(a.category), a.matched.filter(m => ['ongoing', 'tender', 'approved', 'planned'].includes(m.stage)).map(m => `${m.name} (${m.stage})`).join('; ')]) };
      answer = `${rows.length} region-need pair(s) have two or more active mapped projects for the same need (e.g. ${byId[rows[0].regionId].name} - ${categoryLabel(rows[0].category)}). Overlap may be intentional phasing; verify scope and geography before concluding duplication.`;
      facts = { rows: table.rows };
      break;
    }
    case 'explain': {
      let p = null;
      if (regionId && category) p = projects.find(x => x.regionId === regionId && x.category === category);
      else if (regionId) p = projects.find(x => x.regionId === regionId);
      else if (category) p = projects.find(x => x.category === category);
      if (!p) { answer = 'I could not find a prioritised item matching that region and need. Try naming both, e.g. "Why was Eastern Periphery prioritised for healthcare?"'; break; }
      const d = demands.find(x => x.id === p.id), g = gapByKey[p.id], a = alignByKey[p.id];
      answer = explainProject(p, d, g, a, byId[p.regionId]);
      const rec = dev.getRecommendationByProject(p.id);
      table = { columns: ['Factor', 'Value', 'Weight', 'Contribution (pts)'], rows: Object.entries(p.components).map(([k, c]) => [k, c.value, c.weight, c.contribution]) };
      filters.category = p.category; filters.region = byId[p.regionId].name;
      evidence.push(...p.topEvidence.map(e => ({ ref: e.type, text: e.text })));
      facts = { answer, table: table.rows, reviewStatus: rec?.status };
      return finish({ intent, question: q, answer, table, evidence, filters, method: 'deterministic-query', projectId: p.id, reviewStatus: rec?.status, confidence: p.confidence }, facts, narrate, q);
    }
    case 'summary': {
      const active = dev.getRequests({ status: 'active' }).filter(r => !category || r.category === category);
      const d = demands.filter(x => !category || x.category === category);
      answer = `${active.length} unique citizen requests${scope} across ${new Set(active.map(r => r.regionId).filter(Boolean)).size} regions, forming ${dev.getClusters().filter(c => !category || c.category === category).length} spatial clusters; ${d.filter(x => x.demandScore >= weights.params.highDemand).length} region-need pairs exceed the high-demand threshold (${weights.params.highDemand}).`;
      facts = { answer };
      break;
    }
    default:
      return { intent: 'unknown', question: q, answer: 'I can only answer questions that the loaded development data can support (demand, infrastructure gaps, investment coverage, trends and priorities). I do not have information to answer that. Try one of the examples below.', table: null, evidence: [], filters, method: 'none', examples: EXAMPLE_QUESTIONS, supported: true };
  }
  return finish({ intent, question: q, answer, table, evidence: evidence.slice(0, 8), filters, method: 'deterministic-query' }, facts, narrate, q);
}

// ---- optional LLM rephrase, guarded against unsupported numbers ----
const numsIn = s => new Set((String(s).match(/\d[\d,]*\.?\d*/g) || []).map(x => x.replace(/,/g, '').replace(/\.$/, '')));
export function narrationIsSupported(text, facts, answer) {
  const allowed = new Set([...numsIn(JSON.stringify(facts)), ...numsIn(answer)]);
  for (const n of numsIn(text)) if (!allowed.has(n)) return false;
  return true;
}
async function finish(result, facts, narrate, question) {
  result.narration = null;
  if (narrate && facts && process.env.POLICY_NARRATION !== 'off') {
    try {
      const n = await narrateFacts(question, { answer: result.answer, table: result.table, filters: result.filters });
      if (n && narrationIsSupported(n.text, { answer: result.answer, table: result.table }, result.answer)) result.narration = { text: n.text, model: n.model, verified: true };
      else if (n) result.narration = { rejected: true, reason: 'Model output contained figures not present in the source data and was discarded.' };
    } catch { /* deterministic answer stands */ }
  }
  return result;
}
