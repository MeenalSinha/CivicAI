// ============================================================
// CivicAI - Development-intelligence schema (v4)
// Additive migration on top of the legacy complaint tables.
// PRIVACY: identity (name/phone) lives ONLY in `complaints`.
// Everything below is anonymised, aggregate-friendly intelligence data.
// ============================================================
import { dbRun, dbRows, dbTransaction, persistNow } from './db.js';
import { createHash } from 'crypto';

export function initDevSchema() {
  const T = [
    `CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, adapter TEXT NOT NULL,
      description TEXT DEFAULT '', license TEXT DEFAULT '', isSynthetic INTEGER NOT NULL DEFAULT 0,
      recordCount INTEGER DEFAULT 0, status TEXT DEFAULT 'ok', config TEXT DEFAULT '{}', lastSyncedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS demographic_regions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT DEFAULT '[]', level TEXT NOT NULL DEFAULT 'ward',
      parentId TEXT, district TEXT, state TEXT, countryCode TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, radiusKm REAL NOT NULL DEFAULT 2.5,
      population INTEGER NOT NULL, populationYear INTEGER, areaKm2 REAL NOT NULL, density REAL,
      deprivation REAL, geometry TEXT, sourceId TEXT, isSynthetic INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS infrastructure_assets (
      id TEXT PRIMARY KEY, regionId TEXT NOT NULL, sector TEXT NOT NULL, assetType TEXT NOT NULL,
      metric TEXT NOT NULL, value REAL NOT NULL, benchmark REAL NOT NULL, unit TEXT DEFAULT '',
      asOf TEXT, sourceId TEXT, isSynthetic INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (regionId) REFERENCES demographic_regions(id))`,
    `CREATE TABLE IF NOT EXISTS government_investments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, sector TEXT NOT NULL, regionIds TEXT NOT NULL DEFAULT '[]',
      coverage TEXT NOT NULL DEFAULT '{}', budget REAL, currency TEXT, stage TEXT NOT NULL,
      plannedCompletion TEXT, completedAt TEXT, targetPopulation INTEGER, department TEXT,
      source TEXT, sourceId TEXT, notes TEXT DEFAULT '', isSynthetic INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS citizen_requests (
      id TEXT PRIMARY KEY, complaintId TEXT, channel TEXT NOT NULL, language TEXT, category TEXT NOT NULL,
      subcategory TEXT, description TEXT NOT NULL, locationText TEXT, lat REAL, lng REAL,
      locationSource TEXT, regionId TEXT, urgency REAL, urgencyBand TEXT, populationRelevance REAL,
      affectedInfrastructure TEXT, confidence REAL, classifier TEXT, matchedTerms TEXT DEFAULT '[]',
      trace TEXT DEFAULT '[]', imageEvidence TEXT, submitterHash TEXT, textFingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'active', duplicateOf TEXT, clusterId TEXT, upvotes INTEGER NOT NULL DEFAULT 0,
      needsReview INTEGER NOT NULL DEFAULT 0, reviewReason TEXT, isSynthetic INTEGER NOT NULL DEFAULT 0,
      sourceId TEXT, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS request_clusters (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, subcategory TEXT, regionId TEXT,
      centroidLat REAL, centroidLng REAL, radiusKm REAL, requestCount INTEGER, uniqueLocations INTEGER,
      upvotes INTEGER, avgUrgency REAL, firstSeen TEXT, lastSeen TEXT, affectedPopulation INTEGER, computedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS development_demands (
      id TEXT PRIMARY KEY, regionId TEXT NOT NULL, category TEXT NOT NULL, requestCount INTEGER,
      duplicatesMerged INTEGER, uniqueLocations INTEGER, recentCount INTEGER, priorCount INTEGER,
      growthRate REAL, persistence REAL, concentration REAL, affectedPopulation INTEGER,
      avgUrgency REAL, upvotes INTEGER, safetyImpact REAL, categoryShare REAL, demandScore REAL, components TEXT,
      topSubcategories TEXT, weightsVersion TEXT, firstSeen TEXT, lastSeen TEXT, weeklySeries TEXT, computedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS infrastructure_gaps (
      id TEXT PRIMARY KEY, regionId TEXT NOT NULL, sector TEXT NOT NULL, demandScore REAL,
      availability REAL, gap REAL, populationInGap INTEGER, populationAffected INTEGER,
      severity REAL, severityBand TEXT, confidence REAL, dataStatus TEXT, reasoning TEXT, computedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS investment_alignments (
      id TEXT PRIMARY KEY, regionId TEXT NOT NULL, category TEXT NOT NULL, classification TEXT NOT NULL,
      coverage REAL, overlap INTEGER NOT NULL DEFAULT 0, matched TEXT, note TEXT, computedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS priority_projects (
      id TEXT PRIMARY KEY, regionId TEXT NOT NULL, category TEXT NOT NULL, rank INTEGER,
      priorityScore REAL, band TEXT, affectedPopulation INTEGER, topEvidence TEXT, proposedIntervention TEXT,
      responsibleDepartment TEXT, rationale TEXT, components TEXT, confidence REAL, investmentClass TEXT, computedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS policy_recommendations (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL UNIQUE, text TEXT NOT NULL, evidenceTrail TEXT,
      modelTrace TEXT, status TEXT NOT NULL DEFAULT 'pending_review', reviewer TEXT, reviewNote TEXT,
      reviewedAt TEXT, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS citizen_feedback (
      id TEXT PRIMARY KEY, complaintId TEXT NOT NULL, requestId TEXT, rating INTEGER NOT NULL,
      comment TEXT DEFAULT '', createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actorType TEXT NOT NULL, actorId TEXT,
      action TEXT NOT NULL, entityType TEXT, entityId TEXT, details TEXT DEFAULT '{}', prevHash TEXT, hash TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS config_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL, updatedBy TEXT)`,
    `CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY, trigger TEXT, startedAt TEXT, finishedAt TEXT, stats TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_req_region ON citizen_requests(regionId)`,
    `CREATE INDEX IF NOT EXISTS idx_req_cat ON citizen_requests(category, subcategory)`,
    `CREATE INDEX IF NOT EXISTS idx_req_created ON citizen_requests(createdAt DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_req_cluster ON citizen_requests(clusterId)`,
    `CREATE INDEX IF NOT EXISTS idx_req_submitter ON citizen_requests(submitterHash, createdAt)`,
    `CREATE INDEX IF NOT EXISTS idx_req_fp ON citizen_requests(textFingerprint)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_region ON infrastructure_assets(regionId, sector)`,
    `CREATE INDEX IF NOT EXISTS idx_inv_sector ON government_investments(sector)`,
    `CREATE INDEX IF NOT EXISTS idx_dem_region ON development_demands(regionId, category)`,
    `CREATE INDEX IF NOT EXISTS idx_gap_region ON infrastructure_gaps(regionId, sector)`,
    `CREATE INDEX IF NOT EXISTS idx_prio_rank ON priority_projects(rank)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entityType, entityId)`
  ];
  for (const sql of T) dbRun(sql);
  // Additive migrations for databases created by earlier v4 builds
  const cols = dbRows(`PRAGMA table_info(investment_alignments)`).map(c => c.name);
  if (!cols.includes('overlap')) dbRun(`ALTER TABLE investment_alignments ADD COLUMN overlap INTEGER NOT NULL DEFAULT 0`);
  const dcols = dbRows(`PRAGMA table_info(development_demands)`).map(c => c.name);
  if (!dcols.includes('categoryShare')) dbRun(`ALTER TABLE development_demands ADD COLUMN categoryShare REAL`);
}

