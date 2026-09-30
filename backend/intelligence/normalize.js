// ============================================================
// Request normalisation: every channel (text/voice/image/messaging)
// yields the SAME structured representation.
// ============================================================
import { detectLanguage } from './language.js';
import { classifyText, getCategory, getSubcategory, fromLegacyIssueType, isValidCategory, categoryLabel } from './taxonomy.js';
import { findRegion, jitterAround } from './geo.js';
import { estimateUrgency, estimatePopulationRelevance, redactPII, textFingerprint, hashIdentity } from './textutils.js';
import { getInstance, clamp } from './config.js';

export const CHANNELS = ['chat', 'text', 'voice', 'image', 'messaging', 'api', 'manual', 'synthetic'];

const SHARED_NATURE = new Set(['roads_transport', 'drainage_flood', 'waste_management', 'public_mobility', 'electricity', 'water_supply', 'public_safety', 'sanitation', 'digital_connectivity']);

/** Find a region via gazetteer match on names/aliases in the text. */
export function gazetteerMatch(text, regions) {
  const t = ` ${String(text || '').toLowerCase()} `;
  let best = null;
  for (const r of regions) {
    const names = [r.name, ...(r.aliases || [])].map(s => s.toLowerCase());
    for (const n of names) {
      if (n.length < 3) continue;
      if (t.includes(n) && (!best || n.length > best.len)) best = { region: r, len: n.length, matched: n };
    }
  }
  return best;
}

