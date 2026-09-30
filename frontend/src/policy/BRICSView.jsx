import React, { useState, useEffect, useCallback } from 'react';
import { bricsAPI } from '../api';
import { policyStyles } from './policyStyles';
import { Loading, ErrorBox } from './ui';

// ============================================================
// BRICS Interoperability View
// Demonstrates that the SAME CivicAI engine runs on multiple country
// instances with zero engine code changes — only config + data differ.
// ============================================================

const COUNTRY_FLAG = { IN: '🇮🇳', BR: '🇧🇷', RU: '🇷🇺', CN: '🇨🇳', ZA: '🇿🇦', EG: '🇪🇬', ET: '🇪🇹', IR: '🇮🇷', AE: '🇦🇪', ID: '🇮🇩', NG: '🇳🇬' };

const styles = `
${policyStyles}

.brics-root { padding: 20px 24px; font-family: 'Inter', sans-serif; }
.brics-hero {
  background: linear-gradient(135deg, #1a3a5c 0%, #1a56db 60%, #0d9488 100%);
  border-radius: 14px;
  padding: 28px 32px;
  color: white;
  margin-bottom: 24px;
  position: relative;
  overflow: hidden;
}
.brics-hero::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 80% 50%, rgba(255,255,255,0.06) 0%, transparent 70%);
  pointer-events: none;
}
.brics-hero-title { font-size: 22px; font-weight: 800; letter-spacing: -0.4px; margin-bottom: 6px; }
.brics-hero-sub { font-size: 14px; opacity: 0.85; line-height: 1.6; max-width: 680px; }
.brics-engine-tag {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 20px;
  padding: 4px 14px;
  font-size: 12px; font-weight: 600;
  margin-top: 14px;
}

.brics-arch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}
@media (max-width: 760px) { .brics-arch-grid { grid-template-columns: 1fr; } }

.brics-arch-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px 20px;
}
.brics-arch-card h4 {
  font-size: 12px; font-weight: 700; color: #4b5563;
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 12px;
}
.brics-pill-list { display: flex; flex-wrap: wrap; gap: 6px; }
.brics-pill {
  padding: 3px 10px; border-radius: 10px;
  font-size: 12px; font-weight: 500;
}
.brics-pill.shared { background: #eff4ff; color: #1a56db; border: 1px solid #c7d7fa; }
.brics-pill.country { background: #f0fdf4; color: #059669; border: 1px solid #a7f3d0; }

.brics-instances-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 16px; margin-bottom: 24px;
}
@media (max-width: 760px) { .brics-instances-grid { grid-template-columns: 1fr; } }

.brics-instance-card {
  background: white; border: 2px solid #e2e8f0; border-radius: 12px;
  padding: 20px; cursor: pointer; transition: all 0.18s;
  position: relative;
}
.brics-instance-card:hover { border-color: #1a56db; box-shadow: 0 4px 16px rgba(26,86,219,0.1); }
.brics-instance-card.active { border-color: #1a56db; background: #f6f9ff; }
.brics-instance-card.loading-state { opacity: 0.6; pointer-events: none; }

.brics-inst-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.brics-inst-flag { font-size: 28px; line-height: 1; }
.brics-inst-name { font-size: 15px; font-weight: 700; color: #111827; }
.brics-inst-scope { font-size: 12px; color: #6b7280; }

.brics-inst-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.brics-stat { background: #f8fafc; border-radius: 8px; padding: 8px 10px; }
.brics-stat-v { font-size: 16px; font-weight: 700; color: #1a56db; }
.brics-stat-l { font-size: 11px; color: #6b7280; }

.brics-inst-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.brics-inst-lang {
  padding: 2px 8px; border-radius: 6px;
  background: #f0f4f9; color: #374151;
  font-size: 11px; font-weight: 500;
}
.brics-inst-currency {
  padding: 2px 8px; border-radius: 6px;
  background: #f0fdf4; color: #059669;
  font-size: 11px; font-weight: 600;
}
.brics-inst-badge-active {
  position: absolute; top: 12px; right: 12px;
  background: #1a56db; color: white;
  font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 8px;
  letter-spacing: 0.3px;
}

.brics-switch-btn {
  display: block; width: 100%; margin-top: 12px;
  padding: 8px; border-radius: 8px;
  border: 1px solid #c7d7fa; background: #eff4ff;
  color: #1a56db; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.brics-switch-btn:hover { background: #1a56db; color: white; }
.brics-switch-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.brics-switched-banner {
  background: linear-gradient(90deg, #0d9488 0%, #059669 100%);
  border-radius: 10px; color: white;
  padding: 14px 18px; margin-bottom: 20px;
  display: flex; align-items: center; gap: 12px;
  animation: fadeSlide 0.35s ease;
}
@keyframes fadeSlide { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }

.brics-synth-notice {
  background: #fffbeb; border: 1px solid #fde68a;
  border-radius: 10px; padding: 12px 16px;
  font-size: 12px; color: #92400e;
  margin-bottom: 20px;
  display: flex; align-items: flex-start; gap: 8px;
}

.brics-overview-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; margin-top: 16px;
}
@media (max-width: 720px) { .brics-overview-grid { grid-template-columns: 1fr 1fr; } }

.brics-ov-card {
  background: white; border: 1px solid #e2e8f0;
  border-radius: 10px; padding: 14px 16px;
}
.brics-ov-val { font-size: 22px; font-weight: 800; color: #111827; }
.brics-ov-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
`;

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

