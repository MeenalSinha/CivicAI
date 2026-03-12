// ============================================================
// CivicAI - Persistent Database Layer (sql.js / SQLite)
// Data survives server restarts. Serialized to disk every 30s.
// ============================================================

import initSqlJs from 'sql.js';
import { readFileSync, writeFile, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DB_PATH || './civicai.db';

let SQL, _db;

export async function initDatabase() {
  SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    _db = new SQL.Database(readFileSync(DB_PATH));
    console.log('[DB] Loaded existing database from', DB_PATH);
  } else {
    _db = new SQL.Database();
    console.log('[DB] Created new database');
  }
  createSchema();
  seedIfEmpty();
  setInterval(persistToDisk, 30_000);
  return _db;
}

function persistToDisk() {
  try {
    const data = Buffer.from(_db.export());
    writeFile(DB_PATH, data, (err) => {
      if (err) console.error('[DB] Async persist failed:', err.message);
    });
  } catch (err) { console.error('[DB] Persist export failed:', err.message); }
}
process.on('exit', persistToDisk);
process.on('SIGINT', () => { persistToDisk(); process.exit(0); });
process.on('SIGTERM', () => { persistToDisk(); process.exit(0); });

function run(sql, params = []) { _db.run(sql, params); }
function exec(sql, params = []) { return _db.exec(sql, params); }

function createSchema() {
  run(`CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY, ticketId TEXT UNIQUE NOT NULL, issueType TEXT NOT NULL,
    description TEXT NOT NULL, locationText TEXT NOT NULL, locationLat REAL NOT NULL,
    locationLng REAL NOT NULL, department TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','resolved')),
    citizenName TEXT NOT NULL DEFAULT 'Anonymous', citizenPhone TEXT NOT NULL DEFAULT 'Not provided',
    aiConfidence REAL DEFAULT 0, detectedLanguage TEXT DEFAULT 'English',
    upvotes INTEGER NOT NULL DEFAULT 0, channel TEXT NOT NULL DEFAULT 'manual',
    notes TEXT DEFAULT '', officerName TEXT DEFAULT '', sentiment TEXT DEFAULT 'neutral',
    keywords TEXT DEFAULT '[]', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, ticketId TEXT NOT NULL, message TEXT NOT NULL,
    type TEXT NOT NULL, isRead INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS officers (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'officer', createdAt TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS analytics_cache (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, expiresAt TEXT NOT NULL
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_c_status ON complaints(status)`);
  run(`CREATE INDEX IF NOT EXISTS idx_c_priority ON complaints(priority)`);
  run(`CREATE INDEX IF NOT EXISTS idx_c_dept ON complaints(department)`);
  run(`CREATE INDEX IF NOT EXISTS idx_c_created ON complaints(createdAt DESC)`);
}

let ticketCounter = 7;

