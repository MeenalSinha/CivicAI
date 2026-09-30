import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { policyAPI, createWebSocket } from '../api';
import PolicyMap from './PolicyMap';
import BRICSView from './BRICSView';
import ProvenanceView from './ProvenanceView';
import { policyStyles } from './policyStyles';
import { fmt, pct, signedPct, SeverityBadge, PriorityBadge, ReviewBadge, Bar, Kpi, Loading, ErrorBox, Empty, Spark, SyntheticBanner, useAsync, catColor } from './ui';

const TABS = [
  ['overview', 'National overview'], ['map', 'Geographic intelligence'], ['priorities', 'Development priorities'],
  ['trends', 'Trend intelligence'], ['investment', 'Investment & outcomes'], ['ask', 'Ask CivicAI'],
  ['governance', 'Governance & review'], ['provenance', 'Data Provenance'], ['brics', '🌐 BRICS Interop']
];

export default function PolicyDashboard({ user, initialTab = 'overview', embedded = false, focusProjectId = null }) {
  const [tab, setTab] = useState(initialTab);
  const [selected, setSelected] = useState(focusProjectId);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(null);
  const [activeCountry, setActiveCountry] = useState(null);
  const overview = useAsync(() => policyAPI.overview(), [tick]);
  const canDecide = ['policymaker', 'admin'].includes(user?.role);

  useEffect(() => createWebSocket(({ event, data }) => {
    if (event === 'intelligence_updated') { setLive(new Date()); setTick(t => t + 1); }
    if (event === 'recommendation_reviewed') setTick(t => t + 1);
    if (event === 'instance_switched') { setActiveCountry(data?.country); setTick(t => t + 1); }
  }), []);
  useEffect(() => { if (focusProjectId) setSelected(focusProjectId); }, [focusProjectId]);

  const handleInstanceSwitch = useCallback((result) => {
    setActiveCountry(result?.instance?.country);
    setTick(t => t + 1);
  }, []);

  return (
    <div className="pi">
      <style>{policyStyles}</style>
      {!embedded && (
        <div className="pi-head">
          <div>
            <div className="pi-title">Development Demand Intelligence</div>
            <div className="pi-sub">Citizen requests, structured as population-level development signals: demand clusters, infrastructure gaps, investment alignment and transparent priorities. Recommendations support policymaking and require human review.</div>
          </div>
          <div className="pi-muted" aria-live="polite">
            {activeCountry && <span style={{ background: '#eff4ff', color: '#1a56db', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, marginRight: 8 }}>{activeCountry}</span>}
            {overview.data?.instance?.name}{live ? ` · updated ${live.toLocaleTimeString()}` : ''}
          </div>
        </div>
      )}
      <SyntheticBanner overview={overview.data} />
      <div className="pi-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`pi-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}{id === 'governance' && overview.data?.review?.pending ? <span className="pi-count">{overview.data.review.pending}</span> : null}
          </button>
        ))}
      </div>
      <ErrorBox error={overview.error} onRetry={overview.reload} />
      {tab === 'overview' && <Overview o={overview.data} loading={overview.loading} onOpen={setSelected} goto={setTab} />}
      {tab === 'map' && <MapTab tick={tick} onOpen={setSelected} />}
      {tab === 'priorities' && <Priorities tick={tick} onOpen={setSelected} selected={selected} />}
      {tab === 'trends' && <Trends tick={tick} />}
      {tab === 'investment' && <Investment tick={tick} />}
      {tab === 'ask' && <Ask onOpen={setSelected} />}
      {tab === 'governance' && <Governance user={user} tick={tick} canDecide={canDecide} onChanged={() => setTick(t => t + 1)} onOpen={setSelected} />}
      {tab === 'provenance' && <ProvenanceView />}
      {tab === 'brics' && <BRICSView onSwitchedInstance={handleInstanceSwitch} />}
      {selected && <Drawer id={selected} onClose={() => setSelected(null)} canDecide={canDecide} onChanged={() => setTick(t => t + 1)} tick={tick} />}
    </div>
  );
}