const J = v => (v == null ? null : JSON.stringify(v));
const P = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
export { J, P };

// ------------------------------------------------------------
// Audit log with hash chain (tamper-evident)
// ------------------------------------------------------------
export function audit({ actorType = 'system', actorId = null, action, entityType = null, entityId = null, details = {} }) {
  const last = dbRows('SELECT hash FROM audit_logs ORDER BY seq DESC LIMIT 1')[0];
  const prevHash = last?.hash || 'GENESIS';
  const ts = new Date().toISOString();
  const payload = JSON.stringify({ ts, actorType, actorId, action, entityType, entityId, details });
  const hash = createHash('sha256').update(prevHash + payload).digest('hex');
  dbRun(`INSERT INTO audit_logs (ts,actorType,actorId,action,entityType,entityId,details,prevHash,hash) VALUES (?,?,?,?,?,?,?,?,?)`,
    [ts, actorType, actorId, action, entityType, entityId, JSON.stringify(details), prevHash, hash]);
  return hash;
}

export function getAuditLogs({ limit = 100, entityType, entityId, action } = {}) {
  let sql = 'SELECT * FROM audit_logs WHERE 1=1'; const p = [];
  if (entityType) { sql += ' AND entityType = ?'; p.push(entityType); }
  if (entityId) { sql += ' AND entityId = ?'; p.push(entityId); }
  if (action) { sql += ' AND action = ?'; p.push(action); }
  sql += ' ORDER BY seq DESC LIMIT ?'; p.push(Math.min(500, limit));
  return dbRows(sql, p).map(r => ({ ...r, details: P(r.details, {}) }));
}

