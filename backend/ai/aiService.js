// ============================================================
// CivicAI - AI Processing Layer (v3 — Mistral-first)
//
// Architecture:
//   Primary:  Python FastAPI service (Mistral-7B + YOLOv8 + Whisper)
//   Fallback: Anthropic Claude API (if AI_SERVICE_URL not set)
//   Final:    Rule-based classifier (always available offline)
// ============================================================

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8000';
const AI_SERVICE_TIMEOUT = parseInt(process.env.AI_SERVICE_TIMEOUT) || 30000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';

// ============================================================
// HELPER — Call the Python AI Microservice
// ============================================================
async function callAIService(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT);
  try {
    const response = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.success ? (data.data || data) : null;
  } catch (err) {
    console.warn(`[AI] Service unavailable on ${endpoint}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropicLLM(systemPrompt, userMessage, maxTokens = 800) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.content[0].text;
  } catch (err) {
    console.error('[AI] Anthropic fallback error:', err.message);
    return null;
  }
}

function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// ============================================================
// COMPLAINT PROCESSING
// ============================================================
export async function processComplaint(text) {
  const result = await callAIService('/classify', { text });
  if (result && result.issueType && result.priority) {
    console.log(`[AI] Mistral classified: ${result.issueType} (${result.model || 'mistral-7b'})`);
    return result;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn('[AI] Mistral down — using Anthropic fallback');
    const raw = await callAnthropicLLM(COMPLAINT_SYSTEM_PROMPT, `Classify this complaint: "${text}"`, 600);
    const parsed = parseJSON(raw);
    if (parsed && parsed.issueType) { parsed.model = 'anthropic-fallback'; return parsed; }
  }
  return fallbackClassify(text);
}

// ============================================================
// CHAT RESPONSE
// ============================================================
export async function chatResponse(userMessage, conversationHistory = []) {
  const result = await callAIService('/chat', { message: userMessage, history: conversationHistory });
  if (result && result.reply) return result.reply;
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn('[AI] Mistral chat down — using Anthropic fallback');
    const messages = [
      ...conversationHistory.slice(-6).map(m => ({ role: m.role === 'bot' ? 'assistant' : m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];
    try {
      const r = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 300, system: CHAT_SYSTEM_PROMPT, messages }),
      });
      if (r.ok) { const d = await r.json(); return d.content[0].text; }
    } catch {}
  }
  return generateFallbackChatResponse(userMessage);
}

// ============================================================
// IMAGE ANALYSIS — YOLOv8
// ============================================================
export async function detectImageIssue(base64Image, mimeType = 'image/jpeg') {
  const result = await callAIService('/analyze-image', { image_base64: base64Image, mime_type: mimeType });
  if (result && result.issueType) { console.log(`[AI] YOLOv8 detected: ${result.issueType}`); return result; }
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn('[AI] YOLOv8 down — using Anthropic vision fallback');
    try {
      const r = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 400, system: IMAGE_SYSTEM_PROMPT, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } }, { type: 'text', text: 'Identify the civic issue.' }] }] }),
      });
      if (r.ok) { const d = await r.json(); const p = parseJSON(d.content[0].text); if (p) { p.model = 'anthropic-vision-fallback'; return p; } }
    } catch {}
  }
  return { detected: true, issueType: 'Damaged Infrastructure', confidence: 0.78, description: 'Civic infrastructure issue detected.', severity: 'moderate', priority: 'MEDIUM', model: 'fallback' };
}

// ============================================================
// VOICE TRANSCRIPTION — Whisper
// ============================================================
export async function transcribeVoice(audioBase64, mimeType = 'audio/wav') {
  const result = await callAIService('/transcribe', { audio_base64: audioBase64, mime_type: mimeType });
  if (result && result.transcript) return result;
  throw new Error('Voice transcription unavailable. Set PRELOAD_WHISPER=true in ai-service.');
}

// ============================================================
// INSIGHTS
// ============================================================
export async function generateInsights(complaints) {
  if (!complaints || complaints.length === 0) return getDefaultInsights();
  const result = await callAIService('/insights', { complaints: complaints.slice(0, 20) });
  if (result && result.topIssue) return result;
  if (process.env.ANTHROPIC_API_KEY) {
    const summary = complaints.slice(0, 20).map(c => `${c.issueType} | ${c.location?.text} | ${c.priority} | ${c.status} | upvotes:${c.upvotes}`).join('\n');
    const raw = await callAnthropicLLM(INSIGHTS_SYSTEM_PROMPT, `Analyze these ${complaints.length} complaints:\n${summary}`, 500);
    const parsed = parseJSON(raw);
    if (parsed && parsed.topIssue) { parsed.model = 'anthropic-fallback'; return parsed; }
  }
  return getDefaultInsights();
}

// Takes the statistical predictions from getPredictions() and asks Mistral
// to narrate each as a crisp actionable intelligence briefing.
// Falls back to the statistically-generated predictionText if the model is down.
export async function generatePredictionNarratives(predictions, summary) {
  if (!predictions || predictions.length === 0) {
    return { enriched: [], headline: null, model: 'none' };
  }

  // Try ai-service /predict endpoint first
  const result = await callAIService('/predict', { predictions, summary: summary || {} });
  if (result && Array.isArray(result.enriched) && result.enriched.length > 0) {
    return result;
  }

  // Anthropic fallback — ask Claude to narrate the top 6 predictions
  if (process.env.ANTHROPIC_API_KEY) {
    const lines = predictions.slice(0, 6).map((p, i) =>
      `${i + 1}. [${p.riskLevel}] ${p.issueType} in ${p.ward} — ` +
      `${p.daysUntilLikely}d, velocity ${p.velocityPct}%, ${p.unresolvedCount} unresolved`
    ).join('\n');
    const raw = await callAnthropicLLM(
      'You are a Predictive Urban Intelligence AI. For each statistical prediction, write one punchy sentence (max 20 words) a municipal officer can act on. Also write a single city-wide headline (max 15 words). Return ONLY JSON: {"briefings":["..."],"headline":"..."}',
      `Predictions:\n${lines}`,
      400
    );
    const parsed = parseJSON(raw);
    if (parsed && Array.isArray(parsed.briefings)) {
      return {
        enriched: predictions.map((p, i) => ({
          ...p,
          narrative: parsed.briefings[i]?.trim() || p.predictionText,
        })),
        headline: parsed.headline || null,
        model: 'anthropic-fallback',
      };
    }
  }

  // Pure statistical fallback — predictionText is already human-readable
  return {
    enriched: predictions.map(p => ({ ...p, narrative: p.predictionText })),
    headline: predictions.length > 0
      ? `${predictions[0].issueType} risk in ${predictions[0].ward} requires immediate attention.`
      : null,
    model: 'fallback',
  };
}

// ============================================================
// SYSTEM PROMPTS
// ============================================================
const COMPLAINT_SYSTEM_PROMPT = `You are CivicAI's complaint classification engine for Indian municipal governance.
Return ONLY valid JSON, no markdown:
{"issueType":"Pothole","description":"...","location":"...","priority":"HIGH","department":"Road Maintenance","urgency":"high","detectedLanguage":"English","aiConfidence":0.90,"sentiment":"neutral","keywords":[],"suggestedResponse":"..."}
Valid issueType: "Pothole","Garbage Overflow","Broken Streetlight","Water Leakage","Damaged Infrastructure","Other"
Valid priority: "CRITICAL","HIGH","MEDIUM","LOW"
Valid department: "Road Maintenance","Sanitation","Water Supply","Electrical Department","General Administration"`;

const CHAT_SYSTEM_PROMPT = `You are CivicAI Assistant, a helpful municipal support AI for Indian cities. Help citizens report civic problems. Be conversational, empathetic, concise (2-3 sentences). Support English, Hindi, and Hinglish. No emojis.`;

const IMAGE_SYSTEM_PROMPT = `You are a computer vision AI for civic infrastructure analysis. Return ONLY valid JSON:
{"detected":true,"issueType":"Pothole","confidence":0.90,"description":"...","severity":"moderate","priority":"HIGH"}`;

const INSIGHTS_SYSTEM_PROMPT = `You are a municipal data analyst AI. Return ONLY valid JSON:
{"topIssue":"...","criticalHotspot":"...","recommendation":"...","trend":"...","departmentAlert":"...","predictedIssues":"..."}`;

// ============================================================
// FALLBACK CLASSIFIER
// ============================================================
function fallbackClassify(text) {
  const lower = text.toLowerCase();
  let issueType = 'Other', department = 'General Administration', priority = 'MEDIUM', keywords = [];
  if (lower.includes('pothole') || lower.includes('gadda') || lower.includes('road damage')) { issueType = 'Pothole'; department = 'Road Maintenance'; priority = 'HIGH'; keywords = ['pothole', 'road']; }
  else if (lower.includes('garbage') || lower.includes('kachra') || lower.includes('waste') || lower.includes('trash')) { issueType = 'Garbage Overflow'; department = 'Sanitation'; priority = 'HIGH'; keywords = ['garbage']; }
  else if (lower.includes('light') || lower.includes('bijli') || lower.includes('streetlight')) { issueType = 'Broken Streetlight'; department = 'Electrical Department'; priority = 'MEDIUM'; keywords = ['streetlight']; }
  else if (lower.includes('water') || lower.includes('pipe') || lower.includes('paani')) { issueType = 'Water Leakage'; department = 'Water Supply'; priority = 'HIGH'; keywords = ['water']; }
  else if (lower.includes('footpath') || lower.includes('broken') || lower.includes('damaged')) { issueType = 'Damaged Infrastructure'; department = 'Road Maintenance'; priority = 'MEDIUM'; keywords = ['infrastructure']; }
  if (lower.includes('urgent') || lower.includes('emergency') || lower.includes('accident') || lower.includes('burst')) priority = 'CRITICAL';
  const loc = text.match(/(?:near|at|in|on|opposite)\s+([A-Za-z0-9][^,.]{3,40})/i);
  const isHindi = /[\u0900-\u097F]/.test(text);
  const isHinglish = !isHindi && ['hai', 'mein', 'nahi', 'karo', 'wala'].some(w => lower.includes(w));
  return { issueType, description: text, location: loc ? loc[1].trim() : 'Location not specified', priority, department, urgency: priority.toLowerCase(), detectedLanguage: isHindi ? 'Hindi' : isHinglish ? 'Hinglish' : 'English', aiConfidence: 0.72, sentiment: lower.includes('urgent') ? 'frustrated' : 'neutral', keywords, suggestedResponse: `Your complaint about ${issueType.toLowerCase()} has been registered with the ${department} department.`, model: 'rule-based-fallback' };
}

function generateFallbackChatResponse(message) {
  const lower = message.toLowerCase();
  if (lower.includes('pothole') || lower.includes('road') || lower.includes('gadda')) return 'I have detected a road issue. Please provide the exact location so I can register this with Road Maintenance.';
  if (lower.includes('garbage') || lower.includes('kachra')) return 'I understand there is a garbage issue. Please confirm the exact location and I will register it with Sanitation.';
  if (lower.includes('light') || lower.includes('bijli')) return 'I have noted the streetlight issue. Please share the exact location and I will route this to the Electrical Department.';
  if (lower.includes('water') || lower.includes('paani')) return 'Water supply issues are high priority. Please share the location and I will escalate this immediately.';
  return 'Thank you for reaching out. Please describe the civic issue and provide your location so I can register your complaint.';
}

function getDefaultInsights() {
  return { topIssue: 'Potholes', criticalHotspot: 'Sector 14 and NH-8 Underpass', recommendation: 'Prioritize road repair in Sector 14. Deploy sanitation to Main Market Road.', trend: 'Water incidents increasing. Road damage up 40% this week.', departmentAlert: 'Road Maintenance handling 50% of complaints.', predictedIssues: 'Monsoon likely to worsen waterlogging at NH-8 underpass.', model: 'default' };
}

// ============================================================
// DEVELOPMENT-NEED EXTRACTION (v4)
// Only called when the deterministic multilingual classifier is unsure.
// The model may ONLY answer with taxonomy ids; anything else is discarded.
// ============================================================
import { isValidCategory, listTaxonomy } from '../intelligence/taxonomy.js';

export async function extractDevelopmentNeed(text) {
  const taxonomy = listTaxonomy();
  const result = await callAIService('/extract', { text, taxonomy });
  if (result && isValidCategory(result.category, result.subcategory)) {
    return { category: result.category, subcategory: result.subcategory || 'general', confidence: Math.min(0.9, Number(result.confidence) || 0.6), model: result.model || 'mistral-7b' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const ids = taxonomy.map(c => `${c.id}: ${c.subcategories.map(s => s.id).join(', ')}`).join('\n');
    const raw = await callAnthropicLLM(
      `You classify citizen requests into a fixed development taxonomy. Reply ONLY with JSON {"category":"<id>","subcategory":"<id>","confidence":0-1}. Use ONLY these ids:\n${ids}`,
      `Request: "${text}"`, 150);
    const parsed = parseJSON(raw);
    if (parsed && isValidCategory(parsed.category, parsed.subcategory)) {
      return { category: parsed.category, subcategory: parsed.subcategory || 'general', confidence: Math.min(0.85, Number(parsed.confidence) || 0.6), model: 'anthropic-fallback' };
    }
  }
  return null;
}

/**
 * Natural-language narration of ALREADY-COMPUTED facts. The model must not add facts;
 * the caller verifies every number in the narration against the source data.
 */
export async function narrateFacts(question, facts) {
  const system = 'You are a policy analyst assistant. Answer the question using ONLY the JSON facts provided. Do not introduce any number, place or claim that is not in the facts. Be concise (max 4 sentences). Use neutral language: never say an investment is ineffective.';
  const user = `Question: ${question}\nFacts (JSON): ${JSON.stringify(facts).slice(0, 6000)}`;
  const r = await callAIService('/narrate', { question, facts, system });
  if (r && typeof r.text === 'string' && r.text.trim()) return { text: r.text.trim(), model: r.model || 'mistral-7b' };
  if (process.env.ANTHROPIC_API_KEY) {
    const t = await callAnthropicLLM(system, user, 350);
    if (t) return { text: t.trim(), model: 'anthropic-fallback' };
  }
  return null;
}

export async function aiHealth() {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 2500);
    const r = await fetch(`${AI_SERVICE_URL}/health`, { signal: c.signal }); clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
