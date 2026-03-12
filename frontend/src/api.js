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

// ---- Citizen API ----
export const citizenAPI = {
  chat: (message, history, sessionId) =>
    apiFetch('/chat', { method: 'POST', body: JSON.stringify({ message, history, sessionId }) }),

  submitComplaint: (text, location, citizenName, citizenPhone) =>
    apiFetch('/complaints', { method: 'POST', body: JSON.stringify({ text, location, citizenName, citizenPhone }) }),

  trackComplaint: (id) => apiFetch(`/complaints/${encodeURIComponent(id)}`),

  upvoteComplaint: (id) => apiFetch(`/complaints/${encodeURIComponent(id)}/upvote`, { method: 'POST' }),

  analyzeImage: (image, location, citizenName) =>
    apiFetch('/analyze-image', { method: 'POST', body: JSON.stringify({ image, location, citizenName }) }, 45000),

  submitVoice: (transcript, location, citizenName) =>
    apiFetch('/voice-complaint', { method: 'POST', body: JSON.stringify({ transcript, location, citizenName }) }),

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