export function verifyAuditChain() {
  const rows = dbRows('SELECT * FROM audit_logs ORDER BY seq ASC');
  let prev = 'GENESIS';
  for (const r of rows) {
    const payload = JSON.stringify({ ts: r.ts, actorType: r.actorType, actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId, details: P(r.details, {}) });
    const expect = createHash('sha256').update(prev + payload).digest('hex');
    if (r.prevHash !== prev || r.hash !== expect) return { valid: false, brokenAtSeq: r.seq, entries: rows.length };
    prev = r.hash;
  }
  return { valid: true, entries: rows.length };
}

// ------------------------------------------------------------
// config_kv
// ------------------------------------------------------------
export function getConfigValue(key, fallback = null) {
  const r = dbRows('SELECT value FROM config_kv WHERE key = ?', [key])[0];
  return r ? P(r.value, fallback) : fallback;
}
export function setConfigValue(key, value, by = 'system') {
  dbRun('INSERT OR REPLACE INTO config_kv (key,value,updatedAt,updatedBy) VALUES (?,?,?,?)', [key, JSON.stringify(value), new Date().toISOString(), by]);
}

// ------------------------------------------------------------
// data sources / regions / assets / investments
// ------------------------------------------------------------
export function upsertDataSource(s) {
  dbRun(`INSERT OR REPLACE INTO data_sources (id,name,kind,adapter,description,license,isSynthetic,recordCount,status,config,lastSyncedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [s.id, s.name, s.kind, s.adapter, s.description || '', s.license || '', s.isSynthetic ? 1 : 0, s.recordCount || 0, s.status || 'ok', J(s.config || {}), new Date().toISOString()]);
}
export function listDataSources() {
  return dbRows('SELECT * FROM data_sources ORDER BY kind, name').map(r => ({ ...r, isSynthetic: !!r.isSynthetic, config: P(r.config, {}) }));
}

export function upsertRegion(r) {
  const density = r.areaKm2 ? Math.round(r.population / r.areaKm2) : null;
  dbRun(`INSERT OR REPLACE INTO demographic_regions (id,name,aliases,level,parentId,district,state,countryCode,lat,lng,radiusKm,population,populationYear,areaKm2,density,deprivation,geometry,sourceId,isSynthetic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [r.id, r.name, J(r.aliases || []), r.level || 'ward', r.parentId || null, r.district || null, r.state || null, r.countryCode, r.lat, r.lng, r.radiusKm || 2.5, r.population, r.populationYear || null, r.areaKm2, density, r.deprivation ?? null, J(r.geometry || null), r.sourceId || null, r.isSynthetic ? 1 : 0]);
}
export function getRegions() {
  return dbRows('SELECT * FROM demographic_regions ORDER BY name').map(r => ({ ...r, aliases: P(r.aliases, []), geometry: P(r.geometry), isSynthetic: !!r.isSynthetic }));
}

export function upsertAsset(a) {
  dbRun(`INSERT OR REPLACE INTO infrastructure_assets (id,regionId,sector,assetType,metric,value,benchmark,unit,asOf,sourceId,isSynthetic) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [a.id, a.regionId, a.sector, a.assetType || a.metric, a.metric, a.value, a.benchmark, a.unit || '', a.asOf || null, a.sourceId || null, a.isSynthetic ? 1 : 0]);
}
export function getAssets() { return dbRows('SELECT * FROM infrastructure_assets').map(a => ({ ...a, isSynthetic: !!a.isSynthetic })); }

export function upsertInvestment(i) {
  dbRun(`INSERT OR REPLACE INTO government_investments (id,name,sector,regionIds,coverage,budget,currency,stage,plannedCompletion,completedAt,targetPopulation,department,source,sourceId,notes,isSynthetic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [i.id, i.name, i.sector, J(i.regionIds || []), J(i.coverage || {}), i.budget ?? null, i.currency || null, i.stage, i.plannedCompletion || null, i.completedAt || null, i.targetPopulation ?? null, i.department || null, i.source || null, i.sourceId || null, i.notes || '', i.isSynthetic ? 1 : 0]);
}
export function getInvestments() {
  return dbRows('SELECT * FROM government_investments').map(i => ({ ...i, regionIds: P(i.regionIds, []), coverage: P(i.coverage, {}), isSynthetic: !!i.isSynthetic }));
}

// ------------------------------------------------------------
// citizen_requests
// ------------------------------------------------------------
const REQ_COLS = ['id','complaintId','channel','language','category','subcategory','description','locationText','lat','lng','locationSource','regionId','urgency','urgencyBand','populationRelevance','affectedInfrastructure','confidence','classifier','matchedTerms','trace','imageEvidence','submitterHash','textFingerprint','status','duplicateOf','clusterId','upvotes','needsReview','reviewReason','isSynthetic','sourceId','createdAt'];

export function insertRequest(r) {
  const row = { ...r, matchedTerms: J(r.matchedTerms || []), trace: J(r.trace || []), imageEvidence: J(r.imageEvidence || null), needsReview: r.needsReview ? 1 : 0, status: r.status || 'active' };
  dbRun(`INSERT INTO citizen_requests (${REQ_COLS.join(',')}) VALUES (${REQ_COLS.map(() => '?').join(',')})`, REQ_COLS.map(c => row[c] ?? null));
  return r.id;
}
export function hydrateRequest(r) {
  return { ...r, matchedTerms: P(r.matchedTerms, []), trace: P(r.trace, []), imageEvidence: P(r.imageEvidence), needsReview: !!r.needsReview, isSynthetic: !!r.isSynthetic };
}
export function getRequests({ status, regionId, category, since, limit } = {}) {
  let sql = 'SELECT * FROM citizen_requests WHERE 1=1'; const p = [];
  if (status) { sql += ' AND status = ?'; p.push(status); }
  if (regionId) { sql += ' AND regionId = ?'; p.push(regionId); }
  if (category) { sql += ' AND category = ?'; p.push(category); }
  if (since) { sql += ' AND createdAt >= ?'; p.push(since); }
  sql += ' ORDER BY createdAt ASC';
  if (limit) { sql += ' LIMIT ?'; p.push(limit); }
  return dbRows(sql, p).map(hydrateRequest);
}
export function getRequestById(id) {
  const r = dbRows('SELECT * FROM citizen_requests WHERE id = ? LIMIT 1', [id])[0];
  return r ? hydrateRequest(r) : null;
}
export function countRequests() { return dbRows('SELECT COUNT(*) AS n FROM citizen_requests')[0].n; }
export function recentBySubmitter(hash, sinceIso) {
  if (!hash) return 0;
  return dbRows('SELECT COUNT(*) AS n FROM citizen_requests WHERE submitterHash = ? AND createdAt >= ?', [hash, sinceIso])[0].n;
}
export function setRequestStatus(id, status, duplicateOf = null) {
  dbRun('UPDATE citizen_requests SET status = ?, duplicateOf = ? WHERE id = ?', [status, duplicateOf, id]);
}
export function updateRequestClassification(id, category, subcategory, trace, by) {
  const t = [...(trace || []), { step: 'human-review', engine: 'human', by, to: `${category}.${subcategory}`, at: new Date().toISOString() }];
  dbRun(`UPDATE citizen_requests SET category=?, subcategory=?, classifier='human-review', confidence=0.99, needsReview=0, reviewReason=NULL, trace=? WHERE id=?`, [category, subcategory, J(t), id]);
}
export function bumpRequestUpvotes(requestId) {
  dbRun('UPDATE citizen_requests SET upvotes = upvotes + 1 WHERE id = ?', [requestId]);
}

// ------------------------------------------------------------
// derived tables: replace-all inside a transaction
// ------------------------------------------------------------
export function replaceClusters(clusters, assignments) {
  dbTransaction(() => {
    dbRun('DELETE FROM request_clusters');
    for (const c of clusters) {
      dbRun(`INSERT INTO request_clusters (id,category,subcategory,regionId,centroidLat,centroidLng,radiusKm,requestCount,uniqueLocations,upvotes,avgUrgency,firstSeen,lastSeen,affectedPopulation,computedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [c.id, c.category, c.subcategory, c.regionId, c.centroidLat, c.centroidLng, c.radiusKm, c.requestCount, c.uniqueLocations, c.upvotes, c.avgUrgency, c.firstSeen, c.lastSeen, c.affectedPopulation, c.computedAt]);
    }
    dbRun('UPDATE citizen_requests SET clusterId = NULL');
    for (const [reqId, cid] of assignments) dbRun('UPDATE citizen_requests SET clusterId = ? WHERE id = ?', [cid, reqId]);
  });
}
export function getClusters() { return dbRows('SELECT * FROM request_clusters ORDER BY requestCount DESC'); }

export function replaceDemands(demands) {
  dbTransaction(() => {
    dbRun('DELETE FROM development_demands');
    for (const d of demands) {
      dbRun(`INSERT INTO development_demands (id,regionId,category,requestCount,duplicatesMerged,uniqueLocations,recentCount,priorCount,growthRate,persistence,concentration,affectedPopulation,avgUrgency,upvotes,safetyImpact,categoryShare,demandScore,components,topSubcategories,weightsVersion,firstSeen,lastSeen,weeklySeries,computedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [d.id, d.regionId, d.category, d.requestCount, d.duplicatesMerged, d.uniqueLocations, d.recentCount, d.priorCount, d.growthRate, d.persistence, d.concentration, d.affectedPopulation, d.avgUrgency, d.upvotes, d.safetyImpact, d.categoryShare, d.demandScore, J(d.components), J(d.topSubcategories), d.weightsVersion, d.firstSeen, d.lastSeen, J(d.weeklySeries), d.computedAt]);
    }
  });
}
export function getDemands() {
  return dbRows('SELECT * FROM development_demands ORDER BY demandScore DESC').map(d => ({ ...d, components: P(d.components, {}), topSubcategories: P(d.topSubcategories, []), weeklySeries: P(d.weeklySeries, []) }));
}

export function replaceGaps(gaps) {
  dbTransaction(() => {
    dbRun('DELETE FROM infrastructure_gaps');
    for (const g of gaps) {
      dbRun(`INSERT INTO infrastructure_gaps (id,regionId,sector,demandScore,availability,gap,populationInGap,populationAffected,severity,severityBand,confidence,dataStatus,reasoning,computedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [g.id, g.regionId, g.sector, g.demandScore, g.availability, g.gap, g.populationInGap, g.populationAffected, g.severity, g.severityBand, g.confidence, g.dataStatus, J(g.reasoning), g.computedAt]);
    }
  });
}
export function getGaps() { return dbRows('SELECT * FROM infrastructure_gaps ORDER BY severity DESC').map(g => ({ ...g, reasoning: P(g.reasoning, []) })); }

export function replaceAlignments(items) {
  dbTransaction(() => {
    dbRun('DELETE FROM investment_alignments');
    for (const a of items) dbRun(`INSERT INTO investment_alignments (id,regionId,category,classification,coverage,overlap,matched,note,computedAt) VALUES (?,?,?,?,?,?,?,?,?)`,
      [a.id, a.regionId, a.category, a.classification, a.coverage, a.overlap ? 1 : 0, J(a.matched), a.note, a.computedAt]);
  });
}
export function getAlignments() { return dbRows('SELECT * FROM investment_alignments').map(a => ({ ...a, overlap: !!a.overlap, matched: P(a.matched, []) })); }

export function replaceProjects(projects) {
  dbTransaction(() => {
    dbRun('DELETE FROM priority_projects');
    for (const p of projects) dbRun(`INSERT INTO priority_projects (id,regionId,category,rank,priorityScore,band,affectedPopulation,topEvidence,proposedIntervention,responsibleDepartment,rationale,components,confidence,investmentClass,computedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id, p.regionId, p.category, p.rank, p.priorityScore, p.band, p.affectedPopulation, J(p.topEvidence), p.proposedIntervention, p.responsibleDepartment, p.rationale, J(p.components), p.confidence, p.investmentClass, p.computedAt]);
  });
}
export function getProjects() {
  return dbRows('SELECT * FROM priority_projects ORDER BY rank ASC').map(p => ({ ...p, topEvidence: P(p.topEvidence, []), components: P(p.components, {}) }));
}

// recommendations keep their human-review state across recomputation
export function upsertRecommendation(rec) {
  const existing = dbRows('SELECT * FROM policy_recommendations WHERE projectId = ?', [rec.projectId])[0];
  const now = new Date().toISOString();
  if (existing) {
    dbRun('UPDATE policy_recommendations SET text=?, evidenceTrail=?, modelTrace=?, updatedAt=?, version=version+1 WHERE projectId=?',
      [rec.text, J(rec.evidenceTrail), J(rec.modelTrace), now, rec.projectId]);
  } else {
    dbRun(`INSERT INTO policy_recommendations (id,projectId,text,evidenceTrail,modelTrace,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)`,
      [rec.id, rec.projectId, rec.text, J(rec.evidenceTrail), J(rec.modelTrace), rec.status || 'pending_review', now, now]);
  }
}
export function pruneRecommendations(validProjectIds) {
  if (!validProjectIds.length) return;
  const ph = validProjectIds.map(() => '?').join(',');
  dbRun(`DELETE FROM policy_recommendations WHERE projectId NOT IN (${ph}) AND status = 'pending_review'`, validProjectIds);
}
export function getRecommendations() {
  return dbRows('SELECT * FROM policy_recommendations').map(r => ({ ...r, evidenceTrail: P(r.evidenceTrail, []), modelTrace: P(r.modelTrace, {}) }));
}
export function getRecommendationByProject(projectId) {
  const r = dbRows('SELECT * FROM policy_recommendations WHERE projectId = ?', [projectId])[0];
  return r ? { ...r, evidenceTrail: P(r.evidenceTrail, []), modelTrace: P(r.modelTrace, {}) } : null;
}
export function reviewRecommendation(projectId, { status, reviewer, note }) {
  dbRun('UPDATE policy_recommendations SET status=?, reviewer=?, reviewNote=?, reviewedAt=?, updatedAt=? WHERE projectId=?',
    [status, reviewer, note || '', new Date().toISOString(), new Date().toISOString(), projectId]);
  return getRecommendationByProject(projectId);
}

// feedback / outcomes
export function addFeedback(f) {
  dbRun('INSERT INTO citizen_feedback (id,complaintId,requestId,rating,comment,createdAt) VALUES (?,?,?,?,?,?)',
    [f.id, f.complaintId, f.requestId || null, f.rating, f.comment || '', new Date().toISOString()]);
}
export function getFeedback() { return dbRows('SELECT * FROM citizen_feedback'); }

export function recordPipelineRun(run) {
  dbRun('INSERT INTO pipeline_runs (id,trigger,startedAt,finishedAt,stats) VALUES (?,?,?,?,?)', [run.id, run.trigger, run.startedAt, run.finishedAt, J(run.stats)]);
}
export function lastPipelineRun() {
  const r = dbRows('SELECT * FROM pipeline_runs ORDER BY startedAt DESC LIMIT 1')[0];
  return r ? { ...r, stats: P(r.stats, {}) } : null;
}
export { persistNow };