/** Extract a landmark-ish location string from free text (English + Hindi/Hinglish patterns). */
export function extractLocationText(text) {
  const t = String(text || '');
  let m = t.match(/(?:near|at|opposite|behind|beside|in front of|around)\s+([A-Za-z0-9][A-Za-z0-9 .'-]{2,45}?)(?=[,.;!?]|\s+(?:and|but|since|for|is|are|has|have|there|no|not)\b|$)/i);
  if (m) return m[1].trim();
  m = t.match(/([A-Za-z0-9][A-Za-z0-9 .'-]{2,35}?)\s+(?:ke paas|ke pas|ke samne|ke aas paas)\b/i);
  if (m) return m[1].trim().split(/\s+/).slice(-3).join(' ');
  m = t.match(/([\u0900-\u097F][\u0900-\u097F ]{2,30}?)\s+(?:के पास|के सामने|के पास वाली)/u);
  if (m) return m[1].trim().split(/\s+/).slice(-3).join(' ');
  m = t.match(/(?:perto d[aeo]s?|em|na|no)\s+([A-Za-zÀ-ú0-9][A-Za-zÀ-ú0-9 .'-]{2,35})/i);
  if (m && /perto|bairro|rua|avenida/i.test(t)) return m[1].trim();
  return null;
}

/**
 * Normalise any request into the internal schema.
 * @param {object} input {text, channel, lat, lng, locationText, language, imageEvidence, submitterKey, aiClassification, timestamp, upvotes, isSynthetic, sourceId, regions}
 */
export function normalizeRequest(input) {
  const inst = getInstance();
  const regions = input.regions || [];
  const text = String(input.text || '').trim();
  const channel = CHANNELS.includes(input.channel) ? input.channel : 'api';

  // 1. Language
  const lang = input.language
    ? { code: input.language, name: input.language, confidence: 0.9, method: 'provided' }
    : detectLanguage(text);

  // 2. Development need: lexicon first; use AI/vision classification when it is clearly better
  let cls = classifyText(text);
  const traces = [{ step: 'classify', engine: cls.method, confidence: cls.confidence, terms: cls.matchedTerms }];
  const ai = input.aiClassification;
  if (ai && isValidCategory(ai.category, ai.subcategory) && (ai.confidence ?? 0) > cls.confidence) {
    traces.push({ step: 'classify-override', engine: ai.model || 'ai', from: `${cls.category}.${cls.subcategory}`, to: `${ai.category}.${ai.subcategory}`, confidence: ai.confidence });
    cls = { ...cls, category: ai.category, subcategory: ai.subcategory || 'general', confidence: ai.confidence, method: ai.model || 'ai' };
  } else if (ai && cls.category === 'other' && ai.legacyIssueType && ai.legacyIssueType !== 'Other') {
    const m = fromLegacyIssueType(ai.legacyIssueType);
    traces.push({ step: 'classify-legacy-bridge', engine: ai.model || 'legacy-ai', to: `${m.category}.${m.subcategory}` });
    cls = { ...cls, category: m.category, subcategory: m.subcategory, confidence: Math.max(cls.confidence, ai.confidence || 0.6), method: ai.model || 'legacy-ai' };
  }
  const cat = getCategory(cls.category) || getCategory('other');
  const sub = getSubcategory(cat.id, cls.subcategory);
  const safetyWeight = sub?.safetyWeight ?? cat.safetyWeight ?? 0.3;

  // 3. Location: explicit GPS > gazetteer > provided text > instance default (flagged low confidence)
  let lat = input.lat != null ? Number(input.lat) : null;
  let lng = input.lng != null ? Number(input.lng) : null;
  let locationSource = 'default';
  let region = null;
  let locText = input.locationText || extractLocationText(text);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    locationSource = input.locationSourceHint || 'gps';
    region = findRegion({ lat, lng }, regions)?.region || null;
  } else {
    lat = lng = null;
    const gz = gazetteerMatch(`${input.locationText || ''} ${text}`, regions);
    if (gz) {
      region = gz.region;
      if (!input.locationText) locText = gz.region.name;
      const p = jitterAround({ lat: region.lat, lng: region.lng }, Math.min(region.radiusKm * 0.8, 2.5), `${text}|${input.locationText || ''}`);
      lat = p.lat; lng = p.lng; locationSource = 'gazetteer';
    } else {
      // Unresolved: do NOT guess a region from a default map centre - the request is kept,
      // flagged for review, and excluded from spatial aggregation until a location is known.
      locationSource = 'unresolved';
    }
  }
  const locationConfidence = locationSource === 'gps' ? 0.95 : locationSource === 'gazetteer' ? 0.75 : locationSource === 'legacy-approximate' ? 0.5 : 0.2;

  // 4. Urgency + population relevance
  const urg = estimateUrgency(text, safetyWeight);
  const pop = estimatePopulationRelevance(text, SHARED_NATURE.has(cat.id) ? 0.15 : 0.05);

  // 5. Overall confidence: classification * location certainty (image evidence boosts)
  let confidence = cls.confidence * (0.75 + 0.25 * locationConfidence);
  if (input.imageEvidence?.confidence) confidence = clamp(confidence + 0.05 * input.imageEvidence.confidence, 0, 0.99);
  confidence = Math.round(clamp(confidence, 0.05, 0.99) * 100) / 100;

  const needsReview = confidence < 0.5 || cls.category === 'other' || locationSource === 'unresolved';
  return {
    channel,
    language: lang.code,
    languageName: lang.name,
    languageConfidence: lang.confidence,
    category: cat.id,
    categoryLabel: cat.label,
    subcategory: sub?.id || 'general',
    subcategoryLabel: sub?.label || 'General',
    description: text,
    descriptionRedacted: redactPII(text),
    locationText: locText || (region ? region.name : 'Location not specified'),
    lat, lng, locationSource, locationConfidence,
    regionId: region?.id || null,
    regionName: region?.name || null,
    urgency: urg.urgency, urgencyBand: urg.band, urgencyDetail: urg,
    populationRelevance: pop.relevance, populationScope: pop.scope, statedHouseholds: pop.statedHouseholds,
    affectedInfrastructure: `${sub?.label || cat.label} (${cat.label})`,
    confidence,
    classifier: cls.method,
    matchedTerms: cls.matchedTerms,
    trace: traces,
    imageEvidence: input.imageEvidence || null,
    textFingerprint: textFingerprint(text),
    submitterHash: hashIdentity(input.submitterKey),
    needsReview,
    reviewReason: needsReview ? (locationSource === 'unresolved' ? 'Location unresolved - excluded from spatial aggregation' : cls.category === 'other' ? 'Unclassified development need' : 'Low overall confidence') : null,
    timestamp: input.timestamp || new Date().toISOString(),
    upvotes: input.upvotes || 0,
    isSynthetic: input.isSynthetic ? 1 : 0,
    sourceId: input.sourceId || null,
    categoryLabelFn: undefined
  };
}
export { categoryLabel };
