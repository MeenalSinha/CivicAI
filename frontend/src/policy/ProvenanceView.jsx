import React, { useState, useEffect } from 'react';
import { policyAPI } from '../api';
import { policyStyles } from './policyStyles';
import { Loading, ErrorBox } from './ui';

const styles = `
${policyStyles}
.prov-root { padding: 24px; font-family: 'Inter', sans-serif; }
.prov-title { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 8px; }
.prov-sub { font-size: 14px; color: #4b5563; max-width: 800px; line-height: 1.6; margin-bottom: 24px; }
.prov-grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media(min-width: 900px) { .prov-grid { grid-template-columns: 1fr 1fr; } }
.prov-card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
.prov-card.public { border-left: 4px solid #059669; }
.prov-card.synthetic { border-left: 4px solid #d97706; }
.prov-card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.prov-name { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px; }
.prov-badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.prov-badge.public { background: #f0fdf4; color: #059669; border: 1px solid #a7f3d0; }
.prov-badge.synthetic { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
.prov-meta-row { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #4b5563; }
.prov-meta-item { display: flex; align-items: baseline; gap: 8px; }
.prov-lbl { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 80px; flex-shrink: 0; }
`;

export default function ProvenanceView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    policyAPI.datasets()
      .then(res => setData(res))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="prov-root"><style>{styles}</style><Loading what="data provenance records" /></div>;
  if (error) return <div className="prov-root"><style>{styles}</style><ErrorBox error={error} /></div>;

  const sources = data?.sources || [];
  const publicSources = sources.filter(s => !s.isSynthetic);
  const syntheticSources = sources.filter(s => s.isSynthetic);

  return (
    <div className="prov-root">
      <style>{styles}</style>
      <div className="prov-title">Data Provenance & Traceability</div>
      <div className="prov-sub">
        CivicAI operates on a hybrid data foundation. It ingests authentic structural public datasets (administrative boundaries, population, infrastructure coverage, government budgets) and fuses them with live citizen request streams. For this demonstration, the structural datasets below simulate real-world public data imports, while the citizen requests are clearly isolated as synthetic demonstration data.
      </div>
      
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, marginTop: 32 }}>Authentic Structural Data Profiles (Simulated)</h3>
      <div className="prov-grid">
        {publicSources.map(s => (
          <div key={s.id} className="prov-card public">
            <div className="prov-card-head">
              <div>
                <div className="prov-name">{s.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>ID: {s.id}</div>
              </div>
              <div className="prov-badge public">PUBLIC — VERIFIED</div>
            </div>
            <div className="prov-meta-row">
              <div className="prov-meta-item"><span className="prov-lbl">License</span> {s.license}</div>
              <div className="prov-meta-item"><span className="prov-lbl">Source</span> {s.description || 'Open Data Portal'}</div>
              {s.publishedAt && <div className="prov-meta-item"><span className="prov-lbl">Date</span> {s.publishedAt}</div>}
              <div className="prov-meta-item"><span className="prov-lbl">Records</span> {s.recordCount} rows</div>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, marginTop: 32 }}>Live Interaction Data (Demonstration)</h3>
      <div className="prov-grid">
        {syntheticSources.map(s => (
          <div key={s.id} className="prov-card synthetic">
            <div className="prov-card-head">
              <div>
                <div className="prov-name">{s.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>ID: {s.id}</div>
              </div>
              <div className="prov-badge synthetic">DEMONSTRATION — SYNTHETIC</div>
            </div>
            <div className="prov-meta-row">
              <div className="prov-meta-item"><span className="prov-lbl">License</span> {s.license || 'Synthetic'}</div>
              <div className="prov-meta-item"><span className="prov-lbl">Source</span> {s.description || 'Synthetic generation pipeline'}</div>
              <div className="prov-meta-item"><span className="prov-lbl">Records</span> {s.recordCount} rows</div>
            </div>
          </div>
        ))}
        {syntheticSources.length === 0 && (
          <div className="prov-card synthetic">
            <div className="prov-card-head">
              <div><div className="prov-name">Synthetic Citizen Requests</div></div>
              <div className="prov-badge synthetic">DEMONSTRATION — SYNTHETIC</div>
            </div>
            <div className="prov-meta-row">
              <div className="prov-meta-item"><span className="prov-lbl">Note</span> Loaded dynamically via system streams</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
