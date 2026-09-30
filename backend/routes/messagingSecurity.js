// ============================================================
// Messaging channel security, audit trail, and outbound pipeline.
// Supports WhatsApp Cloud, Telegram, SMS, and generic channels.
// Signature verification where providers support it.
// NEVER stores raw personal data beyond what's needed for audit.
// ============================================================
import crypto, { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import * as dev from '../database/devdb.js';

const MEDIA_DIR = path.join(process.cwd(), 'data', 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ---- Messaging schema is part of devdb.js audit_logs — no separate schema needed ----
// This placeholder is kept for API compatibility.
export function initMessagingSchema() {
  // Messaging events are recorded in the existing audit_logs table via dev.audit()
  // No additional schema migration is required.
}

// ---- Signature verifiers (per provider) ----

/**
 * Verify WhatsApp Cloud API webhook signature.
 * See: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
 * Header: X-Hub-Signature-256: sha256=<hmac>
 */
export function verifyWhatsappSignature(rawBody, headerValue, appSecret) {
  if (!appSecret) return { ok: false, reason: 'WHATSAPP_APP_SECRET not configured' };
  if (!headerValue || !headerValue.startsWith('sha256=')) return { ok: false, reason: 'Missing or malformed X-Hub-Signature-256 header' };
  const given = Buffer.from(headerValue.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  if (given.length !== expected.length) return { ok: false, reason: 'Signature length mismatch' };
  const valid = timingSafeEqual(given, expected);
  return valid ? { ok: true } : { ok: false, reason: 'Signature mismatch' };
}

/**
 * Verify Telegram webhook secret token.
 * See: https://core.telegram.org/bots/api#setwebhook  (secret_token parameter)
 * Header: X-Telegram-Bot-Api-Secret-Token
 */
export function verifyTelegramSignature(headerValue, secret) {
  if (!secret) return { ok: false, reason: 'TELEGRAM_SECRET_TOKEN not configured — verification skipped in demo mode' };
  if (!headerValue) return { ok: false, reason: 'Missing X-Telegram-Bot-Api-Secret-Token header' };
  const given = Buffer.from(headerValue);
  const want = Buffer.from(secret);
  if (given.length !== want.length) return { ok: false, reason: 'Token length mismatch' };
  return timingSafeEqual(given, want) ? { ok: true } : { ok: false, reason: 'Token mismatch' };
}

/**
 * Verify Twilio SMS webhook signature.
 * See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 * Header: X-Twilio-Signature
 */
export function verifyTwilioSignature(url, params, headerValue, authToken) {
  if (!authToken) return { ok: false, reason: 'TWILIO_AUTH_TOKEN not configured — verification skipped in demo mode' };
  if (!headerValue) return { ok: false, reason: 'Missing X-Twilio-Signature header' };
  // Build the string to sign: URL + sorted POST params concatenated
  const sortedKeys = Object.keys(params || {}).sort();
  const str = url + sortedKeys.map(k => k + (params[k] || '')).join('');
  const expected = createHmac('sha1', authToken).update(str).digest('base64');
  const given = Buffer.from(headerValue, 'base64');
  const want = Buffer.from(expected, 'base64');
  if (given.length !== want.length) return { ok: false, reason: 'Signature length mismatch' };
  return timingSafeEqual(given, want) ? { ok: true } : { ok: false, reason: 'Signature mismatch' };
}

/** Generic shared-secret fallback (used when provider-specific secret is unavailable). */
export function verifySharedSecret(headerValue, secret) {
  if (!secret) return { ok: false, reason: 'CHANNEL_WEBHOOK_SECRET not set — webhooks disabled' };
  const given = Buffer.from(String(headerValue || ''));
  const want = Buffer.from(secret);
  if (given.length !== want.length) return { ok: false, reason: 'Shared secret mismatch (length)' };
  return timingSafeEqual(given, want) ? { ok: true } : { ok: false, reason: 'Invalid shared secret' };
}

// ---- Media pipeline (architecture path; actual download depends on provider credentials) ----

export const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/mpeg'
]);
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Processes a media attachment from a webhook payload.
 * Returns a structured result — actual download only if credentials are present.
 * @returns {{ handled: boolean, type: string, status: string, note: string }}
 */
export async function handleMediaAttachment({ mediaId, mediaUrl, mimeType, fileSize, channel, requestId }) {
  const contentType = mimeType || 'application/octet-stream';
  if (!SUPPORTED_MIME_TYPES.has(contentType.split(';')[0].trim())) {
    return { handled: false, type: 'media', status: 'rejected', note: `Unsupported content type: ${contentType}` };
  }
  if (fileSize && fileSize > MAX_MEDIA_BYTES) {
    return { handled: false, type: 'media', status: 'rejected', note: `File size ${fileSize} exceeds limit (${MAX_MEDIA_BYTES} bytes)` };
  }

  const isImage = contentType.startsWith('image/');
  const isAudio = contentType.startsWith('audio/');

  // Check if download credentials are available
  const hasCredentials = !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) ||
    !!(process.env.TELEGRAM_BOT_TOKEN);

  if (!hasCredentials) {
    return {
      handled: false, type: isImage ? 'image' : isAudio ? 'audio' : 'media',
      status: 'credentials_unavailable',
      note: `Media pipeline architecture is implemented. ${isImage ? 'Image' : isAudio ? 'Audio'
        : 'Media'} download requires provider API credentials (${channel}_TOKEN / WHATSAPP_ACCESS_TOKEN). In demo mode, text content is processed and media is acknowledged.`
    };
  }

  // Real download path (activated when credentials are present)
  let localPath = null, hash = null;
  try {
    const headers = {};
    let finalUrl = mediaUrl;

    if (channel === 'whatsapp-cloud' && process.env.WHATSAPP_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`;
      if (!finalUrl && mediaId) {
        const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, { headers });
        if (!metaRes.ok) throw new Error(`WhatsApp metadata fetch failed: ${metaRes.status}`);
        const meta = await metaRes.json();
        finalUrl = meta.url;
      }
    } else if (channel === 'telegram' && process.env.TELEGRAM_BOT_TOKEN) {
      if (!finalUrl && mediaId) {
        const metaRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${mediaId}`);
        if (!metaRes.ok) throw new Error(`Telegram metadata fetch failed: ${metaRes.status}`);
        const meta = await metaRes.json();
        finalUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${meta.result.file_path}`;
      }
    }

    if (!finalUrl) throw new Error('No media URL could be resolved for this channel');

    const res = await fetch(finalUrl, { headers });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const filename = `${mediaId}.${ext}`;
    localPath = path.join(MEDIA_DIR, filename);
    
    const buffer = await res.arrayBuffer();
    const data = Buffer.from(buffer);
    fs.writeFileSync(localPath, data);
    hash = crypto.createHash('sha256').update(data).digest('hex');
  } catch (err) {
    return {
      handled: false, type: isImage ? 'image' : isAudio ? 'audio' : 'media',
      status: 'download_failed',
      note: `Failed to download media: ${err.message}`
    };
  }

  return {
    handled: true, type: isImage ? 'image' : isAudio ? 'audio' : 'media',
    status: 'downloaded',
    note: `Successfully downloaded and stored securely (SHA-256: ${hash.slice(0, 16)}...)`,
    mediaId, mediaUrl, requestId, localPath, hash
  };
}

// ---- Outbound reply pipeline ----

/** Response templates (localized by language where applicable). */
export const REPLY_TEMPLATES = {
  received: {
    en: (id) => `Your request has been received (ID: ${id}). Our team will review and respond.`,
    hi: (id) => `आपका अनुरोध प्राप्त हो गया है (ID: ${id})। हमारी टीम समीक्षा करेगी।`,
    hinglish: (id) => `Aapka request mil gaya hai (ID: ${id}). Team jaldi jawab degi.`,
    pt: (id) => `Sua solicitação foi recebida (ID: ${id}). Nossa equipe irá analisar em breve.`
  },
  grouped: {
    en: (count) => `Your request was grouped with ${count} similar requests — this strengthens the case for urgent action.`,
    pt: (count) => `Sua solicitação foi agrupada com mais ${count} pedidos similares — isso fortalece o caso para ação urgente.`,
    hi: (count) => `आपका अनुरोध ${count} समान अनुरोधों के साथ समूहित किया गया — इससे समस्या की प्राथमिकता बढ़ती है।`,
    hinglish: (count) => `Aapka request ${count} similar requests ke saath group ho gaya — priority badh gayi.`
  },
  forwarded: {
    en: (dept) => `Your issue has been forwarded to the relevant department: ${dept}.`,
    pt: (dept) => `Seu pedido foi encaminhado para o departamento responsável: ${dept}.`,
    hi: (dept) => `आपकी समस्या संबंधित विभाग को भेज दी गई है: ${dept}।`,
    hinglish: (dept) => `Aapki problem ${dept} ko bhej di gayi hai.`
  }
};

/**
 * Build an outbound reply message based on actual request state.
 * Never hardcodes ticket IDs or fake status.
 */
export function buildOutboundReply({ templateKey, language, args = [], requestId, ticketId }) {
  const lang = REPLY_TEMPLATES[templateKey]?.[language] ? language : 'en';
  const fn = REPLY_TEMPLATES[templateKey]?.[lang];
  if (!fn) return { text: `Your request (ID: ${ticketId || requestId}) has been processed.`, language: 'en' };
  return { text: fn(...args), language: lang, requestId, ticketId };
}

/**
 * Send a reply to a citizen via messaging provider.
 * Returns status — does NOT pretend to send if provider is unavailable.
 */
export async function sendChannelReply({ channel, to, message, language }) {
  // Determine if real provider credentials are configured
  const providerAvailable = {
    'whatsapp-cloud': !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    'telegram': !!process.env.TELEGRAM_BOT_TOKEN,
    'sms': !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  };

  const hasProvider = providerAvailable[channel] || false;

  if (!hasProvider) {
    return {
      sent: false,
      mode: 'demo',
      channel,
      note: `Demo Mode: Outbound adapter for "${channel}" is implemented. Reply would be: "${message.slice(0, 80)}..." — sending requires ${channel.toUpperCase().replace('-', '_')} API credentials in environment.`
    };
  }

  // Real send implementation (activated when credentials present)
  try {
    if (channel === 'whatsapp-cloud') {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }),
          signal: AbortSignal.timeout(10000)
        }
      );
      const data = await res.json();
      return { sent: res.ok, channel, messageId: data.messages?.[0]?.id, error: res.ok ? null : data.error?.message };
    }
    if (channel === 'telegram') {
      const res = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: to, text: message }), signal: AbortSignal.timeout(10000) }
      );
      const data = await res.json();
      return { sent: data.ok, channel, messageId: data.result?.message_id };
    }
    if (channel === 'sms') {
      const body = new URLSearchParams({ To: to, From: process.env.TWILIO_PHONE_NUMBER || 'CIVICAI', Body: message });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(), signal: AbortSignal.timeout(10000)
      });
      const data = await res.json();
      return { sent: res.ok, channel, messageId: data.sid, error: res.ok ? null : data.message };
    }
    return { sent: false, channel, note: 'Provider send not implemented for this channel.' };
  } catch (e) {
    return { sent: false, channel, error: e.message };
  }
}

// ---- Messaging audit trail ----

/** Record a messaging event in the audit log (no raw personal data stored). */
export function auditMessagingEvent({ channel, inboundMessageId, requestId, ticketId, processingStatus, mediaStatus = null, replyStatus = null, errorDetails = null }) {
  dev.audit({
    actorType: 'system',
    action: `messaging.${processingStatus}`,
    entityType: 'citizen_request',
    entityId: requestId || 'unknown',
    details: {
      channel,
      inboundMessageId: inboundMessageId || null,
      ticketId: ticketId || null,
      processingStatus,
      mediaStatus,
      replyStatus,
      errorDetails: errorDetails ? String(errorDetails).slice(0, 200) : null
      // NOTE: no sender phone/ID stored here — only internal request/ticket IDs
    }
  });
}

// ---- Webhook payload normalizers (enhanced from channels.js) ----
// These are enhanced versions supporting media extraction.

export const CHANNEL_NORMALIZERS_ENHANCED = {
  generic: (b) => ({ from: b.from, text: b.text, lat: b.lat, lng: b.lng, language: b.language, media: null }),

  'whatsapp-cloud': (b) => {
    const m = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!m) return null;
    let media = null;
    if (m.type === 'image') media = { type: 'image', mediaId: m.image?.id, mimeType: 'image/jpeg' };
    else if (m.type === 'audio') media = { type: 'audio', mediaId: m.audio?.id, mimeType: m.audio?.mime_type || 'audio/ogg' };
    else if (m.type === 'document') media = { type: 'document', mediaId: m.document?.id, mimeType: m.document?.mime_type };
    return {
      from: m.from,
      text: m.type === 'text' ? m.text?.body : (m.caption || null),
      lat: m.location?.latitude, lng: m.location?.longitude,
      media
    };
  },

  telegram: (b) => {
    const m = b?.message;
    if (!m) return null;
    let media = null;
    if (m.photo?.length) media = { type: 'image', mediaId: m.photo[m.photo.length - 1].file_id, mimeType: 'image/jpeg' };
    else if (m.voice) media = { type: 'audio', mediaId: m.voice.file_id, mimeType: m.voice.mime_type || 'audio/ogg' };
    else if (m.audio) media = { type: 'audio', mediaId: m.audio.file_id, mimeType: m.audio.mime_type };
    return { from: String(m.from?.id || ''), text: m.text || m.caption, lat: m.location?.latitude, lng: m.location?.longitude, media };
  },

  sms: (b) => ({ from: b.From || b.from, text: b.Body || b.text, media: null })
};

export function normalizeChannelPayloadEnhanced(channel, body) {
  const fn = CHANNEL_NORMALIZERS_ENHANCED[channel];
  return fn ? fn(body || {}) : undefined;
}

// ---- Replay protection (timestamp window) ----
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export function checkTimestamp(ts) {
  if (!ts) return { ok: true, note: 'No timestamp provided — replay protection not applicable' };
  const t = typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
  if (isNaN(t)) return { ok: true, note: 'Unparseable timestamp' };
  const age = Date.now() - t;
  if (age > REPLAY_WINDOW_MS) return { ok: false, reason: `Message timestamp is ${Math.round(age / 1000)}s old (limit: ${REPLAY_WINDOW_MS / 1000}s)` };
  if (age < -60000) return { ok: false, reason: 'Message timestamp is in the future (possible replay/forgery)' };
  return { ok: true };
}
