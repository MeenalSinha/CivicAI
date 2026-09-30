import React from 'react';

export const fmt = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-IN'));
export const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
export const signedPct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);

export const BAND_CLASS = { critical: 'crit', high: 'high', moderate: 'mod', low: 'low' };
export function SeverityBadge({ band }) {
  return <span className={`pi-badge pi-b-${BAND_CLASS[band] || 'neutral'}`}>{band ? band[0].toUpperCase() + band.slice(1) : 'n/a'}</span>;
}
export function PriorityBadge({ band }) {
  const c = band?.startsWith('P1') ? 'crit' : band?.startsWith('P2') ? 'high' : band?.startsWith('P3') ? 'mod' : 'neutral';
  return <span className={`pi-badge pi-b-${c}`}>{band || '—'}</span>;
}
export function ReviewBadge({ status }) {
  const map = { approved: ['low', 'Approved'], rejected: ['crit', 'Rejected'], needs_info: ['mod', 'More info needed'], pending_review: ['neutral', 'Pending review'] };
  const [c, l] = map[status] || map.pending_review;
  return <span className={`pi-badge pi-b-${c}`}>{l}</span>;
}
export const Bar = ({ value, max = 1, color }) => (
  <div className="pi-bar" role="img" aria-label={`${Math.round((value / max) * 100)}%`}><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} /></div>
);
export function Kpi({ value, label, note }) {
  return <div className="pi-card pi-kpi"><div className="v">{value}</div><div className="l">{label}</div>{note && <div className="n">{note}</div>}</div>;
}
export const Loading = ({ what = 'data' }) => <div className="pi-load" role="status">Loading {what}…</div>;
export const ErrorBox = ({ error, onRetry }) => error ? (
  <div className="pi-err" role="alert">{String(error.message || error)} {onRetry && <button className="pi-btn ghost sm" style={{ marginLeft: 8 }} onClick={onRetry}>Retry</button>}</div>
) : null;
export const Empty = ({ children }) => <div className="pi-empty">{children}</div>;

export function Spark({ data = [], width = 110, height = 26, color = '#12406d' }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data), step = width / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return <svg width={width} height={height} role="img" aria-label={`Weekly requests, last ${data.length} weeks`}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" /><circle cx={(data.length - 1) * step} cy={height - 2 - (data[data.length - 1] / max) * (height - 4)} r="2.4" fill={color} /></svg>;
}

export function SyntheticBanner({ overview }) {
  if (!overview?.isSyntheticData) return null;
  return <div className="pi-banner" role="note"><strong>SYNTHETIC DEMONSTRATION DATA</strong><span>{overview.instance?.dataLabel || 'Values are illustrative and are not official government statistics.'} Scores and rankings below are computed live from this data.</span></div>;
}

export function useAsync(fn, deps = []) {
  const [state, set] = React.useState({ loading: true, data: null, error: null });
  const run = React.useCallback(async () => {
    set(s => ({ ...s, loading: true, error: null }));
    try { set({ loading: false, data: await fn(), error: null }); }
    catch (e) { set(s => ({ loading: false, data: s.data, error: e })); }
  }, deps);
  React.useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export const CATEGORY_COLORS = {
  roads_transport: '#5b6b7c', water_supply: '#1f6fb2', drainage_flood: '#2a8f9c', sanitation: '#7a5c99', waste_management: '#8a7a3c', electricity: '#c48a00',
  public_healthcare: '#b3332f', education: '#3c7d4f', public_safety: '#8a3b3b', public_mobility: '#4a5fa8', digital_connectivity: '#5f7f9f', other: '#8a94a0'
};
export const catColor = (c) => CATEGORY_COLORS[c] || '#66758a';
export const sevColor = (b) => ({ critical: '#a4262c', high: '#c2570c', moderate: '#c9a227', low: '#3f8a63' }[b] || '#8a94a0');