/* ------------------------------ Overview ------------------------------ */
function Overview({ o, loading, onOpen, goto }) {
  if (loading && !o) return <Loading what="overview" />;
  if (!o) return null;
  const t = o.totals, cov = o.investmentCoverage, ti = o.trendIndicators;
  if (!t.citizenRequests) return <Empty>No citizen requests yet. Requests submitted through the citizen portal appear here as structured development signals.</Empty>;
  return (
    <>
      <div className="pi-grid pi-kpis">
        <Kpi value={fmt(t.citizenRequests)} label="Citizen requests" note={`${fmt(t.duplicatesMerged)} duplicates merged · ${t.awaitingLocation} awaiting location`} />
        <Kpi value={fmt(t.activeDemandClusters)} label="Active demand clusters" note="3+ requests, last 45 days" />
        <Kpi value={fmt(t.infrastructureGaps)} label="High-severity infrastructure gaps" note={`of ${t.assessedGaps} region-sector pairs assessed`} />
        <Kpi value={fmt(t.highPriorityRegions)} label="High-priority regions" note={`${t.highPriorityProjects} priority items (P1/P2)`} />
        <Kpi value={fmt(t.affectedPopulation)} label="Residents in high-priority needs" note="largest need per region; no double counting" />
        <Kpi value={cov.share == null ? '—' : pct(cov.share)} label="High demand with mapped investment" note={`${cov.withMappedInvestment} of ${cov.highDemandNeeds} high-demand needs`} />
        <Kpi value={t.mappedBudgetFormatted} label="Mapped public investment" note={`${t.mappedInvestments} projects in loaded datasets`} />
        <Kpi value={ti.weeklyRequests.change == null ? '—' : signedPct(ti.weeklyRequests.change)} label="Weekly request trend" note={`${ti.weeklyRequests.last7Days} vs ${ti.weeklyRequests.previous7Days} previous 7 days`} />
      </div>
      <div className="pi-grid pi-two" style={{ marginTop: 12 }}>
        <div className="pi-card">
          <h3>Top development priorities</h3>
          <table className="pi-table"><thead><tr><th>#</th><th>Region</th><th>Need</th><th className="pi-num">Score</th><th>Band</th><th className="pi-num">Residents affected</th></tr></thead>
            <tbody>{o.topPriorities.map(p => (
              <tr key={p.id} className="click" tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={e => e.key === 'Enter' && onOpen(p.id)}>
                <td>{p.rank}</td><td><b>{p.region}</b></td><td>{p.categoryLabel}</td><td className="pi-num">{p.priorityScore}</td><td><PriorityBadge band={p.band} /></td><td className="pi-num">{fmt(p.affectedPopulation)}</td>
              </tr>))}</tbody></table>
          <div style={{ marginTop: 10 }}><button className="pi-btn ghost sm" onClick={() => goto('priorities')}>All priorities</button></div>
        </div>
        <div className="pi-card">
          <h3>Investment alignment</h3>
          {Object.entries(cov.byClass).map(([k, v]) => (
            <div key={k} style={{ marginBottom: 9 }}><div className="pi-row sp" style={{ fontSize: 12.5 }}><span>{v.label}</span><b>{v.count}</b></div><Bar value={v.count} max={Math.max(...Object.values(cov.byClass).map(x => x.count))} /></div>))}
          <div className="pi-muted" style={{ marginTop: 8 }}>Coverage reflects only projects present in the loaded datasets; it is not a judgement of effectiveness.</div>
        </div>
      </div>
      <div className="pi-grid pi-three" style={{ marginTop: 12 }}>
        <div className="pi-card"><h3>Trend indicators</h3>
          {[['Emerging needs', ti.emerging], ['Rapidly growing', ti.rapidlyGrowing], ['Persistent problems', ti.persistent], ['Declining demand', ti.declining]].map(([l, n]) => <div key={l} className="pi-row sp" style={{ padding: '4px 0', fontSize: 13 }}><span>{l}</span><b>{n}</b></div>)}
          <button className="pi-btn ghost sm" style={{ marginTop: 8 }} onClick={() => goto('trends')}>View trends</button></div>
        <div className="pi-card"><h3>Channels & languages</h3>
          <div className="pi-muted" style={{ marginBottom: 6 }}>Channels</div>{Object.entries(o.mix.channels).map(([k, v]) => <span key={k} className="pi-badge pi-b-neutral" style={{ marginRight: 6 }}>{k} {v}</span>)}
          <div className="pi-muted" style={{ margin: '10px 0 6px' }}>Languages</div>{Object.entries(o.mix.languages).map(([k, v]) => <span key={k} className="pi-badge pi-b-info" style={{ marginRight: 6 }}>{k} {v}</span>)}</div>
        <div className="pi-card"><h3>Human review</h3>
          <div className="pi-row sp" style={{ fontSize: 13, padding: '4px 0' }}><span>Recommendations pending</span><b>{o.review.pending}</b></div>
          <div className="pi-row sp" style={{ fontSize: 13, padding: '4px 0' }}><span>Approved</span><b>{o.review.approved}</b></div>
          <div className="pi-row sp" style={{ fontSize: 13, padding: '4px 0' }}><span>Requests needing classification review</span><b>{o.review.needsClassificationReview}</b></div>
          <div className="pi-muted" style={{ marginTop: 8 }}>Scoring weights {o.weightsVersion}. Last analysis: {o.lastPipelineRun ? new Date(o.lastPipelineRun.finishedAt).toLocaleString() : '—'}.</div></div>
      </div>
    </>
  );
}

