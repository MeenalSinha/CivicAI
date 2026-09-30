// ============================================================
// Unified intake service: every channel (chat, text, voice, image,
// messaging webhooks, backfilled legacy complaints) goes through here.
// Legacy complaint record (identity + officer workflow) and the anonymised
// development-intelligence request are created together but stored separately.
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import * as dev from '../database/devdb.js';
import { addComplaint, getComplaintById, linkComplaintToRequest, getAllComplaints, dbRows } from '../database/db.js';
import { normalizeRequest } from './normalize.js';
import { assessSubmission } from './clustering.js';
import { getWeights, schedulePipeline } from './pipeline.js';
import { legacyIssueType } from './taxonomy.js';
import { extractDevelopmentNeed } from '../ai/aiService.js';
import { getInstance } from './config.js';
import { legacyLanguageName } from './language.js';

const LEGACY_DEPT = { roads_transport: 'Road Maintenance', waste_management: 'Sanitation', sanitation: 'Sanitation', electricity: 'Electrical Department', water_supply: 'Water Supply', drainage_flood: 'Water Supply' };
const legacyPriority = band => ({ critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }[band] || 'MEDIUM');
const newReqId = () => `REQ-${uuidv4().replace(/-/g, '').slice(0, 10)}`;

export class IntakeError extends Error {
  constructor(message, status = 400, code = 'INTAKE_ERROR') { super(message); this.status = status; this.code = code; }
}

/**
 * @param {object} p
 *  text, channel, lat, lng, locationText, submitterKey (phone/session/ip - hashed, never stored raw in intelligence tables)
 *  citizenName, citizenPhone (kept ONLY on the legacy complaint)
 *  legacy: output of processComplaint() (department/priority/sentiment/etc.) if available
 *  imageEvidence, createComplaint (default true)
 */