function seedIfEmpty() {
  const count = exec('SELECT COUNT(*) as n FROM complaints')[0]?.values[0][0] || 0;
  if (count > 0) {
    // Derive ticket counter from MAX ticketId to avoid UNIQUE constraint violations
    const res = exec("SELECT MAX(CAST(REPLACE(ticketId,'TKT-','') AS INTEGER)) FROM complaints");
    const maxNum = res[0]?.values[0][0];
    if (maxNum != null && !isNaN(maxNum)) ticketCounter = maxNum + 1;
    console.log(`[DB] ${count} complaints loaded. Next ticket: TKT-${String(ticketCounter).padStart(3,'0')}`);
    seedOfficers(); return;
  }
  const now = Date.now();
  const seeds = [
    { ticketId:'TKT-001', issueType:'Pothole', description:'Large pothole near Sector 14 metro station causing traffic issues and vehicle damage.', locationText:'Sector 14, Metro Station Gate 2, New Delhi', locationLat:28.6139, locationLng:77.2090, department:'Road Maintenance', priority:'HIGH', status:'in_progress', citizenName:'Rahul Sharma', citizenPhone:'+91 98765 43210', aiConfidence:0.94, detectedLanguage:'English', upvotes:12, channel:'chat', notes:'Team dispatched, estimated repair tomorrow morning', officerName:'Officer Patel', sentiment:'neutral', keywords:'["pothole","road"]', createdAt:new Date(now-3600000*5).toISOString(), updatedAt:new Date(now-3600000*2).toISOString() },
    { ticketId:'TKT-002', issueType:'Garbage Overflow', description:'Garbage bin overflowing on Main Market Road for 3 days, creating unhygienic conditions.', locationText:'Main Market Road, Block C, New Delhi', locationLat:28.6200, locationLng:77.2150, department:'Sanitation', priority:'CRITICAL', status:'pending', citizenName:'Priya Patel', citizenPhone:'+91 87654 32109', aiConfidence:0.97, detectedLanguage:'Hindi', upvotes:23, channel:'chat', notes:'', officerName:'', sentiment:'frustrated', keywords:'["garbage","overflow"]', createdAt:new Date(now-3600000*2).toISOString(), updatedAt:new Date(now-3600000*2).toISOString() },
    { ticketId:'TKT-003', issueType:'Broken Streetlight', description:'Street light not working for 3 days near park entrance. Safety hazard at night.', locationText:'Central Park Entrance, Sector 21, New Delhi', locationLat:28.6050, locationLng:77.2200, department:'Electrical Department', priority:'MEDIUM', status:'resolved', citizenName:'Amit Kumar', citizenPhone:'+91 76543 21098', aiConfidence:0.91, detectedLanguage:'English', upvotes:7, channel:'voice', notes:'Bulb replaced and wiring checked', officerName:'Officer Singh', sentiment:'neutral', keywords:'["streetlight","safety"]', createdAt:new Date(now-3600000*24).toISOString(), updatedAt:new Date(now-3600000*4).toISOString() },
    { ticketId:'TKT-004', issueType:'Water Leakage', description:'Pipe burst on NH-8 underpass causing severe water logging and traffic jam.', locationText:'NH-8 Underpass, Near Toll Plaza, New Delhi', locationLat:28.5950, locationLng:77.1900, department:'Water Supply', priority:'CRITICAL', status:'in_progress', citizenName:'Sunita Verma', citizenPhone:'+91 65432 10987', aiConfidence:0.96, detectedLanguage:'Hinglish', upvotes:31, channel:'chat', notes:'Emergency team deployed at site', officerName:'Officer Mehra', sentiment:'frustrated', keywords:'["water","pipe","flood"]', createdAt:new Date(now-3600000*1).toISOString(), updatedAt:new Date(now-3600000*1).toISOString() },
    { ticketId:'TKT-005', issueType:'Damaged Infrastructure', description:'Footpath tiles broken creating hazard for pedestrians near bus stop.', locationText:'MG Road, Near Bus Stop 7, New Delhi', locationLat:28.6300, locationLng:77.2300, department:'Road Maintenance', priority:'MEDIUM', status:'pending', citizenName:'Deepak Singh', citizenPhone:'+91 54321 09876', aiConfidence:0.88, detectedLanguage:'English', upvotes:5, channel:'image', notes:'', officerName:'', sentiment:'neutral', keywords:'["footpath","tiles"]', createdAt:new Date(now-3600000*8).toISOString(), updatedAt:new Date(now-3600000*8).toISOString() },
    { ticketId:'TKT-006', issueType:'Pothole', description:'Very large pothole causing multiple accidents. Vehicle damages reported this week.', locationText:'Gali No 5, Lajpat Nagar, New Delhi', locationLat:28.6100, locationLng:77.2400, department:'Road Maintenance', priority:'HIGH', status:'pending', citizenName:'Mohammed Ali', citizenPhone:'+91 43210 98765', aiConfidence:0.89, detectedLanguage:'Hinglish', upvotes:18, channel:'chat', notes:'', officerName:'', sentiment:'neutral', keywords:'["pothole","accident"]', createdAt:new Date(now-3600000*6).toISOString(), updatedAt:new Date(now-3600000*6).toISOString() }
  ];
  const stmt = _db.prepare(`INSERT INTO complaints (id,ticketId,issueType,description,locationText,locationLat,locationLng,department,priority,status,citizenName,citizenPhone,aiConfidence,detectedLanguage,upvotes,channel,notes,officerName,sentiment,keywords,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of seeds) stmt.run([uuidv4(),s.ticketId,s.issueType,s.description,s.locationText,s.locationLat,s.locationLng,s.department,s.priority,s.status,s.citizenName,s.citizenPhone,s.aiConfidence,s.detectedLanguage,s.upvotes,s.channel,s.notes,s.officerName,s.sentiment,s.keywords,s.createdAt,s.updatedAt]);
  stmt.free();
  run(`INSERT INTO notifications (id,ticketId,message,type,isRead,createdAt) VALUES (?,?,?,?,?,?)`, [uuidv4(),'TKT-004','CRITICAL: Pipe burst at NH-8 - Emergency team deployed','critical',0,new Date().toISOString()]);
  run(`INSERT INTO notifications (id,ticketId,message,type,isRead,createdAt) VALUES (?,?,?,?,?,?)`, [uuidv4(),'TKT-003','Complaint TKT-003 resolved - Streetlight fixed','resolved',0,new Date(now-3600000*4).toISOString()]);
  run(`INSERT INTO notifications (id,ticketId,message,type,isRead,createdAt) VALUES (?,?,?,?,?,?)`, [uuidv4(),'TKT-001','Complaint TKT-001 is now In Progress - team dispatched','in_progress',1,new Date(now-3600000*3).toISOString()]);
  console.log('[DB] Seeded 6 complaints and 3 notifications');
  seedOfficers();
  persistToDisk();
}

function seedOfficers() {
  const count = exec('SELECT COUNT(*) FROM officers')[0]?.values[0][0] || 0;
  if (count > 0) return;
  const password = process.env.DEFAULT_OFFICER_PASSWORD || 'CivicAI@2024';
  run(`INSERT INTO officers (id,username,passwordHash,name,role,createdAt) VALUES (?,?,?,?,?,?)`,
    [uuidv4(),'officer',bcrypt.hashSync(password,12),'Municipal Officer','officer',new Date().toISOString()]);
  run(`INSERT INTO officers (id,username,passwordHash,name,role,createdAt) VALUES (?,?,?,?,?,?)`,
    [uuidv4(),'admin',bcrypt.hashSync('Admin@CivicAI2024',12),'System Administrator','admin',new Date().toISOString()]);
  console.log(`[DB] Officer accounts seeded: officer / ${password}, admin / Admin@CivicAI2024`);
}

function rowToComplaint(row, cols) {
  const o = {}; cols.forEach((c,i) => { o[c] = row[i]; });
  return { id:o.id, ticketId:o.ticketId, issueType:o.issueType, description:o.description,
    location:{text:o.locationText, lat:o.locationLat, lng:o.locationLng},
    department:o.department, priority:o.priority, status:o.status,
    citizenName:o.citizenName, citizenPhone:o.citizenPhone,
    aiConfidence:o.aiConfidence, detectedLanguage:o.detectedLanguage,
    upvotes:o.upvotes, channel:o.channel, notes:o.notes, officerName:o.officerName,
    sentiment:o.sentiment, keywords:JSON.parse(o.keywords||'[]'),
    timestamp:o.createdAt, updatedAt:o.updatedAt };
}

export function getAllComplaints(filters = {}) {
  let sql = 'SELECT * FROM complaints WHERE 1=1'; const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.priority) { sql += ' AND priority = ?'; params.push(filters.priority); }
  if (filters.department) { sql += ' AND department = ?'; params.push(filters.department); }
  if (filters.search) { const s = `%${filters.search}%`; sql += ' AND (description LIKE ? OR issueType LIKE ? OR ticketId LIKE ? OR locationText LIKE ?)'; params.push(s,s,s,s); }
  sql += ' ORDER BY createdAt DESC';
  const res = exec(sql, params);
  if (!res.length) return [];
  return res[0].values.map(row => rowToComplaint(row, res[0].columns));
}

export function getComplaintById(id) {
  if (!id) return null;
  const res = exec('SELECT * FROM complaints WHERE id = ? OR ticketId = ? LIMIT 1', [id, id.toUpperCase()]);
  if (!res.length || !res[0].values.length) return null;
  return rowToComplaint(res[0].values[0], res[0].columns);
}

export function addComplaint(data) {
  const id = uuidv4();
  const ticketId = `TKT-${String(ticketCounter++).padStart(3,'0')}`;
  const now = new Date().toISOString();
  run(`INSERT INTO complaints (id,ticketId,issueType,description,locationText,locationLat,locationLng,department,priority,status,citizenName,citizenPhone,aiConfidence,detectedLanguage,upvotes,channel,notes,officerName,sentiment,keywords,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,ticketId,data.issueType||'Other',data.description||'',data.location?.text||'Unknown',data.location?.lat||28.6139,data.location?.lng||77.2090,data.department||'General Administration',data.priority||'MEDIUM','pending',data.citizenName||'Anonymous',data.citizenPhone||'Not provided',data.aiConfidence||0,data.detectedLanguage||'English',0,data.channel||'manual','','',data.sentiment||'neutral',JSON.stringify(data.keywords||[]),now,now]);
  run(`INSERT INTO notifications (id,ticketId,message,type,isRead,createdAt) VALUES (?,?,?,?,?,?)`,
    [uuidv4(),ticketId,`Complaint ${ticketId} registered: ${data.issueType} - ${data.priority} priority`,'registered',0,now]);
  invalidateCache();
  return getComplaintById(id);
}

