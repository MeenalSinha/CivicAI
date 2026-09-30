// ============================================================
// CivicAI - API Client v2.0
// JWT auth, timeout, WebSocket reconnect
// ============================================================

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
export const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3001';

// Token storage helpers
export const tokenStore = {
  get: () => sessionStorage.getItem('civicai_token'),
  set: (t) => sessionStorage.setItem('civicai_token', t),
  clear: () => sessionStorage.removeItem('civicai_token'),
  getOfficer: () => {
    try { return JSON.parse(sessionStorage.getItem('civicai_officer') || 'null'); } catch { return null; }
  },
  setOfficer: (o) => sessionStorage.setItem('civicai_officer', JSON.stringify(o)),
  clearAll: () => { sessionStorage.removeItem('civicai_token'); sessionStorage.removeItem('civicai_officer'); }
};

// Generic fetch with timeout and auth
async function apiFetch(path, options = {}, timeoutMs = 15000) {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = tokenStore.get();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.headers) Object.assign(headers, options.headers);

    const response = await fetch(url, { ...options, headers, signal: controller.signal });

    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Server error (${response.status})`); }

    if (response.status === 401) {
      tokenStore.clearAll();
      window.dispatchEvent(new CustomEvent('civicai:auth-expired'));
    }

    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Please check your connection.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Auth API ----
export const authAPI = {
  login: (username, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => apiFetch('/auth/me')
};

// ---- Citizen client identity + opt-in geolocation ----
// clientId is a random per-browser id used only for duplicate/spam protection (hashed server-side).
export const clientStore = {
  id: () => {
    try {
      let v = localStorage.getItem('civicai_client');
      if (!v) { v = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('civicai_client', v); }
      return v;
    } catch { return 'c' + Math.random().toString(36).slice(2, 14).padEnd(10, 'x'); }
  }
};
let _geo = null;
export const geoStore = {
  get: () => _geo,
  clear: () => { _geo = null; },
  // Opt-in only: called from a user gesture; nothing is requested automatically.
  request: () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported by this browser.'));
    navigator.geolocation.getCurrentPosition(
      pos => { _geo = { lat: pos.coords.latitude, lng: pos.coords.longitude }; resolve(_geo); },
      err => reject(new Error(err.code === 1 ? 'Location permission was denied.' : 'Could not determine your location.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  })
};
const withClient = (o) => ({ ...o, clientId: clientStore.id(), ...(_geo ? { lat: _geo.lat, lng: _geo.lng } : {}) });

// ---- Citizen API ----
export const citizenAPI = {
  chat: (message, history, sessionId) =>
    apiFetch('/chat', { method: 'POST', body: JSON.stringify(withClient({ message, history, sessionId })) }),

  submitComplaint: (text, location, citizenName, citizenPhone) =>
    apiFetch('/complaints', { method: 'POST', body: JSON.stringify(withClient({ text, location, citizenName, citizenPhone })) }),

  sendFeedback: (id, rating, comment) =>
    apiFetch(`/complaints/${encodeURIComponent(id)}/feedback`, { method: 'POST', body: JSON.stringify({ rating, comment }) }),

  trackComplaint: (id) => apiFetch(`/complaints/${encodeURIComponent(id)}`),

  upvoteComplaint: (id) => apiFetch(`/complaints/${encodeURIComponent(id)}/upvote`, { method: 'POST' }),

  analyzeImage: (image, location, citizenName) =>
    apiFetch('/analyze-image', { method: 'POST', body: JSON.stringify(withClient({ image, location, citizenName })) }, 45000),

  submitVoice: (transcript, location, citizenName) =>
    apiFetch('/voice-complaint', { method: 'POST', body: JSON.stringify(withClient({ transcript, location, citizenName })) }),

  getNotifications: () => apiFetch('/notifications'),
  markAllRead: () => apiFetch('/notifications/read-all', { method: 'POST' })
};

// ---- Officer API ----
export const officerAPI = {
  getComplaints: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
    return apiFetch(`/officer/complaints?${params}`);
  },
  updateComplaint: (id, updates) =>
    apiFetch(`/officer/complaints/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  getAnalytics: () => apiFetch('/officer/analytics'),
  getInsights: () => apiFetch('/officer/insights'),
  getPredictions: () => apiFetch('/officer/predictions'),
  getMapData: () => apiFetch('/map/complaints')
};

