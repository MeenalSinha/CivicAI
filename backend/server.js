// ============================================================
// CivicAI Backend Server — Production Grade
// Express REST API + WebSocket + JWT Auth + SQLite + Worker
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import {
  initDatabase,
  getAllComplaints,
  getComplaintById,
  addComplaint,
  updateComplaint,
  upvoteComplaint,
  runEscalationWorker,
  getAnalytics,
  getPredictions,
  getNotifications,
  markNotificationRead,
  findOfficerByUsername,
  getDbStats
} from './database/db.js';

import {
  processComplaint,
  chatResponse,
  detectImageIssue,
  generateInsights,
  generatePredictionNarratives,
  transcribeVoice
} from './ai/aiService.js';

import { initDevSchema, addFeedback, audit } from './database/devdb.js';
import * as devdb from './database/devdb.js';
import { ingestRequest, IntakeError, syncUpvote, backfillLegacyComplaints } from './intelligence/intake.js';
import { onPipelineComplete } from './intelligence/pipeline.js';
import { ensureDemoData } from './demo/loadDemo.js';
import { loadStructuralDataForInstance, insertBrazilSyntheticRequests, getInstanceRegistry } from './demo/multiInstanceDemo.js';
import { createPolicyRouter, demoMode } from './routes/policy.js';
import { normalizeChannelPayload } from './routes/channels.js';
import { normalizeChannelPayloadEnhanced, verifyWhatsappSignature, verifyTelegramSignature, verifyTwilioSignature, verifySharedSecret, handleMediaAttachment, sendChannelReply, buildOutboundReply, auditMessagingEvent, checkTimestamp } from './routes/messagingSecurity.js';
import { getInstance, setInstance, loadInstanceById } from './intelligence/config.js';
import { timingSafeEqual } from 'crypto';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'civicai-jwt-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// Default city center coordinates — set DEFAULT_LAT / DEFAULT_LNG in .env for your deployment city.
// These are used when a complaint does not include GPS coordinates.
// Delhi defaults: 28.6139, 77.2090 | Bengaluru: 12.9716, 77.5946
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT) || 28.6139;
const DEFAULT_LNG = parseFloat(process.env.DEFAULT_LNG) || 77.2090;
const COORD_SPREAD = parseFloat(process.env.COORD_SPREAD) || 0.06; // ~3km radius jitter

/** Return approximate coords near the city center when no GPS is provided */
function approximateCoords() {
  return {
    lat: DEFAULT_LAT + (Math.random() - 0.5) * COORD_SPREAD,
    lng: DEFAULT_LNG + (Math.random() - 0.5) * COORD_SPREAD,
  };
}

// ---- Sanitize input ----
function sanitize(text, maxLen = 2000) {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, maxLen).replace(/<[^>]*>/g, '');
}

const app = express();

// ---- Security ----
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.disable('x-powered-by');

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ---- Rate Limiting ----
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'AI rate limit reached. Please wait a moment.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