const LANG_NAMES = { en: 'English', hi: 'हिन्दी', hinglish: 'Hinglish', pt: 'Português', ru: 'Русский', zh: '中文', ar: 'عربي' };

export default function BRICSView({ onSwitchedInstance }) {
  const [summary, setSummary] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [switched, setSwitched] = useState(null);
  const [error, setError] = useState(null);
  const [switchedOverview, setSwitchedOverview] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, inst] = await Promise.all([bricsAPI.summary(), bricsAPI.instances()]);
        setSummary(s);
        setActiveId(inst.activeInstance);
      } catch (e) { setError(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const switchTo = useCallback(async (instanceId) => {
    if (instanceId === activeId) return;
    setSwitching(true); setError(null);
    try {
      const result = await bricsAPI.switchInstance(instanceId);
      setActiveId(instanceId);
      setSwitched(result);
      setSwitchedOverview(result.overview);
      if (onSwitchedInstance) onSwitchedInstance(result);
    } catch (e) { setError(e); }
    finally { setSwitching(false); }
  }, [activeId, onSwitchedInstance]);

  if (loading) return <div className="brics-root"><style>{styles}</style><Loading what="BRICS interoperability data" /></div>;
  if (error) return <div className="brics-root"><style>{styles}</style><ErrorBox error={error} /></div>;

  const sharedComponents = summary?.sharedComponents || [];
  const countryComponents = summary?.countrySpecificComponents || [];
  const instances = summary?.instances || [];

  return (
    <div className="brics-root">
      <style>{styles}</style>

      {/* Hero */}
      <div className="brics-hero">
        <div className="brics-hero-title">BRICS Interoperability — Shared Engine Architecture</div>
        <div className="brics-hero-sub">
          One intelligence engine. Country-specific configuration, data adapters, language, administrative hierarchy and department taxonomy.
          No engine code changes between countries — only configuration and data differ.
        </div>
        <div className="brics-engine-tag">
          ⚙️ {summary?.architecture || 'Shared CivicAI Intelligence Engine'} · {instances.length} active country instances
        </div>
      </div>

      {/* Switched banner */}
      {switched && (
        <div className="brics-switched-banner">
          <span style={{ fontSize: 24 }}>{COUNTRY_FLAG[switched.instance?.country?.slice(0,2)] || '🌍'}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Active instance switched → {switched.instance?.country}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{switched.instance?.name} · {switched.instance?.currency?.code} · {(switched.instance?.languages || []).join(', ')} · {(switched.instance?.adminLevels || []).join(' → ')}</div>
          </div>
        </div>
      )}

      {/* Synthetic data notice */}
      <div className="brics-synth-notice">
        <span>⚠️</span>
        <div>
          <strong>DEMONSTRATION / SYNTHETIC DATA.</strong> All datasets shown here (regions, infrastructure indicators, citizen requests, investments) are synthetic values created for demonstration purposes only. They are not official government statistics of any BRICS country.
        </div>
      </div>

      {/* Architecture decomposition */}
      <div className="brics-arch-grid">
        <div className="brics-arch-card">
          <h4>🔄 Shared Engine Components</h4>
          <div className="brics-pill-list">
            {sharedComponents.map(c => <span key={c} className="brics-pill shared">{c.replace(/_/g, ' ')}</span>)}
          </div>
        </div>
        <div className="brics-arch-card">
          <h4>🌐 Country-Specific Configuration</h4>
          <div className="brics-pill-list">
            {countryComponents.map(c => <span key={c} className="brics-pill country">{c.replace(/_/g, ' ')}</span>)}
          </div>
        </div>
      </div>

      {/* Country instance cards */}
      <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        Active Country Instances
      </div>
      <div className="brics-instances-grid">
        {instances.map(inst => (
          <div
            key={inst.instanceId}
            className={`brics-instance-card ${activeId === inst.instanceId ? 'active' : ''} ${switching ? 'loading-state' : ''}`}
          >
            {activeId === inst.instanceId && <div className="brics-inst-badge-active">ACTIVE</div>}
            <div className="brics-inst-header">
              <div className="brics-inst-flag">{COUNTRY_FLAG[inst.countryCode] || '🌍'}</div>
              <div>
                <div className="brics-inst-name">{inst.country}</div>
                <div className="brics-inst-scope">{inst.scope}</div>
              </div>
            </div>

            <div className="brics-inst-meta">
              <span className="brics-inst-currency">{inst.currency}</span>
              {(inst.languages || []).map(l => (
                <span key={l} className="brics-inst-lang">{LANG_NAMES[l] || l}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
              Admin: {(inst.adminLevels || []).join(' → ')}
            </div>

            <div className="brics-inst-stats">
              <div className="brics-stat">
                <div className="brics-stat-v">{fmt(inst.population)}</div>
                <div className="brics-stat-l">Population in scope</div>
              </div>
              <div className="brics-stat">
                <div className="brics-stat-v">{inst.regions}</div>
                <div className="brics-stat-l">Administrative units</div>
              </div>
              <div className="brics-stat">
                <div className="brics-stat-v">{fmt(inst.citizenRequests)}</div>
                <div className="brics-stat-l">Citizen requests</div>
              </div>
              <div className="brics-stat">
                <div className="brics-stat-v">{inst.mappedInvestments}</div>
                <div className="brics-stat-l">Mapped investments</div>
              </div>
            </div>

            <button
              className="brics-switch-btn"
              disabled={activeId === inst.instanceId || switching}
              onClick={() => switchTo(inst.instanceId)}
            >
              {activeId === inst.instanceId ? '✓ Currently Active' : switching ? 'Switching…' : `→ Switch to ${inst.country} Instance`}
            </button>
          </div>
        ))}
      </div>

      {/* Switched instance live overview */}
      {switchedOverview && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Live Policy Intelligence — {switched?.instance?.country}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
            Data computed by the <strong>same CivicAI pipeline</strong> — demand aggregation, gap analysis, investment alignment and priority ranking all running in {switched?.instance?.currency?.code}.
          </div>
          <div className="brics-overview-grid">
            <div className="brics-ov-card">
              <div className="brics-ov-val">{fmt(switchedOverview.totals?.citizenRequests)}</div>
              <div className="brics-ov-label">Citizen requests</div>
            </div>
            <div className="brics-ov-card">
              <div className="brics-ov-val">{fmt(switchedOverview.totals?.activeDemandClusters)}</div>
              <div className="brics-ov-label">Active demand clusters</div>
            </div>
            <div className="brics-ov-card">
              <div className="brics-ov-val">{fmt(switchedOverview.totals?.infrastructureGaps)}</div>
              <div className="brics-ov-label">High-severity gaps</div>
            </div>
            <div className="brics-ov-card">
              <div className="brics-ov-val">{switchedOverview.totals?.mappedBudgetFormatted || '—'}</div>
              <div className="brics-ov-label">Mapped investment budget</div>
            </div>
            <div className="brics-ov-card">
              <div className="brics-ov-val">{fmt(switchedOverview.totals?.highPriorityProjects)}</div>
              <div className="brics-ov-label">Priority items (P1/P2)</div>
            </div>
            <div className="brics-ov-card">
              <div className="brics-ov-val">{fmt(switchedOverview.totals?.affectedPopulation)}</div>
              <div className="brics-ov-label">Residents in priority needs</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