export function updateComplaint(id, updates) {
  const complaint = getComplaintById(id);
  if (!complaint) return null;
  const now = new Date().toISOString();
  const sets = []; const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.notes !== undefined) { sets.push('notes = ?'); params.push(updates.notes); }
  if (updates.officerName !== undefined) { sets.push('officerName = ?'); params.push(updates.officerName); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); params.push(updates.priority); }
  if (!sets.length) return complaint;
  sets.push('updatedAt = ?'); params.push(now, complaint.id);
  run(`UPDATE complaints SET ${sets.join(', ')} WHERE id = ?`, params);
  if (updates.status) {
    const msgs = { in_progress:`Complaint ${complaint.ticketId} is now In Progress - team is working on it.`, resolved:`Complaint ${complaint.ticketId} has been resolved. Thank you for helping improve our city.` };
    if (msgs[updates.status]) run(`INSERT INTO notifications (id,ticketId,message,type,isRead,createdAt) VALUES (?,?,?,?,?,?)`, [uuidv4(),complaint.ticketId,msgs[updates.status],updates.status,0,now]);
  }
  invalidateCache();
  return getComplaintById(complaint.id);
}

export function upvoteComplaint(id) {
  const complaint = getComplaintById(id);
  if (!complaint) return null;
  run('UPDATE complaints SET upvotes = upvotes + 1, updatedAt = ? WHERE id = ?', [new Date().toISOString(), complaint.id]);
  return getComplaintById(complaint.id);
}