app.use('/api', globalLimiter);
app.use('/api/chat', aiLimiter);
app.use('/api/analyze-image', aiLimiter);
app.use('/api/voice-complaint', aiLimiter);
app.use('/api/transcribe-audio', aiLimiter);
app.use('/api/auth/login', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---- Request Logger ----
app.use((req, _res, next) => {
  if (req.path !== '/api/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ---- JWT Auth Middleware ----
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  const token = authHeader.slice(7);
  try {
    req.officer = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.officer?.role)
    ? next()
    : res.status(403).json({ error: `Your role (${req.officer?.role || 'none'}) cannot access this resource.` });
}

/** Number or null (rejects NaN / out-of-range so bad GPS never reaches the engines). */
function parseCoord(v, max) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
/** Stable, non-reversible submitter key: browser clientId, else phone, else IP. Hashed inside the intelligence layer. */
function submitterKeyFor(req, phone) {
  const cid = req.body?.clientId;
  if (typeof cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(cid)) return `client:${cid}`;
  if (phone && phone !== 'Not provided') return `phone:${phone}`;
  return `ip:${req.ip}`;
}

/** Shared citizen-intake path: legacy complaint + normalised anonymised request + audit + realtime events. */
async function submitCitizenRequest(req, res, o) {
  try {
    const lat = parseCoord(req.body?.lat, 90), lng = parseCoord(req.body?.lng, 180);
    const result = await ingestRequest({
      text: o.text, channel: o.channel, legacyChannel: o.legacyChannel, legacy: o.processed,
      lat: lat != null && lng != null ? lat : null, lng: lat != null && lng != null ? lng : null,
      locationText: o.location || undefined, citizenName: o.citizenName, citizenPhone: o.citizenPhone,
      submitterKey: submitterKeyFor(req, o.citizenPhone), imageEvidence: o.imageEvidence,
      ...(() => { const a = approximateCoords(); return { fallbackLat: a.lat, fallbackLng: a.lng }; })()
    });
    if (result.duplicate) return { duplicate: true, ...result };
    if (result.complaint) broadcast('new_complaint', result.complaint);
    return result;
  } catch (e) {
    if (e instanceof IntakeError) { res.status(e.status).json({ error: e.message, code: e.code }); return null; }
    throw e;
  }
}

// ---- HTTP + WebSocket ----
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  try {
    ws.send(JSON.stringify({
      event: 'connected',
      data: { message: 'Connected to CivicAI real-time feed' },
      timestamp: new Date().toISOString()
    }));
  } catch {}
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  wsClients.forEach(client => {
    if (client.readyState === 1) { try { client.send(payload); } catch {} }
  });
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (_req, res) => {
  const stats = getDbStats();
  const inst = getInstance();
  res.json({
    status: 'ok', version: '4.0.0', instance: inst.id, demoMode: demoMode(),
    db: 'sqlite-persistent',
    ...stats,
    wsClients: wsClients.size,
    aiServiceUrl: process.env.AI_SERVICE_URL || 'http://ai-service:8000',
    anthropicFallback: !!process.env.ANTHROPIC_API_KEY,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    // BRICS interoperability info
    countryInstances: getInstanceRegistry().map(i => ({ id: i.id, country: i.countryName, status: i.status }))
  });
});

// ============================================================
// BRICS / COUNTRY INTEROPERABILITY API
// ============================================================

/** Public: list all available country demo instances */
app.get('/api/brics/instances', (_req, res) => {
  res.json({ success: true, instances: getInstanceRegistry(), activeInstance: getInstance().id });
});

/** Judge/Demo: switch active instance and get a summary of the new context */
app.post('/api/brics/switch', async (req, res) => {
  if (!demoMode()) return res.status(403).json({ error: 'Instance switching is only available in demo mode (DEMO_MODE=true).' });
  const id = sanitize(String(req.body?.instanceId || ''), 40);
  const registry = getInstanceRegistry();
  if (!registry.find(r => r.id === id)) {
    return res.status(400).json({ error: `Unknown instance "${id}". Available: ${registry.map(r => r.id).join(', ')}` });
  }
  try {
    const inst = setInstance(id);
    broadcast('instance_switched', { instanceId: id, country: inst.countryInfo.name });
    const overview = await import('./intelligence/views.js').then(m => m.getOverview());
    res.json({ success: true, instance: { id: inst.id, name: inst.name, country: inst.countryInfo.name, currency: inst.countryInfo.currency, adminLevels: inst.adminLevels, languages: inst.languages, mapCenter: inst.mapCenter, dataLabel: inst.dataLabel, engineNote: registry.find(r => r.id === id)?.engineNote }, overview });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Public: BRICS interoperability summary (all instances, shared engine claim) */
app.get('/api/brics/summary', (_req, res) => {
  const regions = devdb.getRegions();
  const requests = devdb.getRequests();
  const investments = devdb.getInvestments();
  const sources = devdb.listDataSources();
  const registry = getInstanceRegistry();

  const summary = registry.map(inst => {
    const instRegions = regions.filter(r => r.countryCode === inst.country);
    const instRequests = requests.filter(r => {
      const region = instRegions.find(reg => reg.id === r.regionId);
      return !!region;
    });
    const instInvestments = investments.filter(i => {
      return (i.regionIds || []).some(rid => instRegions.find(r => r.id === rid));
    });
    const instSources = sources.filter(s => s.id.startsWith(inst.id));
    return {
      instanceId: inst.id,
      country: inst.countryName,
      countryCode: inst.country,
      scope: inst.scope,
      languages: inst.languages,
      currency: inst.currency,
      adminLevels: inst.adminLevels,
      population: instRegions.reduce((s, r) => s + (r.population || 0), 0),
      regions: instRegions.length,
      citizenRequests: instRequests.length,
      mappedInvestments: instInvestments.length,
      dataSources: instSources.length,
      dataLabel: inst.dataLabel,
      engineNote: inst.engineNote,
      status: inst.status
    };
  });

  res.json({
    success: true,
    architecture: 'Shared CivicAI Intelligence Engine',
    architectureNote: 'One engine. Country-specific configuration, data adapters, language, hierarchy and taxonomy. No engine code changes between countries.',
    interoperabilityStatus: 'Interoperability-ready architecture — standardized data interfaces for cross-country deployment.',
    instances: summary,
    sharedComponents: ['ingestion_pipeline', 'normalization_layer', 'ai_classification', 'demand_aggregation', 'infrastructure_gap_engine', 'investment_alignment', 'prioritization', 'policy_query', 'visualization_layer'],
    countrySpecificComponents: ['country_configuration', 'data_adapters', 'localization', 'administrative_hierarchy', 'department_taxonomy', 'geographic_data', 'currency_formatting']
  });
});

// ============================================================
// AUTH ROUTES
// ============================================================

app.post('/api/auth/login', async (req, res) => {
  const username = sanitize(req.body.username || '', 50).toLowerCase();
  const password = sanitize(req.body.password || '', 100);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const officer = findOfficerByUsername(username);
  if (!officer) {
    // Constant-time delay even for unknown users to prevent user enumeration
    await bcrypt.compare(password, '$2a$12$invalidhashpaddingtomatchcost00000000000000000000000000');
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(password, officer.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = jwt.sign(
    { id: officer.id, username: officer.username, name: officer.name, role: officer.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  res.json({
    success: true,
    token,
    officer: { id: officer.id, username: officer.username, name: officer.name, role: officer.role },
    expiresIn: JWT_EXPIRES
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, officer: req.officer });
});

// ============================================================
// CITIZEN ROUTES
// ============================================================

app.post('/api/chat', async (req, res) => {
  const message = sanitize(req.body.message || '', 1000);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-10) : [];
  // Sanitize and validate sessionId — must be a short alphanumeric string or null
  const rawSession = req.body.sessionId;
  const sessionId = (typeof rawSession === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawSession))
    ? rawSession : null;

  if (!message) return res.status(400).json({ error: 'Message is required.' });

  try {
    const complaintKeywords = /pothole|garbage|light|water|leakage|broken|damaged|road|sewage|pipe|overflow|flood|gadda|kachra|paani|bijli|nali|naali/i;
    const isComplaint = complaintKeywords.test(message) && message.length > 10;

    const reply = await chatResponse(message, history);
    let complaint = null;

    let request = null;
    if (isComplaint) {
      const processed = await processComplaint(message);
      const r = await submitCitizenRequest(req, res, { text: message, channel: 'chat', legacyChannel: 'chat', processed, citizenName: 'Chat User', citizenPhone: 'Not provided' });
      if (r === null) return;
      complaint = r.complaint; request = r.request || null;
      if (r.duplicate) return res.json({ success: true, reply, complaint, duplicate: true, sessionId: sessionId || uuidv4(), note: r.reason });
    }

    res.json({ success: true, reply, complaint, request: publicRequest(request), sessionId: sessionId || uuidv4() });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({
      error: 'AI processing failed',
      reply: 'I am unable to process your request at the moment. Please try the direct complaint form.',
      complaint: null
    });
  }
});

app.post('/api/complaints', async (req, res) => {
  const text = sanitize(req.body.text || '', 2000);
  const location = sanitize(req.body.location || '', 300);
  const citizenName = sanitize(req.body.citizenName || 'Anonymous Citizen', 100);
  const citizenPhone = sanitize(req.body.citizenPhone || 'Not provided', 20);

  if (!text) return res.status(400).json({ error: 'Complaint text is required.' });

  try {
    const processed = await processComplaint(text);
    const r = await submitCitizenRequest(req, res, { text, channel: 'text', legacyChannel: 'manual', processed, location, citizenName, citizenPhone });
    if (r === null) return;
    if (r.duplicate) return res.status(200).json({ success: true, duplicate: true, complaint: r.complaint, message: 'This looks like a repeat of a request you already submitted, so it was linked to the existing ticket instead of counted again.' });
    const newComplaint = r.complaint;
    res.status(201).json({ success: true, complaint: newComplaint, request: publicRequest(r.request), message: `Complaint ${newComplaint.ticketId} registered successfully` });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Failed to process complaint. Please try again.' });
  }
});

app.get('/api/complaints/:id', (req, res) => {
  const id = sanitize(req.params.id, 50);
  if (!id || id.length > 50) return res.status(400).json({ error: 'Invalid complaint ID.' });
  const complaint = getComplaintById(id);
  if (!complaint) return res.status(404).json({ error: `Complaint ${id} not found. Please check your ticket ID.` });
  res.json(complaint);
});

app.post('/api/complaints/:id/upvote', (req, res) => {
  const id = sanitize(req.params.id, 50);
  const updated = upvoteComplaint(id);
  if (!updated) return res.status(404).json({ error: `Complaint ${id} not found.` });
  syncUpvote(updated);
  broadcast('complaint_updated', { id: updated.id, ticketId: updated.ticketId, upvotes: updated.upvotes });
  res.json({ success: true, upvotes: updated.upvotes });
});

app.post('/api/analyze-image', async (req, res) => {
  const { image, location, citizenName } = req.body;
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'Image data is required.' });
  const mimeMatch = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,/);
  if (!mimeMatch) return res.status(400).json({ error: 'Invalid image format. Supported: JPEG, PNG, WebP, GIF.' });
  if (image.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image too large. Maximum 6MB.' });

  try {
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = mimeMatch[1];
    const visionResult = await detectImageIssue(base64, mimeType);
    const { fromLegacyIssueType } = await import('./intelligence/taxonomy.js');
    const m = fromLegacyIssueType(visionResult.issueType);
    const processedLike = { issueType: visionResult.issueType, department: null, priority: visionResult.priority, aiConfidence: visionResult.confidence, detectedLanguage: 'Image', keywords: [visionResult.issueType.toLowerCase()], sentiment: 'neutral', model: visionResult.model };
    const r = await submitCitizenRequest(req, res, {
      text: visionResult.description, channel: 'image', legacyChannel: 'image', processed: processedLike, location: sanitize(location || '', 300),
      citizenName: sanitize(citizenName || 'Anonymous Citizen', 100), citizenPhone: 'Not provided',
      imageEvidence: { detected: true, label: visionResult.issueType, category: m.category, subcategory: m.subcategory, confidence: visionResult.confidence, model: visionResult.model || 'vision' }
    });
    if (r === null) return;
    if (r.duplicate) return res.status(200).json({ success: true, duplicate: true, vision: visionResult, complaint: r.complaint, message: 'Similar image report already recorded; linked to the existing ticket.' });
    const newComplaint = r.complaint;
    res.status(201).json({ success: true, vision: visionResult, complaint: newComplaint, request: publicRequest(r.request), message: `Image analyzed. Complaint ${newComplaint.ticketId} registered.` });
  } catch (err) {
    console.error('Image error:', err);
    res.status(500).json({ error: 'Image analysis failed. Please try again.' });
  }
});

app.post('/api/voice-complaint', async (req, res) => {
  const transcript = sanitize(req.body.transcript || '', 2000);
  const location = sanitize(req.body.location || '', 300);
  const citizenName = sanitize(req.body.citizenName || 'Voice Citizen', 100);
  if (!transcript) return res.status(400).json({ error: 'Voice transcript is required.' });

  try {
    const processed = await processComplaint(transcript);
    const r = await submitCitizenRequest(req, res, { text: transcript, channel: 'voice', legacyChannel: 'voice', processed, location, citizenName, citizenPhone: 'Not provided' });
    if (r === null) return;
    if (r.duplicate) return res.status(200).json({ success: true, duplicate: true, complaint: r.complaint, message: 'Repeat voice request linked to your existing ticket.' });
    const newComplaint = r.complaint;
    res.status(201).json({ success: true, complaint: newComplaint, request: publicRequest(r.request), message: `Voice complaint ${newComplaint.ticketId} registered successfully` });
  } catch (err) {
    console.error('Voice error:', err);
    res.status(500).json({ error: 'Failed to process voice complaint.' });
  }
});

// Raw audio → Whisper transcription → complaint classification (uses ai-service Whisper model)
app.post('/api/transcribe-audio', async (req, res) => {
  const { audio, mimeType, location, citizenName } = req.body;
  if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'Base64 audio data is required.' });

  try {
    const audioBase64 = audio.replace(/^data:[^;]+;base64,/, '');
    const mime = mimeType || 'audio/wav';

    const transcription = await transcribeVoice(audioBase64, mime);
    const transcript = transcription.transcript;
    const detectedLang = transcription.language || 'unknown';

    const processed = await processComplaint(transcript);
    const r = await submitCitizenRequest(req, res, { text: transcript, channel: 'voice', legacyChannel: 'voice', processed: { ...processed, detectedLanguage: processed.detectedLanguage || detectedLang }, location: sanitize(location || '', 300), citizenName: sanitize(citizenName || 'Voice Citizen', 100), citizenPhone: 'Not provided' });
    if (r === null) return;
    if (r.duplicate) return res.status(200).json({ success: true, duplicate: true, transcript, complaint: r.complaint, message: 'Repeat voice request linked to your existing ticket.' });
    const newComplaint = r.complaint;
    res.status(201).json({
      success: true,
      transcript,
      detectedLanguage: detectedLang,
      complaint: newComplaint,
      request: publicRequest(r.request),
      message: `Audio transcribed and complaint ${newComplaint.ticketId} registered successfully`
    });
  } catch (err) {
    console.error('Transcribe-audio error:', err);
    // Do not leak internal error details (model paths, stack traces) to clients
    const isWhisperUnavailable = err.message && err.message.includes('PRELOAD_WHISPER');
    res.status(isWhisperUnavailable ? 503 : 500).json({
      error: isWhisperUnavailable
        ? 'Voice transcription service is not enabled. Please use the text voice complaint form instead.'
        : 'Audio transcription failed. Please try again or use the text form.'
    });
  }
});

/** Citizen-facing view of the normalised request: no identifiers, no internal traces. */
function publicRequest(r) {
  if (!r) return null;
  return {
    id: r.id, category: r.category, categoryLabel: r.categoryLabel, subcategory: r.subcategory, subcategoryLabel: r.subcategoryLabel,
    language: r.language, languageName: r.languageName, urgencyBand: r.urgencyBand, confidence: r.confidence,
    regionName: r.regionName, locationSource: r.locationSource, channel: r.channel, affectedInfrastructure: r.affectedInfrastructure
  };
}

// Citizen feedback closes the loop (outcome measurement)
app.post('/api/complaints/:id/feedback', (req, res) => {
  const id = sanitize(req.params.id, 50);
  const complaint = getComplaintById(id);
  if (!complaint) return res.status(404).json({ error: `Complaint ${id} not found.` });
  if (complaint.status !== 'resolved') return res.status(409).json({ error: 'Feedback can be given once the complaint is marked resolved.' });
  const rating = parseInt(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  if (devdb.getFeedback().some(f => f.complaintId === complaint.id)) return res.status(409).json({ error: 'Feedback was already recorded for this complaint.' });
  addFeedback({ id: uuidv4(), complaintId: complaint.id, requestId: complaint.requestId, rating, comment: sanitize(req.body.comment || '', 300) });
  audit({ actorType: 'citizen', action: 'feedback.recorded', entityType: 'citizen_request', entityId: complaint.requestId, details: { rating } });
  res.status(201).json({ success: true, message: 'Thank you - your feedback helps measure outcomes.' });
});

// Messaging-channel webhooks (WhatsApp Cloud / Telegram / SMS / generic).
// Provider-specific signature verification + media pipeline + outbound reply + audit trail.
app.post('/api/channels/:channel/webhook', async (req, res) => {
  const channel = req.params.channel;
  const rawBody = JSON.stringify(req.body); // for HMAC computation
  let sigCheck = { ok: false, reason: 'No verification method matched' };

  // --- Provider-specific signature verification ---
  // Guard: if neither provider credentials nor shared secret are configured, webhooks are disabled.
  const hasAnyCredential = process.env.CHANNEL_WEBHOOK_SECRET || process.env.WHATSAPP_APP_SECRET || process.env.TELEGRAM_SECRET_TOKEN || process.env.TWILIO_AUTH_TOKEN;
  if (!hasAnyCredential) {
    return res.status(503).json({ error: 'Messaging webhooks are disabled (no webhook credentials configured).' });
  }

  if (channel === 'whatsapp-cloud') {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    sigCheck = appSecret
      ? verifyWhatsappSignature(rawBody, req.headers['x-hub-signature-256'], appSecret)
      : verifySharedSecret(req.headers['x-channel-secret'], process.env.CHANNEL_WEBHOOK_SECRET);
  } else if (channel === 'telegram') {
    sigCheck = verifyTelegramSignature(req.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_SECRET_TOKEN);
    // Fallback to shared secret if telegram token not configured
    if (!sigCheck.ok && !process.env.TELEGRAM_SECRET_TOKEN) {
      sigCheck = verifySharedSecret(req.headers['x-channel-secret'], process.env.CHANNEL_WEBHOOK_SECRET);
    }
  } else if (channel === 'sms') {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    sigCheck = process.env.TWILIO_AUTH_TOKEN
      ? verifyTwilioSignature(fullUrl, req.body, req.headers['x-twilio-signature'], process.env.TWILIO_AUTH_TOKEN)
      : verifySharedSecret(req.headers['x-channel-secret'], process.env.CHANNEL_WEBHOOK_SECRET);
  } else {
    // Generic/custom channels: require shared secret
    const secret = process.env.CHANNEL_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Messaging webhooks are disabled (CHANNEL_WEBHOOK_SECRET not set).' });
    sigCheck = verifySharedSecret(req.headers['x-channel-secret'], secret);
  }

  if (!sigCheck.ok) {
    console.warn(`[Webhook][${channel}] Signature rejected: ${sigCheck.reason}`);
    auditMessagingEvent({ channel, processingStatus: 'signature_rejected', errorDetails: sigCheck.reason });
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  // --- Replay protection ---
  const ts = req.headers['x-timestamp'] || req.body?.timestamp || req.body?.entry?.[0]?.time;
  const replayCheck = checkTimestamp(ts);
  if (!replayCheck.ok) {
    auditMessagingEvent({ channel, processingStatus: 'replay_rejected', errorDetails: replayCheck.reason });
    return res.status(400).json({ error: replayCheck.reason });
  }

  // --- Normalize payload (enhanced, with media detection) ---
  const msg = normalizeChannelPayloadEnhanced(channel, req.body);
  if (msg === undefined) return res.status(404).json({ error: `Unknown channel "${channel}".` });

  // --- Handle media attachments ---
  let mediaResult = null;
  if (msg?.media) {
    mediaResult = await handleMediaAttachment({ ...msg.media, channel, requestId: null });
    console.log(`[Webhook][${channel}] Media: ${JSON.stringify(mediaResult)}`);
  }

  if (!msg || !msg.text) {
    // Non-text with media-only payload: acknowledge without processing
    return res.status(200).json({ success: true, ignored: true, reason: 'No text content to process.', mediaHandled: !!mediaResult });
  }

  let result = null;
  try {
    const text = sanitize(String(msg.text), 2000);
    const processed = await processComplaint(text);
    const lat = parseCoord(msg.lat, 90), lng = parseCoord(msg.lng, 180);
    result = await ingestRequest({
      text, channel: 'messaging', legacyChannel: 'chat', legacy: processed,
      lat: lat != null && lng != null ? lat : null, lng: lat != null && lng != null ? lng : null,
      submitterKey: `${channel}:${msg.from}`, citizenName: 'Messaging User', citizenPhone: 'Not provided',
      language: msg.language,
      ...(() => { const a = approximateCoords(); return { fallbackLat: a.lat, fallbackLng: a.lng }; })()
    });

    if (result.complaint) broadcast('new_complaint', result.complaint);

    // --- Outbound reply ---
    const inst = getInstance();
    const lang = result.request?.language || inst.languages?.[0] || 'en';
    const dept = inst.departments?.[result.request?.category] || 'relevant department';
    const replyMsg = buildOutboundReply({
      templateKey: result.duplicate ? 'grouped' : 'received',
      language: lang,
      args: result.duplicate ? [1] : [result.complaint?.ticketId || result.request?.id || '—'],
      requestId: result.request?.id,
      ticketId: result.complaint?.ticketId
    });
    const replySent = await sendChannelReply({ channel, to: msg.from, message: replyMsg.text, language: lang });

    // --- Audit trail ---
    auditMessagingEvent({
      channel, inboundMessageId: msg.messageId || null,
      requestId: result.request?.id, ticketId: result.complaint?.ticketId,
      processingStatus: result.duplicate ? 'duplicate' : 'accepted',
      mediaStatus: mediaResult?.status || null,
      replyStatus: replySent?.sent ? 'sent' : (replySent?.mode === 'demo' ? 'demo_mode' : 'failed'),
      errorDetails: replySent?.error || null
    });

    res.status(result.duplicate ? 200 : 201).json({
      success: true, duplicate: !!result.duplicate, ticketId: result.complaint?.ticketId,
      request: publicRequest(result.request), reply: replySent
    });
  } catch (e) {
    auditMessagingEvent({ channel, processingStatus: 'error', errorDetails: e.message });
    if (e instanceof IntakeError) return res.status(e.status).json({ error: e.message });
    console.error('Channel webhook error:', e);
    res.status(500).json({ error: 'Failed to process message.' });
  }
});

// Policy intelligence, Judge Mode
app.use('/api', createPolicyRouter({ requireAuth, broadcast, sanitize, jwtSecret: JWT_SECRET, jwtExpires: JWT_EXPIRES }));

// ============================================================
// OFFICER ROUTES — JWT Protected
// ============================================================

app.get('/api/officer/complaints', requireAuth, requireRole('officer', 'admin'), (req, res) => {
  const { status, priority, department, search, page = 1, limit = 50 } = req.query;
  const filtered = getAllComplaints({ status, priority, department, search });
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const start = (pageNum - 1) * limitNum;
  res.json({
    success: true,
    complaints: filtered.slice(start, start + limitNum),
    total: filtered.length,
    page: pageNum,
    totalPages: Math.ceil(filtered.length / limitNum)
  });
});

app.patch('/api/officer/complaints/:id', requireAuth, requireRole('officer', 'admin'), (req, res) => {
  const id = sanitize(req.params.id, 50);
  const { status, notes, officerName, priority } = req.body;

  const validStatuses = ['pending', 'in_progress', 'resolved'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }
  const validPriorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  if (priority && !validPriorities.includes(priority)) {
    return res.status(400).json({ error: `Invalid priority.` });
  }

  const updates = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = sanitize(String(notes), 1000);
  if (officerName) updates.officerName = sanitize(String(officerName || req.officer.name), 100);
  if (priority) updates.priority = priority;

  const updated = updateComplaint(id, updates);
  if (!updated) return res.status(404).json({ error: `Complaint ${id} not found.` });

  broadcast('complaint_updated', updated);
  res.json({ success: true, complaint: updated, message: `Complaint ${updated.ticketId} updated` });
});

app.get('/api/officer/analytics', requireAuth, (_req, res) => {
  res.json({ success: true, ...getAnalytics() });
});

app.get('/api/officer/insights', requireAuth, async (_req, res) => {
  try {
    const analytics = getAnalytics();
    const insights = await generateInsights(analytics.recentComplaints);
    res.json({ success: true, ...insights });
  } catch (err) {
    console.error('Insights error:', err);
    res.status(500).json({ error: 'Failed to generate insights.' });
  }
});

app.get('/api/officer/predictions', requireAuth, async (_req, res) => {
  try {
    const statistical = getPredictions();

    if (!statistical.predictions || statistical.predictions.length === 0) {
      return res.json({ success: true, ...statistical });
    }

    // Enrich statistical predictions with Mistral-narrated intelligence briefings.
    // Falls back to pre-computed predictionText if the model is unavailable.
    const { enriched, headline, model } = await generatePredictionNarratives(
      statistical.predictions,
      statistical.summary
    );

    res.json({
      success: true,
      predictions: enriched,
      summary: statistical.summary,
      headline,
      narrativeModel: model,
      generatedAt: statistical.generatedAt,
    });
  } catch (err) {
    console.error('Predictions error:', err);
    res.status(500).json({ error: 'Failed to generate predictions.' });
  }
});

app.get('/api/map/complaints', (_req, res) => {
  const complaints = getAllComplaints();
  res.json({
    success: true,
    complaints: complaints.map(c => ({
      id: c.id, ticketId: c.ticketId, issueType: c.issueType,
      priority: c.priority, status: c.status, location: c.location
    }))
  });
});

// ============================================================
// NOTIFICATIONS
// ============================================================
app.get('/api/notifications', (_req, res) => {
  const notifications = getNotifications(30);
  res.json({ success: true, notifications, unreadCount: notifications.filter(n => !n.read).length });
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const notification = markNotificationRead(req.params.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ success: true, notification });
});

app.post('/api/notifications/read-all', (_req, res) => {
  const notifications = getNotifications(100);
  notifications.forEach(n => { if (!n.read) markNotificationRead(n.id); });
  res.json({ success: true, message: 'All notifications marked as read.' });
});

// ============================================================
// 404 + Error handlers
// ============================================================
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Client-side problems (malformed JSON, oversized body) are 4xx, not server faults
  if (err && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Request body too large.' : 'Malformed request.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// BOOT
// ============================================================
const PORT = parseInt(process.env.PORT) || 3001;

async function boot() {
  try {
    await initDatabase();
    initDevSchema();
    if (String(process.env.LOAD_DEMO_DATA ?? 'true') === 'true') {
      try {
        // Load India demo (structural + synthetic)
        const r = await ensureDemoData();
        if (r.loaded) console.log(`[Demo] India: ${r.syntheticRequests} synthetic requests loaded; pipeline: ${r.pipeline.demands} demands, ${r.pipeline.projects} priorities`);

        // Load Brazil demo (structural + synthetic) — same pipeline, different instance
        try {
          const prevInst = getInstance().id;
          await loadStructuralDataForInstance('br-demo');
          setInstance('br-demo');
          const brInserted = insertBrazilSyntheticRequests();
          console.log(`[Demo] Brazil: ${brInserted} Portuguese synthetic requests loaded through shared pipeline`);
          setInstance(prevInst); // restore to default
        } catch (brErr) { console.error('[Demo] Brazil data failed (non-fatal):', brErr.message); }
      }
      catch (e) { console.error('[Demo] Failed to load demonstration data:', e.message); }
    }
    onPipelineComplete(run => broadcast('intelligence_updated', { stats: run.stats, trigger: run.trigger }));

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('============================================');
      console.log('  CivicAI Backend Server v4.0');
      console.log('============================================');
      console.log(`  REST API : http://localhost:${PORT}/api`);
      console.log(`  Health   : http://localhost:${PORT}/api/health`);
      console.log(`  WebSocket: ws://localhost:${PORT}`);
      console.log(`  Database : SQLite (persistent)`);
      console.log(`  Auth     : JWT (Bearer token)`);
      console.log(`  AI Mode  : ${process.env.AI_SERVICE_URL ? `Mistral AI Service (${process.env.AI_SERVICE_URL})` : 'http://ai-service:8000 (default)'}${process.env.ANTHROPIC_API_KEY ? ' + Anthropic fallback' : ''}`);
      console.log('============================================');
      console.log('');
    });

    // Escalation worker runs every 5 minutes
    setInterval(() => {
      const escalated = runEscalationWorker();
      if (escalated > 0) broadcast('escalation', { count: escalated, message: `${escalated} CRITICAL complaint(s) auto-escalated` });
    }, 5 * 60 * 1000);

    // Run once on startup to catch any missed escalations
    setTimeout(() => runEscalationWorker(), 5000);

  } catch (err) {
    console.error('FATAL: Failed to start server:', err);
    process.exit(1);
  }
}

boot();
export default app;
