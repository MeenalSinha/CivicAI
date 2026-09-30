// ============================================================
// Duplicate/spam detection + spatial demand clustering
// ============================================================
import { createHash } from 'crypto';
import { haversineKm, circleAreaKm2 } from './geo.js';
import { jaccard } from './textutils.js';

/**
 * Decide whether an incoming request is spam / a repeat submission.
 * Different citizens reporting the same problem are INDEPENDENT signals and are kept.
 * Only repeats by the same submitter (or an immediate anonymous double-submit) are collapsed.
 */
export function assessSubmission(req, recent, params) {
  const nowMs = new Date(req.timestamp || Date.now()).getTime();
  const hourAgo = nowMs - 3600_000;
  if (req.submitterHash) {
    const lastHour = recent.filter(r => r.submitterHash === req.submitterHash && new Date(r.createdAt).getTime() >= hourAgo).length;
    if (lastHour >= params.spamPerHour) return { status: 'spam', reason: `Submission rate limit exceeded (${lastHour}/${params.spamPerHour} per hour)` };
  }
  const windowMs = params.duplicateWindowHours * 3600_000;
  for (const r of recent) {
    if (r.status === 'spam') continue;
    const age = nowMs - new Date(r.createdAt).getTime();
    if (age < 0 || age > windowMs) continue;
    if (req.submitterHash && r.submitterHash === req.submitterHash) {
      const sim = r.textFingerprint === req.textFingerprint ? 1 : jaccard(r.description, req.description);
      if (sim >= params.duplicateSimilarity) return { status: 'duplicate', duplicateOf: r.duplicateOf || r.id, reason: `Repeat submission by the same submitter (text similarity ${Math.round(sim * 100)}%)` };
    } else if (!req.submitterHash && !r.submitterHash && age < 10 * 60_000 && r.textFingerprint === req.textFingerprint) {
      const near = r.lat != null && req.lat != null ? haversineKm({ lat: r.lat, lng: r.lng }, { lat: req.lat, lng: req.lng }) < 0.15 : r.regionId === req.regionId;
      if (near) return { status: 'duplicate', duplicateOf: r.duplicateOf || r.id, reason: 'Identical anonymous submission within 10 minutes' };
    }
  }
  return { status: 'active' };
}

const GRID = 0.003; // ~300 m grid for "unique affected locations"
export const gridKey = r => `${Math.round((r.lat ?? 0) / GRID)}:${Math.round((r.lng ?? 0) / GRID)}`;

/**
 * Greedy incremental spatial clustering restricted to the same development need.
 * Deterministic for a given (time-ordered) input.
 */
export function clusterRequests(requests, regionsById, params, now = new Date()) {
  const reqs = requests.filter(r => r.status === 'active' && r.lat != null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const clusters = [];
  const assignments = [];
  for (const r of reqs) {
    let best = null;
    for (const c of clusters) {
      if (c.category !== r.category || c.subcategory !== r.subcategory) continue;
      const d = haversineKm({ lat: c.centroidLat, lng: c.centroidLng }, { lat: r.lat, lng: r.lng });
      if (d <= params.clusterEpsKm && (!best || d < best.d)) best = { c, d };
    }
    let c = best?.c;
    if (!c) {
      const id = 'CL-' + createHash('sha1').update(`${r.category}|${r.subcategory}|${r.id}`).digest('hex').slice(0, 8);
      c = { id, category: r.category, subcategory: r.subcategory, members: [], centroidLat: r.lat, centroidLng: r.lng };
      clusters.push(c);
    }
    c.members.push(r);
    c.centroidLat = c.members.reduce((s, m) => s + m.lat, 0) / c.members.length;
    c.centroidLng = c.members.reduce((s, m) => s + m.lng, 0) / c.members.length;
    assignments.push([r.id, c.id]);
  }
  const out = clusters.map(c => {
    const regionVotes = {};
    for (const m of c.members) if (m.regionId) regionVotes[m.regionId] = (regionVotes[m.regionId] || 0) + 1;
    const regionId = Object.entries(regionVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const region = regionId ? regionsById[regionId] : null;
    const radiusKm = Math.max(0.15, ...c.members.map(m => haversineKm({ lat: c.centroidLat, lng: c.centroidLng }, { lat: m.lat, lng: m.lng })));
    const density = region?.density || (region ? region.population / region.areaKm2 : 0);
    // Footprint estimate: cluster radius + 300 m service catchment x local population density (capped at region population)
    const footprint = region ? Math.min(region.population, Math.round(density * circleAreaKm2(radiusKm + 0.3))) : 0;
    return {
      id: c.id, category: c.category, subcategory: c.subcategory, regionId,
      centroidLat: c.centroidLat, centroidLng: c.centroidLng, radiusKm: Math.round(radiusKm * 100) / 100,
      requestCount: c.members.length, uniqueLocations: new Set(c.members.map(gridKey)).size,
      upvotes: c.members.reduce((s, m) => s + (m.upvotes || 0), 0),
      avgUrgency: Math.round(c.members.reduce((s, m) => s + (m.urgency || 0), 0) / c.members.length * 100) / 100,
      firstSeen: c.members[0].createdAt, lastSeen: c.members[c.members.length - 1].createdAt,
      affectedPopulation: footprint, computedAt: now.toISOString()
    };
  });
  return { clusters: out, assignments };
}