export function runEscalationWorker() {
  const cutoff = new Date(Date.now() - 2*60*60*1000).toISOString();
  const res = exec(`SELECT id,ticketId FROM complaints WHERE status='pending' AND priority='CRITICAL' AND createdAt < ?`, [cutoff]);
  if (!res.length) return 0;
  let count = 0;
  for (const [id, ticketId] of res[0].values) {
    run(`UPDATE complaints SET status='in_progress', updatedAt=?, notes=? WHERE id=?`, [new Date().toISOString(),'Auto-escalated: CRITICAL complaint pending >2 hours',id]);
    run(`INSERT INTO notifications (id,ticketId,message,type,isRead,createdAt) VALUES (?,?,?,?,?,?)`, [uuidv4(),ticketId,`AUTO-ESCALATED: ${ticketId} - CRITICAL complaint unaddressed for 2+ hours`,'escalated',0,new Date().toISOString()]);
    count++;
  }
  if (count > 0) { console.log(`[Escalation] Auto-escalated ${count} CRITICAL complaint(s)`); invalidateCache(); }
  return count;
}

function invalidateCache() { run(`DELETE FROM analytics_cache WHERE key='main'`); }

export function getAnalytics() {
  const cached = exec(`SELECT value FROM analytics_cache WHERE key='main' AND expiresAt > ? LIMIT 1`, [new Date().toISOString()]);
  if (cached.length && cached[0].values.length) { try { return JSON.parse(cached[0].values[0][0]); } catch {} }

  const complaints = getAllComplaints();
  const total = complaints.length;

  // Single-pass aggregation — avoids 5 separate .filter() scans
  const deptCount = {}, typeCount = {}, priorityCount = {}, statusCount = {};
  let pending = 0, inProgress = 0, resolved = 0;
  let totalResolutionMs = 0, resolvedCount = 0;

  for (const c of complaints) {
    deptCount[c.department] = (deptCount[c.department] || 0) + 1;
    typeCount[c.issueType] = (typeCount[c.issueType] || 0) + 1;
    priorityCount[c.priority] = (priorityCount[c.priority] || 0) + 1;
    statusCount[c.status] = (statusCount[c.status] || 0) + 1;
    if (c.status === 'pending') pending++;
    else if (c.status === 'in_progress') inProgress++;
    else if (c.status === 'resolved') {
      resolved++;
      // Compute actual resolution time from timestamps
      const created = new Date(c.timestamp).getTime();
      const updated = new Date(c.updatedAt).getTime();
      if (created && updated && updated > created) {
        totalResolutionMs += (updated - created);
        resolvedCount++;
      }
    }
  }

  const byDepartment = Object.entries(deptCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const byType = Object.entries(typeCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const byPriority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    .map(name => ({ name, count: priorityCount[name] || 0 }))
    .filter(x => x.count > 0);
  const byStatus = ['pending', 'in_progress', 'resolved']
    .map(name => ({ name, count: statusCount[name] || 0 }));
  const hotspots = [...complaints].sort((a, b) => b.upvotes - a.upvotes).slice(0, 5)
    .map(c => ({ location: c.location.text, count: c.upvotes, type: c.issueType, priority: c.priority }));

  // Real computed metrics (not hardcoded placeholders)
  const avgResolutionHours = resolvedCount > 0
    ? Math.round((totalResolutionMs / resolvedCount / 3600000) * 10) / 10
    : null;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
  // AI confidence derived from stored aiConfidence field on actual complaints
  const avgAiConfidence = complaints.length > 0
    ? Math.round((complaints.reduce((sum, c) => sum + (c.aiConfidence || 0), 0) / complaints.length) * 100)
    : null;

  const analytics = {
    total, pending, inProgress, resolved,
    byDepartment, byType, byPriority, byStatus, hotspots,
    // Real computed values — null when insufficient data rather than fake numbers
    avgResolutionTime: avgResolutionHours,
    resolutionRate,
    aiAccuracy: avgAiConfidence,
    // citizenSatisfaction requires a real feedback mechanism — omit rather than fake
    recentComplaints: complaints.slice(0, 5)
  };

  run(`INSERT OR REPLACE INTO analytics_cache (key,value,expiresAt) VALUES (?,?,?)`,
    ['main', JSON.stringify(analytics), new Date(Date.now() + 30000).toISOString()]);
  return analytics;
}

export function getNotifications(limit = 30) {
  const res = exec('SELECT * FROM notifications ORDER BY createdAt DESC LIMIT ?', [limit]);
  if (!res.length) return [];
  return res[0].values.map(row => { const o = {}; res[0].columns.forEach((c,i)=>{ o[c]=row[i]; }); return {...o,read:o.isRead===1}; });
}

export function markNotificationRead(id) {
  const res = exec('SELECT * FROM notifications WHERE id = ? LIMIT 1', [id]);
  if (!res.length || !res[0].values.length) return null;
  run('UPDATE notifications SET isRead = 1 WHERE id = ?', [id]);
  const o = {}; res[0].columns.forEach((c,i)=>{ o[c]=res[0].values[0][i]; });
  return {...o, read:true};
}

export function findOfficerByUsername(username) {
  const res = exec('SELECT * FROM officers WHERE username = ? LIMIT 1', [username]);
  if (!res.length || !res[0].values.length) return null;
  const o = {}; res[0].columns.forEach((c,i)=>{ o[c]=res[0].values[0][i]; });
  return o;
}

// ============================================================
// PREDICTIVE URBAN INTELLIGENCE ENGINE
// Pure statistical analysis — no LLM required, always available.
// Produces ward-level predictions from complaint frequency trends,
// day-over-day velocity, and unresolved backlog pressure.
// ============================================================
export function getPredictions() {
  const complaints = getAllComplaints();
  if (complaints.length === 0) return { predictions: [], summary: null, generatedAt: new Date().toISOString() };

  const now = Date.now();
  const DAY_MS = 86_400_000;

  // ── 1. Bucket complaints into 7-day windows per (issueType × ward) ──────────
  // "Ward" is derived from the first segment of locationText, or a default bucket.
  function extractWard(locationText) {
    if (!locationText || locationText.trim() === '' || locationText === 'Location not specified') return 'Central Ward';
    const parts = locationText.split(/[,\/|]/);
    return parts[0].trim().replace(/^\d+\s*/, '').trim() || 'Central Ward';
  }

  // Collect complaint timestamps per (ward, issueType)
  const groups = {};
  for (const c of complaints) {
    const ward = extractWard(c.location?.text || c.locationText || '');
    const key = `${ward}||${c.issueType}`;
    if (!groups[key]) groups[key] = { ward, issueType: c.department || c.issueType, complaints: [] };
    groups[key].complaints.push({
      ts: new Date(c.createdAt || c.timestamp).getTime(),
      status: c.status,
      priority: c.priority
    });
  }

  // ── 2. Compute velocity and trend for each group ────────────────────────────
  const WINDOW_RECENT = 7 * DAY_MS;   // last 7 days
  const WINDOW_PRIOR  = 14 * DAY_MS;  // prior 7 days (days 8–14)

  const predictions = [];

  for (const { ward, issueType, complaints: cs } of Object.values(groups)) {
    const recent = cs.filter(c => now - c.ts <= WINDOW_RECENT).length;
    const prior  = cs.filter(c => now - c.ts > WINDOW_RECENT && now - c.ts <= WINDOW_PRIOR).length;
    const unresolved = cs.filter(c => c.status !== 'resolved').length;
    const criticalCount = cs.filter(c => c.priority === 'CRITICAL' || c.priority === 'HIGH').length;
    const total = cs.length;

    if (total < 2) continue; // need at least 2 data points

    // Velocity: week-over-week growth rate
    const velocity = prior > 0 ? (recent - prior) / prior : (recent > 0 ? 1 : 0);
    // Pressure score: combines velocity, unresolved backlog, and severity weight
    const severityWeight = criticalCount / total;
    const pressureScore = (velocity * 0.45) + (unresolved / Math.max(total, 1) * 0.35) + (severityWeight * 0.20);

    // Risk threshold: must be actively growing (velocity > 0.15) or heavy backlog
    if (pressureScore < 0.12 && velocity <= 0) continue;

    // ── Estimate days until likely overflow ──────────────────────────────────
    // Linear projection: if current week rate continues, how many days to reach
    // the historic peak for this ward+type? Conservative floor of 3, cap of 14.
    const dailyRate = recent / 7;
    const peakThreshold = Math.max(total * 0.35, recent + 2);
    const daysUntilPeak = dailyRate > 0
      ? Math.max(3, Math.min(14, Math.ceil((peakThreshold - recent) / dailyRate)))
      : 7;

    // ── Risk level ────────────────────────────────────────────────────────────
    let riskLevel, confidence;
    if (pressureScore >= 0.55 || velocity >= 0.8) {
      riskLevel = 'HIGH'; confidence = Math.min(0.92, 0.70 + pressureScore * 0.3);
    } else if (pressureScore >= 0.30 || velocity >= 0.4) {
      riskLevel = 'MEDIUM'; confidence = Math.min(0.82, 0.55 + pressureScore * 0.3);
    } else {
      riskLevel = 'LOW'; confidence = Math.min(0.72, 0.45 + pressureScore * 0.3);
    }

    // ── Human-readable prediction text ───────────────────────────────────────
    const trend = velocity >= 0.5 ? 'rapidly rising' : velocity >= 0.2 ? 'rising' : velocity >= 0 ? 'slowly rising' : 'stable but elevated';
    const action = riskLevel === 'HIGH'
      ? 'Immediate preventive inspection recommended.'
      : riskLevel === 'MEDIUM'
      ? 'Schedule inspection within 48 hours.'
      : 'Monitor closely — flag for next patrol.';

    predictions.push({
      id: `pred-${ward}-${issueType}`.replace(/\s+/g, '-').toLowerCase(),
      ward,
      issueType,
      riskLevel,
      daysUntilLikely: daysUntilPeak,
      confidence: Math.round(confidence * 100),
      recentCount: recent,
      priorCount: prior,
      unresolvedCount: unresolved,
      velocityPct: Math.round(velocity * 100),
      predictionText: `${issueType} likely in ${ward} within ${daysUntilPeak} day${daysUntilPeak === 1 ? '' : 's'} based on ${trend} complaint frequency.`,
      basisText: `${recent} complaints in last 7 days (${prior > 0 ? `${velocity >= 0 ? '+' : ''}${Math.round(velocity * 100)}% vs prior week` : 'new activity'}), ${unresolved} unresolved.`,
      recommendedAction: action,
      generatedAt: new Date().toISOString()
    });
  }

  // Sort: HIGH first, then by days ascending, then confidence descending
  predictions.sort((a, b) => {
    const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (a.daysUntilLikely !== b.daysUntilLikely) return a.daysUntilLikely - b.daysUntilLikely;
    return b.confidence - a.confidence;
  });

  // ── Summary stats ──────────────────────────────────────────────────────────
  const high = predictions.filter(p => p.riskLevel === 'HIGH').length;
  const medium = predictions.filter(p => p.riskLevel === 'MEDIUM').length;
  const wardsAtRisk = [...new Set(predictions.map(p => p.ward))].length;
  const topPrediction = predictions[0] || null;

  return {
    predictions: predictions.slice(0, 12), // cap at 12 for UI
    summary: {
      totalPredictions: predictions.length,
      highRisk: high,
      mediumRisk: medium,
      wardsAtRisk,
      topWard: topPrediction?.ward || null,
      topIssue: topPrediction?.issueType || null,
      analysedComplaints: complaints.length
    },
    generatedAt: new Date().toISOString()
  };
}

export function getDbStats() {
  return {
    complaints: exec('SELECT COUNT(*) FROM complaints')[0]?.values[0][0] || 0,
    notifications: exec('SELECT COUNT(*) FROM notifications')[0]?.values[0][0] || 0,
    officers: exec('SELECT COUNT(*) FROM officers')[0]?.values[0][0] || 0
  };
}
