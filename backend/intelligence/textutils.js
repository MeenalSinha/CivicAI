// Privacy + text helpers: redaction, fingerprints, similarity, urgency cues.
import { createHash } from 'crypto';
import { tokenize } from './language.js';
import { clamp } from './config.js';

const SALT = () => process.env.PRIVACY_SALT || process.env.JWT_SECRET || 'civicai-dev-salt';

/** One-way salted hash: identity never enters development-intelligence tables. */
export function hashIdentity(value) {
  if (!value) return null;
  return createHash('sha256').update(`${SALT()}|${String(value).trim().toLowerCase()}`).digest('hex').slice(0, 24);
}

export function redactPII(text, maxLen = 160) {
  if (!text) return '';
  let t = String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, '[number]')
    .replace(/\b(?:aadhaar|aadhar|pan|passport)\b[^.,;]*/gi, '[id]')
    .replace(/<[^>]*>/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
}

const STOP = new Set(['the','a','an','is','are','in','on','at','of','to','and','for','it','this','that','hai','hain','ka','ki','ke','ko','se','mein','me','par','pe','ho','raha','rahi','rahe','ye','yeh','wo','woh','के','की','का','में','है','हैं','को','से','पर','और','यह','वह','de','da','do','em','um','uma']);

export function contentTokens(text) {
  return tokenize(text).filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

export function textFingerprint(text) {
  const toks = [...new Set(contentTokens(text))].sort();
  return createHash('sha1').update(toks.join(' ')).digest('hex').slice(0, 16);
}

export function jaccard(a, b) {
  const A = new Set(contentTokens(a)), B = new Set(contentTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---- Urgency & scope cues (multilingual) ----
const EMPHASIS = ['urgent','urgently','emergency','immediately','asap','dangerous','serious','critical','turant','jaldi','abhi','khatarnak','तुरंत','जल्दी','खतरनाक','आपातकालीन','अत्यावश्यक','urgente','perigo','perigoso'];
const HAZARD = ['accident','accidents','injured','injury','died','death','fire','electric shock','shock','collapse','drowned','disease','dengue','cholera','typhoid','sick','ill','hadsa','haadse','durghatna','bimar','beemar','दुर्घटना','हादसा','बीमार','मौत','आग','करंट','acidente','doença','doenca'];
const COMMUNITY = ['colony','mohalla','locality','area','neighbourhood','neighborhood','residents','families','everyone','all of us','whole','entire','village','gaon','basti','ilaaka','ilaka','sabhi','sab log','hamare','humare','society','ward','कॉलोनी','मोहल्ला','इलाके','इलाका','गांव','बस्ती','परिवार','सभी','सब लोग','हमारे','पूरे','bairro','moradores','comunidade','todos','famílias','familias'];

export function extractDurationDays(text) {
  const t = String(text).toLowerCase();
  const units = { day: 1, days: 1, din: 1, दिन: 1, dias: 1, dia: 1, week: 7, weeks: 7, hafte: 7, hafta: 7, हफ्ते: 7, हफ्ता: 7, सप्ताह: 7, semana: 7, semanas: 7, month: 30, months: 30, mahine: 30, mahina: 30, महीने: 30, महीना: 30, mes: 30, meses: 30, year: 365, years: 365, saal: 365, साल: 365, ano: 365, anos: 365 };
  const m = t.match(/(\d{1,3})\s*(days?|din|दिन|dias?|weeks?|hafte|hafta|हफ्ते|हफ्ता|सप्ताह|semanas?|months?|mahine|mahina|महीने|महीना|mes(?:es)?|years?|saal|साल|anos?)/u);
  if (m) return parseInt(m[1], 10) * (units[m[2]] || 1);
  if (/(pichle|last|past|पिछले)\s*(hafte|week|हफ्ते)/u.test(t)) return 7;
  if (/(kai|several|कई)\s*(din|days|दिन)/u.test(t)) return 5;
  return null;
}

export function extractFamilies(text) {
  const m = String(text).match(/(\d{2,6})\s*(families|households|residents|people|log|logon|parivar|परिवार|लोग|famílias|familias|moradores)/iu);
  return m ? parseInt(m[1], 10) : null;
}

/** Urgency 0..1 from safety weight of the need + explicit emphasis + duration + hazard words. */
export function estimateUrgency(text, safetyWeight = 0.3) {
  const t = String(text).toLowerCase();
  const has = list => list.some(w => t.includes(w));
  const emphasis = has(EMPHASIS) ? 0.2 : 0;
  const hazard = has(HAZARD) ? 0.25 : 0;
  const days = extractDurationDays(text);
  const duration = days == null ? 0 : clamp(Math.log10(1 + days) / Math.log10(60), 0, 1) * 0.25;
  const urgency = clamp(0.15 + safetyWeight * 0.4 + emphasis + hazard + duration, 0, 1);
  const band = urgency >= 0.8 ? 'critical' : urgency >= 0.6 ? 'high' : urgency >= 0.35 ? 'medium' : 'low';
  return { urgency: Math.round(urgency * 100) / 100, band, durationDays: days, hazardMentioned: !!hazard, emphasised: !!emphasis };
}

/** Population relevance 0..1: does the request describe a shared/community need? */
export function estimatePopulationRelevance(text, sharedNatureWeight = 0.15) {
  const t = String(text).toLowerCase();
  const community = COMMUNITY.some(w => t.includes(w));
  const families = extractFamilies(text);
  let v = 0.3 + sharedNatureWeight + (community ? 0.3 : 0);
  if (families) v += clamp(Math.log10(families) / 4, 0, 0.25);
  v = clamp(v, 0.1, 1);
  return { relevance: Math.round(v * 100) / 100, scope: v >= 0.75 ? 'community' : v >= 0.5 ? 'neighbourhood' : 'household', statedHouseholds: families };
}