export async function ingestRequest(p) {
  const regions = dev.getRegions();
  const weights = getWeights();
  const legacy = p.legacy || null;

  let n = normalizeRequest({
    text: p.text, channel: p.channel, lat: p.lat, lng: p.lng, locationText: p.locationText, regions,
    submitterKey: p.submitterKey, imageEvidence: p.imageEvidence, language: p.language,
    aiClassification: legacy ? { legacyIssueType: legacy.issueType, confidence: legacy.aiConfidence, model: legacy.model } : null,
    locationSourceHint: p.locationSourceHint, timestamp: p.timestamp, isSynthetic: p.isSynthetic, sourceId: p.sourceId, upvotes: p.upvotes
  });

  // LLM only when the deterministic classifier is unsure (never for scores)
  if (n.confidence < 0.6 && n.description.length > 8 && !p.skipAI) {
    const ai = await extractDevelopmentNeed(n.description).catch(() => null);
    if (ai) n = normalizeRequest({ ...p, regions, aiClassification: ai, submitterKey: p.submitterKey });
  }

  // Spam / duplicate protection
  const since = new Date(Date.now() - weights.params.duplicateWindowHours * 3600_000).toISOString();
  const recent = dev.getRequests({ since });
  const verdict = assessSubmission({ ...n, description: n.description, timestamp: n.timestamp }, recent, weights.params);
  if (verdict.status === 'spam') {
    dev.audit({ actorType: 'citizen', actorId: n.submitterHash, action: 'request.rejected_spam', details: { reason: verdict.reason, channel: n.channel } });
    throw new IntakeError('Too many submissions in a short time. Please wait before submitting again.', 429, 'RATE_LIMITED');
  }
  if (verdict.status === 'duplicate') {
    const orig = dev.getRequestById(verdict.duplicateOf);
    dev.audit({ actorType: 'citizen', actorId: n.submitterHash, action: 'request.duplicate_detected', entityType: 'citizen_request', entityId: verdict.duplicateOf, details: { reason: verdict.reason } });
    // keep a linked record (excluded from counts) so volume metrics can show how many duplicates were merged
    const dupId = newReqId();
    dev.insertRequest({ id: dupId, ...n, description: n.descriptionRedacted, createdAt: n.timestamp, status: 'duplicate', duplicateOf: verdict.duplicateOf });
    const existing = orig?.complaintId ? getComplaintById(orig.complaintId) : null;
    return { duplicate: true, reason: verdict.reason, request: orig, complaint: existing };
  }

  // Legacy complaint (officer workflow + citizen tracking) - keeps identity separate
  const createComplaint = p.createComplaint !== false;
  const id = newReqId();
  let complaint = null;
  if (createComplaint) {
    const l = legacy || {};
    const legacyLat = n.lat ?? undefined, legacyLng = n.lng ?? undefined;
    complaint = addComplaint({
      issueType: l.issueType || legacyIssueType(n.category, n.subcategory),
      description: p.text,
      location: { text: n.locationText || 'Location pending confirmation', lat: legacyLat ?? p.fallbackLat, lng: legacyLng ?? p.fallbackLng },
      department: l.department || LEGACY_DEPT[n.category] || 'General Administration',
      priority: l.priority || legacyPriority(n.urgencyBand),
      citizenName: p.citizenName || 'Anonymous', citizenPhone: p.citizenPhone || 'Not provided',
      aiConfidence: l.aiConfidence ?? n.confidence,
      detectedLanguage: l.detectedLanguage || legacyLanguageName(n.language),
      keywords: l.keywords || n.matchedTerms, sentiment: l.sentiment || 'neutral', channel: p.legacyChannel || (n.channel === 'messaging' ? 'chat' : n.channel)
    });
    linkComplaintToRequest(complaint.id, id);
    complaint.requestId = id;
  }

  // Intelligence record: redacted text only, hashed submitter, no name/phone
  dev.insertRequest({ id, complaintId: complaint?.id || null, ...n, description: n.descriptionRedacted, createdAt: n.timestamp });
  dev.audit({ actorType: 'citizen', actorId: n.submitterHash, action: 'request.ingested', entityType: 'citizen_request', entityId: id,
    details: { channel: n.channel, language: n.language, category: n.category, subcategory: n.subcategory, confidence: n.confidence, classifier: n.classifier, locationSource: n.locationSource, regionId: n.regionId, complaintId: complaint?.ticketId || null } });
  if (!p.skipPipeline) schedulePipeline('intake');
  return { duplicate: false, request: { id, ...n, description: n.descriptionRedacted }, complaint };
}

/** Bring pre-existing (legacy) complaints into the normalised model - idempotent. */
export function backfillLegacyComplaints() {
  const regions = dev.getRegions();
  if (!regions.length) return 0;
  const rows = getAllComplaints().filter(c => !c.requestId);
  let count = 0;
  const seedTicket = /^TKT-00[1-6]$/;
  for (const c of rows.reverse()) {
    const isSeed = seedTicket.test(c.ticketId);
    const n = normalizeRequest({
      text: c.description, channel: ({ chat: 'chat', voice: 'voice', image: 'image', manual: 'text' })[c.channel] || 'api',
      lat: c.location?.lat, lng: c.location?.lng, locationText: c.location?.text, regions,
      locationSourceHint: isSeed ? 'gps' : 'legacy-approximate', submitterKey: c.citizenPhone && c.citizenPhone !== 'Not provided' ? c.citizenPhone : null,
      aiClassification: { legacyIssueType: c.issueType, confidence: c.aiConfidence, model: 'legacy' },
      timestamp: c.timestamp, upvotes: c.upvotes, isSynthetic: isSeed, sourceId: isSeed ? 'legacy-seed-complaints' : 'legacy-complaints'
    });
    const id = newReqId();
    dev.insertRequest({ id, complaintId: c.id, ...n, description: n.descriptionRedacted, createdAt: n.timestamp });
    linkComplaintToRequest(c.id, id);
    count++;
  }
  if (count) dev.audit({ action: 'legacy.backfill', entityType: 'pipeline', details: { complaints: count } });
  return count;
}

export function syncUpvote(complaint) {
  if (complaint?.requestId) dev.bumpRequestUpvotes(complaint.requestId);
  schedulePipeline('upvote', 1500);
}