// ---- Policy intelligence API (aggregates only; role protected) ----
const qs = (o = {}) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, String(v)); }); const s = p.toString(); return s ? `?${s}` : ''; };
export const policyAPI = {
  meta: () => apiFetch('/policy/meta'),
  overview: () => apiFetch('/policy/overview'),
  geo: (f = {}) => apiFetch(`/policy/geo${qs(f)}`),
  priorities: (f = {}) => apiFetch(`/policy/priorities${qs(f)}`),
  priority: (id) => apiFetch(`/policy/priorities/${encodeURIComponent(id)}`),
  trends: () => apiFetch('/policy/trends'),
  regions: () => apiFetch('/policy/regions'),
  gaps: (f = {}) => apiFetch(`/policy/gaps${qs(f)}`),
  investments: () => apiFetch('/policy/investments'),
  outcomes: () => apiFetch('/policy/outcomes'),
  query: (question, context) => apiFetch('/policy/query', { method: 'POST', body: JSON.stringify({ question, context }) }, 60000),
  reviewRecommendation: (id, status, note) => apiFetch(`/policy/priorities/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  reviewQueue: (status) => apiFetch(`/policy/review/recommendations${qs({ status })}`),
  requestsToReview: () => apiFetch('/policy/review/requests'),
  reclassify: (id, category, subcategory) => apiFetch(`/policy/review/requests/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ category, subcategory }) }),
  runPipeline: () => apiFetch('/policy/pipeline/run', { method: 'POST' }, 60000),
  getWeights: () => apiFetch('/policy/config/weights'),
  setWeights: (body) => apiFetch('/policy/config/weights', { method: 'PUT', body: JSON.stringify(body) }, 60000),
  resetWeights: () => apiFetch('/policy/config/weights/reset', { method: 'POST' }, 60000),
  audit: (f = {}) => apiFetch(`/policy/audit${qs(f)}`),
  datasets: () => apiFetch('/policy/datasets'),
  importDataset: (body) => apiFetch('/policy/datasets/import', { method: 'POST', body: JSON.stringify(body) }, 60000),
  resetDemo: () => apiFetch('/policy/demo/reset', { method: 'POST' }, 90000)
};

// ---- Judge Mode (available only when the server runs with DEMO_MODE=true) ----
export const judgeAPI = {
  status: () => apiFetch('/judge/status'),
  session: () => apiFetch('/judge/session', { method: 'POST' }),
  scenario: () => apiFetch('/judge/scenario'),
  transcribe: (audio, mimeType) => apiFetch('/judge/transcribe', { method: 'POST', body: JSON.stringify({ audio, mimeType }) }, 90000),
  submit: (transcript, transcriptSource, runId) => apiFetch('/judge/submit', { method: 'POST', body: JSON.stringify({ transcript, transcriptSource, runId }) }, 60000)
};

// ---- BRICS Interoperability API ----
export const bricsAPI = {
  instances: () => apiFetch('/brics/instances'),
  switchInstance: (instanceId) => apiFetch('/brics/switch', { method: 'POST', body: JSON.stringify({ instanceId }) }, 30000),
  summary: () => apiFetch('/brics/summary'),
};

// ---- Health ----
export const checkHealth = () => apiFetch('/health');

// ---- WebSocket with auto-reconnect ----
export function createWebSocket(onMessage, onOpen, onClose) {
  let ws, reconnectTimer, destroyed = false, attempt = 0;

  function connect() {
    if (destroyed) return;
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { attempt = 0; if (onOpen) onOpen(); };
      ws.onmessage = (e) => {
        try { const parsed = JSON.parse(e.data); if (onMessage) onMessage(parsed); } catch {}
      };
      ws.onclose = () => {
        if (onClose) onClose();
        if (!destroyed) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          attempt++;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
      ws.onerror = () => {};
    } catch {}
  }

  connect();
  return () => {
    destroyed = true;
    clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); }
  };
}