/* ------------------------------ Map ------------------------------ */
function MapTab({ tick, onOpen }) {
  const [cat, setCat] = useState('');
  const [layers, setLayers] = useState({ requests: true, hotspots: true, gaps: false, density: false, investments: false, recommended: true });
  const [sel, setSel] = useState(null);
  const meta = useAsync(() => policyAPI.meta(), []);
  const geo = useAsync(() => policyAPI.geo(cat ? { category: cat, sector: cat } : {}), [cat, tick]);
  const toggle = k => setLayers(l => ({ ...l, [k]: !l[k] }));
  const region = geo.data?.regions.find(r => r.id === sel);
  const regionGaps = useAsync(() => (sel ? policyAPI.gaps({ regionId: sel }) : Promise.resolve(null)), [sel, tick]);
  const L = [['requests', 'Citizen requests', 'Aggregated to a 500 m privacy grid; cells with fewer than k requests are hidden'], ['hotspots', 'Demand hotspots', 'Spatial clusters of 3+ similar requests'], ['gaps', 'Infrastructure gaps', 'Region gap severity vs benchmark'], ['density', 'Population density', 'Residents per km²'], ['investments', 'Public investments', 'Mapped projects by stage'], ['recommended', 'Recommended projects', 'Ranked priority items']];
  return (
    <>
      <ErrorBox error={geo.error} onRetry={geo.reload} />
      <div className="pi-mapwrap">
        <div className="pi-card">
          <h3>Layers</h3>
          {L.map(([k, l, d]) => <label key={k} className="pi-layer"><input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /><span><b>{l}</b><br /><span className="pi-muted">{d}</span></span></label>)}
          <h3 style={{ marginTop: 14 }}>Development need</h3>
          <select className="pi-input" value={cat} onChange={e => setCat(e.target.value)} aria-label="Filter by development need">
            <option value="">All needs</option>{meta.data?.taxonomy.filter(c => c.id !== 'other').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <h3 style={{ marginTop: 14 }}>Legend</h3>
          <div className="pi-legend">
            <div>Gap severity: <span className="pi-swatch" style={{ background: '#a4262c' }} />critical <span className="pi-swatch" style={{ background: '#c2570c' }} />high <span className="pi-swatch" style={{ background: '#c9a227' }} />moderate <span className="pi-swatch" style={{ background: '#3f8a63' }} />low</div>
            <div>Investment stage: <span className="pi-swatch" style={{ background: '#3f8a63' }} />completed <span className="pi-swatch" style={{ background: '#12406d' }} />ongoing <span className="pi-swatch" style={{ background: '#8a6d00' }} />tender <span className="pi-swatch" style={{ background: '#a4262c' }} />stalled</div>
          </div>
        </div>
        <div>{geo.loading && !geo.data ? <Loading what="map" /> : geo.data && <PolicyMap geo={geo.data} layers={layers} selectedRegionId={sel} onSelectRegion={setSel} onSelectProject={onOpen} />}
          {geo.data && <div className="pi-muted" style={{ marginTop: 6 }}>{geo.data.suppressedRequests} requests in sparse cells are counted in totals but not drawn (k-anonymity ≥ {geo.data.kAnonymity}). Map data © OpenStreetMap contributors.</div>}</div>
        <div className="pi-card">
          <h3>{region ? region.name : 'Region detail'}</h3>
          {!region ? <div className="pi-muted">Select a region on the map.</div> : (
            <>
              <div className="pi-kv"><span><b>Population</b>{fmt(region.population)}</span><span><b>Density</b>{fmt(region.density)}/km²</span></div>
              <div className="pi-kv"><span><b>Gap severity</b>{region.gapSeverity ?? '—'} <SeverityBadge band={region.gapBand} /></span></div>
              {region.worstSector && <div className="pi-kv"><span><b>Largest gap</b>{region.worstSector.label}</span></div>}
              {region.topDemand && <div className="pi-kv"><span><b>Top demand</b>{region.topDemand.label} ({region.topDemand.demandScore})</span></div>}
              <div className="pi-sect">Infrastructure availability vs benchmark</div>
              {regionGaps.loading && !regionGaps.data ? <div className="pi-muted">Loading…</div> : !regionGaps.data?.gaps.filter(g => g.availability != null).length ? <div className="pi-muted">No infrastructure indicators loaded.</div> : regionGaps.data.gaps.filter(g => g.availability != null).sort((a, b) => a.availability - b.availability).slice(0, 6).map(g => (
                <div key={g.id} style={{ marginBottom: 6 }}><div className="pi-row sp" style={{ fontSize: 12 }}><span>{g.sectorLabel}</span><b>{pct(g.availability)}</b></div><Bar value={g.availability} color={g.availability < 0.5 ? '#a4262c' : g.availability < 0.75 ? '#c2570c' : '#3f8a63'} /></div>))}
              <div className="pi-sect">Mapped investments</div>
              {region.investments.length ? region.investments.map(i => <div key={i.id} style={{ fontSize: 12.5, marginBottom: 6 }}><b>{i.name}</b><br /><span className="pi-muted">{i.stage} · {i.budgetFormatted} · covers {Math.round(i.share * 100)}%</span></div>) : <div className="pi-muted">No mapped projects for this selection.</div>}
              <div className="pi-sect">Recommended</div>
              {geo.data.recommended.filter(r => r.regionId === region.id).map(r => <div key={r.id}><button className="pi-btn ghost sm" style={{ marginBottom: 6 }} onClick={() => onOpen(r.id)}>#{r.rank} {r.categoryLabel} · {r.priorityScore}</button></div>)}
            </>)}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Priorities ------------------------------ */
function Priorities({ tick, onOpen, selected }) {
  const [band, setBand] = useState(''), [cat, setCat] = useState(''), [region, setRegion] = useState('');
  const meta = useAsync(() => policyAPI.meta(), []);
  const regions = useAsync(() => policyAPI.regions(), []);
  const q = useAsync(() => policyAPI.priorities({ band, category: cat, regionId: region, limit: 60 }), [band, cat, region, tick]);
  return (
    <>
      <div className="pi-filters">
        <select className="pi-input" value={band} onChange={e => setBand(e.target.value)} aria-label="Priority band"><option value="">All bands</option><option value="P1">P1 Critical</option><option value="P2">P2 High</option><option value="P3">P3 Medium</option><option value="P4">P4 Watch</option></select>
        <select className="pi-input" value={cat} onChange={e => setCat(e.target.value)} aria-label="Development need"><option value="">All needs</option>{meta.data?.taxonomy.filter(c => c.id !== 'other').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <select className="pi-input" value={region} onChange={e => setRegion(e.target.value)} aria-label="Region"><option value="">All regions</option>{regions.data?.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <span className="pi-muted">Select a row for the full evidence trail.</span>
      </div>
      <ErrorBox error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading what="priorities" /> : !q.data?.priorities.length ? <Empty>No priority items match these filters.</Empty> : (
        <div className="pi-card" style={{ overflowX: 'auto' }}>
          <table className="pi-table">
            <thead><tr><th>#</th><th>Region</th><th>Development need</th><th className="pi-num">Demand</th><th className="pi-num">Gap</th><th className="pi-num">Residents affected</th><th>Existing investment</th><th>Recommended intervention</th><th>Score</th><th>Review</th></tr></thead>
            <tbody>{q.data.priorities.map(p => (
              <tr key={p.id} className={`click ${selected === p.id ? 'sel' : ''}`} tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={e => e.key === 'Enter' && onOpen(p.id)}>
                <td>{p.rank}</td><td><b>{p.region}</b></td><td>{p.categoryLabel}</td>
                <td className="pi-num">{p.demandScore ?? '—'}<div className="pi-muted">{p.requestCount} req · {signedPct(p.growthRate)}</div></td>
                <td className="pi-num">{p.infrastructureGap?.gap != null ? pct(p.infrastructureGap.gap) : 'n/a'}{p.infrastructureGap && <div><SeverityBadge band={p.infrastructureGap.band} /></div>}</td>
                <td className="pi-num">{fmt(p.affectedPopulation)}</td>
                <td style={{ maxWidth: 200 }}>{p.existingInvestment?.label || '—'}{p.existingInvestment?.projects?.[0] && <div className="pi-muted">{p.existingInvestment.projects[0].name} ({p.existingInvestment.projects[0].stage})</div>}</td>
                <td style={{ maxWidth: 240 }}>{p.proposedIntervention}<div className="pi-muted">{p.responsibleDepartment}</div></td>
                <td><b>{p.priorityScore}</b><div><PriorityBadge band={p.band} /></div><div className="pi-muted">conf {pct(p.confidence)}</div></td>
                <td><ReviewBadge status={p.reviewStatus} /></td>
              </tr>))}</tbody>
          </table>
        </div>)}
    </>
  );
}

/* ------------------------------ Explainability drawer ------------------------------ */
function Drawer({ id, onClose, canDecide, onChanged, tick }) {
  const d = useAsync(() => policyAPI.priority(id), [id, tick]);
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState(null), [err, setErr] = useState(null);
  const [asking, setAsking] = useState(false), [why, setWhy] = useState(null);
  useEffect(() => { const h = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const review = async (status) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await policyAPI.reviewRecommendation(id, status, note); setMsg(`Recorded: ${status.replace('_', ' ')}. This action is audit-logged.`); setNote(''); onChanged(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const askWhy = async () => {
    if (!d.data) return; setAsking(true); setErr(null);
    try { setWhy(await policyAPI.query('Why was this region prioritized?', { regionId: d.data.project.regionId, category: d.data.project.category })); } catch (e) { setErr(e); } finally { setAsking(false); }
  };
  const p = d.data?.project, rec = d.data?.recommendation;
  return (
    <aside className="pi-drawer" role="dialog" aria-label="Recommendation evidence trail">
      <div className="pi-drawer-h">
        <div>{p ? <><div className="pi-title" style={{ fontSize: 17 }}>{p.region} · {p.categoryLabel}</div><div className="pi-row" style={{ marginTop: 6 }}><PriorityBadge band={p.band} /><b>{p.priorityScore}/100</b><span className="pi-muted">rank #{p.rank} · confidence {pct(p.confidence)}</span>{rec && <ReviewBadge status={rec.status} />}</div></> : <span>Loading…</span>}</div>
        <button className="pi-btn ghost sm" onClick={onClose} aria-label="Close">Close</button>
      </div>
      <div className="pi-drawer-b">
        <ErrorBox error={d.error || err} onRetry={d.reload} />
        {d.loading && !d.data && <Loading what="evidence" />}
        {d.data && <>
          <div className="pi-card" style={{ background: 'var(--pi-accent-soft)', borderColor: '#c1d3e6' }}>
            <div className="pi-answer">{p.rationale}</div>
            <div className="pi-kv"><span><b>Proposed intervention</b>{p.proposedIntervention}</span></div>
            <div className="pi-kv"><span><b>Responsible department</b>{p.responsibleDepartment}</span><span><b>Residents affected</b>{fmt(p.affectedPopulation)}</span></div>
          </div>
          <div className="pi-row" style={{ margin: '10px 0' }}><button className="pi-btn ghost sm" disabled={asking} onClick={askWhy}>{asking ? 'Asking…' : 'Ask CivicAI: why was this prioritized?'}</button></div>
          {why && <div className="pi-card" style={{ marginBottom: 10 }}><div className="pi-answer">{why.narration?.verified ? why.narration.text : why.answer}</div><div className="pi-muted" style={{ marginTop: 6 }}>{why.narration?.verified ? `Rephrased by ${why.narration.model}; every figure verified against the data.` : 'Deterministic explanation generated from stored evidence.'}</div></div>}
          <div className="pi-sect">Evidence trail</div>
          {rec?.evidenceTrail.map(s => (
            <div className="pi-step" key={s.step}><div className="n">{s.step}</div><div><div className="t">{s.title}</div><div className="d">{s.detail}</div>
              {s.table && <table className="pi-table" style={{ marginTop: 6 }}><thead><tr><th>Factor</th><th className="pi-num">Value</th><th className="pi-num">Weight</th><th className="pi-num">Points</th></tr></thead><tbody>{s.table.map(r => <tr key={r.factor}><td>{r.factor}</td><td className="pi-num">{r.value}</td><td className="pi-num">{r.weight}</td><td className="pi-num"><b>{r.contribution}</b></td></tr>)}</tbody></table>}
              {s.projects?.length > 0 && <div style={{ marginTop: 6 }}>{s.projects.map(m => <div key={m.id} className="pi-muted">• {m.name} — {m.stage}, covers {Math.round(m.share * 100)}%{m.isSynthetic ? ' (synthetic)' : ''}</div>)}</div>}
            </div></div>))}
          {d.data.demand && <><div className="pi-sect">Weekly request volume (last {d.data.demand.weeklySeries.length} weeks)</div><Spark data={d.data.demand.weeklySeries} width={300} height={40} /></>}
          <div className="pi-sect">AI decision traceability</div>
          <div className="pi-muted" style={{ lineHeight: 1.6 }}>Scores computed programmatically ({rec?.modelTrace?.engine}); LLM used for scores: <b>{String(rec?.modelTrace?.llmUsedForScores)}</b>. Classifier: {rec?.modelTrace?.classifier}. Weights {rec?.modelTrace?.weightsVersion}. Computed {rec?.modelTrace?.computedAt && new Date(rec.modelTrace.computedAt).toLocaleString()}.</div>
          <div className="pi-sect">Human review</div>
          {msg && <div className="pi-ok">{msg}</div>}
          {rec?.reviewer && <div className="pi-muted" style={{ marginBottom: 6 }}>Last review by {rec.reviewer}{rec.reviewedAt ? ` on ${new Date(rec.reviewedAt).toLocaleString()}` : ''}{rec.reviewNote ? ` — “${rec.reviewNote}”` : ''}</div>}
          {canDecide ? <>
            <textarea className="pi-input" rows={2} placeholder="Reviewer note (required to reject or request more information)" value={note} onChange={e => setNote(e.target.value)} aria-label="Reviewer note" />
            <div className="pi-row" style={{ marginTop: 8 }}><button className="pi-btn sm" disabled={busy} onClick={() => review('approved')}>Approve for consideration</button><button className="pi-btn ghost sm" disabled={busy} onClick={() => review('needs_info')}>Request more information</button><button className="pi-btn danger sm" disabled={busy} onClick={() => review('rejected')}>Reject</button></div>
          </> : <div className="pi-muted">Your role has read-only access to recommendations.</div>}
          <div className="pi-muted" style={{ marginTop: 10 }}>Decision-support only: this recommendation is not binding and does not commit any funds.</div>
        </>}
      </div>
    </aside>
  );
}

/* ------------------------------ Trends ------------------------------ */
function Trends({ tick }) {
  const t = useAsync(() => policyAPI.trends(), [tick]);
  if (t.loading && !t.data) return <Loading what="trends" />;
  if (t.error) return <ErrorBox error={t.error} onRetry={t.reload} />;
  const groups = [['Emerging demand', t.data.emerging, 'New needs appearing in the latest window'], ['Rapidly growing', t.data.rapidlyGrowing, `≥50% growth over ${t.data.windowDays} days`], ['Persistent problems', t.data.persistent, `Reported in most of the last ${t.data.weeks} weeks`], ['Declining demand', t.data.declining, 'Fewer requests than the prior window']];
  return (
    <div className="pi-grid pi-two">
      {groups.map(([title, items, note]) => (
        <div className="pi-card" key={title}>
          <h3>{title} <span style={{ textTransform: 'none', fontWeight: 400 }}>· {note}</span></h3>
          {!items.length ? <div className="pi-muted">None in the current data.</div> : (
            <table className="pi-table"><tbody>{items.slice(0, 6).map(x => (
              <tr key={x.id}><td><b>{x.region}</b><div className="pi-muted">{x.categoryLabel}</div></td><td><Spark data={x.weeklySeries} color={catColor(x.category)} /></td>
                <td className="pi-num">{x.priorCount} → {x.recentCount}<div className="pi-muted">{x.priorCount === 0 ? 'new' : signedPct(x.growthRate)}</div></td></tr>))}</tbody></table>)}
        </div>))}
    </div>
  );
}

/* ------------------------------ Investment & outcomes ------------------------------ */
function Investment({ tick }) {
  const inv = useAsync(() => policyAPI.investments(), [tick]);
  const out = useAsync(() => policyAPI.outcomes(), [tick]);
  if (inv.loading && !inv.data) return <Loading what="investment data" />;
  if (inv.error) return <ErrorBox error={inv.error} onRetry={inv.reload} />;
  const s = out.data?.service;
  return (
    <>
      <div className="pi-card" style={{ marginBottom: 12 }}>
        <h3>Alignment of citizen demand and mapped investment</h3>
        {!inv.data.alignments.length ? <Empty>No alignment signals yet.</Empty> : <div style={{ overflowX: 'auto' }}><table className="pi-table"><thead><tr><th>Region</th><th>Need</th><th>Finding</th><th className="pi-num">Mapped coverage</th><th>Mapped projects</th></tr></thead>
          <tbody>{inv.data.alignments.map(a => <tr key={a.id}><td><b>{a.region}</b></td><td>{a.categoryLabel}</td><td><span className={`pi-badge ${a.classification === 'investment_aligned' ? 'pi-b-low' : a.classification === 'potentially_underserved' ? 'pi-b-mod' : 'pi-b-high'}`}>{a.label}</span>{a.overlap && <span className="pi-badge pi-b-info" style={{ marginLeft: 6 }}>Possible overlap</span>}</td><td className="pi-num">{pct(a.coverage)}</td><td>{a.matched.map(m => <div key={m.id}>{m.name} <span className="pi-muted">({m.stage})</span></div>)}</td></tr>)}</tbody></table></div>}
        <div className="pi-muted" style={{ marginTop: 8 }}>Neutral findings only. “Limited mapped coverage” means the loaded datasets show little or no project coverage — it is not evidence that an investment is ineffective.</div>
      </div>
      <div className="pi-grid pi-two">
        <div className="pi-card"><h3>Mapped investments ({inv.data.projects.length})</h3><div style={{ overflowX: 'auto' }}><table className="pi-table"><thead><tr><th>Project</th><th>Stage</th><th className="pi-num">Budget</th><th className="pi-num">Target pop.</th></tr></thead>
          <tbody>{inv.data.projects.map(p => <tr key={p.id}><td><b>{p.name}</b><div className="pi-muted">{p.regions.map(r => r.name).join(', ')}{p.isSynthetic ? ' · synthetic' : ''}</div></td><td><span className="pi-badge pi-b-neutral">{p.stage}</span></td><td className="pi-num">{p.budgetFormatted}</td><td className="pi-num">{fmt(p.targetPopulation)}</td></tr>)}</tbody></table></div></div>
        <div className="pi-card"><h3>Outcome measurement</h3>
          {out.loading && !out.data ? <Loading what="outcomes" /> : out.error ? <ErrorBox error={out.error} /> : <>
            <div className="pi-kv"><span><b>Complaints resolved</b>{s.resolved}/{s.complaintsTotal}</span><span><b>Avg resolution</b>{s.avgResolutionHours ?? '—'} h</span><span><b>Satisfaction</b>{s.avgSatisfaction ? `${s.avgSatisfaction}/5 (${s.feedbackCount})` : 'no feedback yet'}</span></div>
            <div className="pi-sect">Demand before vs after completed projects</div>
            {!out.data.projectOutcomes.length ? <div className="pi-muted">No completed project has enough requests to compare.</div> : out.data.projectOutcomes.map(o => (
              <div key={o.investmentId + o.regionId} style={{ marginBottom: 10, fontSize: 12.5 }}><b>{o.name}</b> — {o.region}<br />{o.requestsBefore} requests in the 45 days before → {o.requestsAfter} after completion {o.change != null && <b>({signedPct(o.change)})</b>}<div className="pi-muted">{o.note}</div></div>))}</>}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Ask CivicAI ------------------------------ */
function Ask({ onOpen }) {
  const meta = useAsync(() => policyAPI.meta(), []);
  const [q, setQ] = useState(''), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const [history, setHistory] = useState([]);
  const ask = async (text) => {
    const question = (text ?? q).trim(); if (!question) return;
    setBusy(true); setErr(null); setQ(question);
    try { const r = await policyAPI.query(question); setRes(r); setHistory(h => [{ q: question, r }, ...h].slice(0, 6)); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="pi-grid pi-two">
      <div className="pi-card">
        <h3>Policy question</h3>
        <div className="pi-row"><input className="pi-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && !busy && ask()} placeholder="e.g. Which regions have high citizen demand but limited mapped investment coverage?" aria-label="Policy question" maxLength={400} /><button className="pi-btn" disabled={busy || !q.trim()} onClick={() => ask()}>{busy ? 'Analysing…' : 'Ask'}</button></div>
        <div style={{ marginTop: 10 }}>{(meta.data?.examples || []).map(e => <button key={e} className="pi-chip" onClick={() => ask(e)}>{e}</button>)}</div>
        <ErrorBox error={err} />
        {res && <div style={{ marginTop: 12 }}>
          <div className="pi-answer">{res.narration?.verified ? res.narration.text : res.answer}</div>
          {res.narration?.verified && <div className="pi-muted" style={{ marginTop: 6 }}>Rephrased by {res.narration.model}. Every figure was verified against the query result; original answer: {res.answer}</div>}
          {res.narration?.rejected && <div className="pi-muted" style={{ marginTop: 6 }}>{res.narration.reason}</div>}
          {res.table && <div style={{ overflowX: 'auto', marginTop: 10 }}><table className="pi-table"><thead><tr>{res.table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{res.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>)}</tbody></table></div>}
          {res.projectId && <button className="pi-btn ghost sm" style={{ marginTop: 8 }} onClick={() => onOpen(res.projectId)}>Open full evidence trail</button>}
          {res.examples && <div className="pi-muted" style={{ marginTop: 8 }}>Answers are limited to what the loaded data supports.</div>}
          <div className="pi-muted" style={{ marginTop: 8 }}>Method: {res.method}{res.filters?.category ? ` · need: ${res.filters.category}` : ''}{res.filters?.region ? ` · region: ${res.filters.region}` : ''}</div>
        </div>}
      </div>
      <div className="pi-card"><h3>How answers are produced</h3>
        <div className="pi-muted" style={{ lineHeight: 1.7 }}>1. The question is parsed into an intent, a development need and a region.<br />2. The answer is computed from demand, gap, investment and priority tables — never generated freehand.<br />3. Any language-model rephrasing is discarded if it contains a figure that is not in the data.<br />4. Questions the data cannot support are declined rather than guessed.</div>
        {history.length > 1 && <><div className="pi-sect">Recent questions</div>{history.slice(1).map((h, i) => <button key={i} className="pi-chip" onClick={() => { setQ(h.q); setRes(h.r); }}>{h.q.slice(0, 60)}</button>)}</>}
      </div>
    </div>
  );
}

/* ------------------------------ Governance ------------------------------ */
function Governance({ user, tick, canDecide, onChanged, onOpen }) {
  const isAdmin = user?.role === 'admin';
  const recs = useAsync(() => policyAPI.reviewQueue(), [tick]);
  const reqs = useAsync(() => (canDecide ? policyAPI.requestsToReview() : Promise.resolve({ requests: [] })), [tick, canDecide]);
  const sources = useAsync(() => policyAPI.datasets(), [tick]);
  const meta = useAsync(() => policyAPI.meta(), []);
  const weights = useAsync(() => policyAPI.getWeights(), [tick]);
  const audit = useAsync(() => (isAdmin ? policyAPI.audit({ limit: 25 }) : Promise.resolve(null)), [tick, isAdmin]);
  const [msg, setMsg] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState({});
  const run = async (fn, ok) => { setBusy(true); setErr(null); setMsg(null); try { await fn(); setMsg(ok); onChanged(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const reclass = (id, val) => { const [c, s] = val.split('.'); run(() => policyAPI.reclassify(id, c, s), 'Classification corrected and analysis refreshed.'); };
  return (
    <>
      <ErrorBox error={err} />{msg && <div className="pi-ok">{msg}</div>}
      <div className="pi-grid pi-two">
        <div className="pi-card"><h3>Recommendation review queue</h3>
          {recs.loading && !recs.data ? <Loading /> : !recs.data?.recommendations.length ? <Empty>No recommendations.</Empty> : <div style={{ maxHeight: 360, overflowY: 'auto' }}><table className="pi-table"><tbody>{recs.data.recommendations.slice(0, 25).map(r => (
            <tr key={r.projectId} className="click" onClick={() => onOpen(r.projectId)}><td>{r.priority.rank}</td><td><b>{r.priority.region}</b><div className="pi-muted">{r.priority.categoryLabel}</div></td><td><PriorityBadge band={r.priority.band} /></td><td><ReviewBadge status={r.status} /></td></tr>))}</tbody></table></div>}
        </div>
        <div className="pi-card"><h3>Requests needing classification review</h3>
          {!canDecide ? <div className="pi-muted">Available to policymaker and admin roles.</div> : reqs.loading && !reqs.data ? <Loading /> : !reqs.data?.requests.length ? <Empty>Nothing awaiting review.</Empty> : <div style={{ maxHeight: 360, overflowY: 'auto' }}>{reqs.data.requests.slice(0, 8).map(r => (
            <div key={r.id} style={{ borderBottom: '1px solid #eef1f5', padding: '8px 0', fontSize: 12.5 }}>
              <div>“{r.text}”</div><div className="pi-muted">{r.language} · now {r.category} · {r.reason}</div>
              <select className="pi-input" style={{ marginTop: 6 }} defaultValue="" disabled={busy} onChange={e => e.target.value && reclass(r.id, e.target.value)} aria-label="Correct classification">
                <option value="">Correct classification…</option>{meta.data?.taxonomy.map(c => <optgroup key={c.id} label={c.label}>{c.subcategories.map(s => <option key={s.id} value={`${c.id}.${s.id}`}>{s.label}</option>)}</optgroup>)}</select></div>))}</div>}
          <div className="pi-muted" style={{ marginTop: 8 }}>Requests are shown with PII redacted and no identifiers.</div>
        </div>
      </div>
      <div className="pi-grid pi-two" style={{ marginTop: 12 }}>
        <div className="pi-card"><h3>Data sources</h3>
          {sources.data?.sources.map(s => <div key={s.id} style={{ padding: '6px 0', borderBottom: '1px solid #eef1f5', fontSize: 12.5 }}><b>{s.name}</b> {s.isSynthetic ? <span className="pi-badge pi-b-mod">SYNTHETIC</span> : <span className="pi-badge pi-b-low">External</span>}<div className="pi-muted">{s.kind} · adapter {s.adapter} · {s.recordCount} records · {s.status}</div></div>)}
          {sources.data && <div className="pi-muted" style={{ marginTop: 8 }}>Adapters available: {sources.data.adapters.join(', ')}.</div>}
          {isAdmin && <div className="pi-row" style={{ marginTop: 10 }}><button className="pi-btn ghost sm" disabled={busy} onClick={() => run(() => policyAPI.runPipeline(), 'Analysis pipeline re-run.')}>Re-run analysis</button><button className="pi-btn ghost sm" disabled={busy} onClick={() => run(() => policyAPI.resetDemo(), 'Synthetic demonstration dataset reloaded.')}>Reload demo dataset</button></div>}
        </div>
        <div className="pi-card"><h3>Scoring weights {weights.data ? `(${weights.data.weights.version})` : ''}</h3>
          {weights.data && ['demand', 'priority'].map(g => <div key={g} style={{ marginBottom: 10 }}><div className="pi-muted" style={{ marginBottom: 4 }}>{g === 'demand' ? 'Demand score' : 'Priority score'} (weights are normalised)</div>
            {Object.entries(weights.data.weights[g]).map(([k, v]) => <div key={k} className="pi-row sp" style={{ fontSize: 12.5, padding: '2px 0' }}><span>{k}</span>{isAdmin ? <input className="pi-input" style={{ width: 70, padding: '3px 6px' }} type="number" min="0" max="1" step="0.01" defaultValue={v} onChange={e => setEdit(s => ({ ...s, [g]: { ...(s[g] || {}), [k]: parseFloat(e.target.value) } }))} aria-label={`${g} weight ${k}`} /> : <b>{Number(v).toFixed(2)}</b>}</div>)}</div>)}
          {isAdmin ? <div className="pi-row"><button className="pi-btn sm" disabled={busy || !Object.keys(edit).length} onClick={() => run(async () => { await policyAPI.setWeights(edit); setEdit({}); }, 'Weights updated; analysis recomputed and change audit-logged.')}>Apply weights</button><button className="pi-btn ghost sm" disabled={busy} onClick={() => run(() => policyAPI.resetWeights(), 'Weights reset to defaults.')}>Reset</button></div> : <div className="pi-muted">Only administrators can change weights.</div>}
        </div>
      </div>
      {isAdmin && <div className="pi-card" style={{ marginTop: 12 }}><h3>Audit log {audit.data && <span style={{ textTransform: 'none' }}>· hash chain {audit.data.chain.valid ? 'verified' : 'BROKEN'} ({audit.data.chain.entries} entries)</span>}</h3>
        {audit.data && <div style={{ overflowX: 'auto' }}><table className="pi-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead><tbody>{audit.data.logs.map(l => <tr key={l.seq}><td className="pi-mono">{new Date(l.ts).toLocaleString()}</td><td>{l.actorType}{l.actorId ? `:${String(l.actorId).slice(0, 10)}` : ''}</td><td>{l.action}</td><td className="pi-muted">{l.entityType} {String(l.entityId || '').slice(0, 24)}</td></tr>)}</tbody></table></div>}</div>}
    </>
  );
}
