import React, { useState, useEffect, useRef, useCallback } from 'react';
import { judgeAPI, policyAPI, bricsAPI, tokenStore } from '../api';
import PolicyMap from './PolicyMap';
import PolicyDashboard from './PolicyDashboard';
import { policyStyles } from './policyStyles';
import { fmt, pct, ErrorBox, Loading, PriorityBadge, SeverityBadge, catColor } from './ui';

const STEPS = [
  'Citizen submits a voice / text request', 'CivicAI transcribes or reads it', 'AI classifies the development need', 'Location is extracted',
  'Similar requests are clustered', 'Demand hotspot appears on the map', 'Infrastructure gap is calculated', 'Population affected is displayed',
  'Existing investment coverage is shown', 'Explainable priority recommendation is generated', 'Policymaker dashboard displays the opportunity', 'Policymaker asks: why was this region prioritized?'
];

const COUNTRY_FLAG = { IN: '🇮🇳', BR: '🇧🇷' };
const COUNTRY_NAME = { IN: 'India (NCR Demo)', BR: 'Brazil (São Paulo Demo)' };

const switchStyles = `
.jm-country-switcher {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 10px;
  background: #f6f9ff; border: 1px solid #c7d7fa;
  margin-bottom: 16px; flex-wrap: wrap;
}
.jm-country-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 8px; border: 1.5px solid #dde3ec;
  background: white; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; color: #374151;
}
.jm-country-btn:hover { border-color: #1a56db; color: #1a56db; }
.jm-country-btn.active { background: #1a56db; color: white; border-color: #1a56db; }
.jm-country-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.jm-provenance {
  background: white; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 14px 16px; margin-top: 12px;
}
.jm-provenance h5 { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.jm-prov-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; font-size: 12px; color: #374151; }
.jm-prov-key { font-weight: 600; min-width: 120px; color: #6b7280; }
.jm-synth-tag {
  display: inline-flex; align-items: center; gap: 4px;
  background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
  border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600;
}
`;

export default function JudgeMode({ onSession }) {
  const [status, setStatus] = useState(null), [scenario, setScenario] = useState(null), [error, setError] = useState(null);
  const [sampleId, setSampleId] = useState(null), [text, setText] = useState(''), [source, setSource] = useState('sample');
  const [busy, setBusy] = useState(false), [trace, setTrace] = useState(null), [shown, setShown] = useState(0), [auto, setAuto] = useState(true);
  const [geo, setGeo] = useState(null), [why, setWhy] = useState(null), [asking, setAsking] = useState(false), [dash, setDash] = useState(false);
  const [rec, setRec] = useState({ on: false, note: null });
  const [switching, setSwitching] = useState(false), [activeInst, setActiveInst] = useState(null);
  const media = useRef(null), chunks = useRef([]), runId = useRef(String(Date.now()));

  const loadScenario = useCallback(async () => {
    try {
      const sc = await judgeAPI.scenario();
      setScenario(sc);
      if (sc.instance) setActiveInst(sc.instance);
      const d = sc.voiceSamples.find(x => x.id === sc.defaultSample) || sc.voiceSamples[0];
      if (d) { setSampleId(d.id); setText(d.text); }
    } catch (e) { setError(e); }
  }, []);

  // Boot: check demo mode, open the demo policymaker session, load scenario
  useEffect(() => {
    (async () => {
      try {
        const st = await judgeAPI.status(); setStatus(st);
        if (!st.enabled) return;
        const s = await judgeAPI.session(); tokenStore.set(s.token); tokenStore.setOfficer(s.officer); onSession && onSession(s.officer);
        await loadScenario();
      } catch (e) { setError(e); }
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => { if (trace && auto && shown < STEPS.length) { const t = setTimeout(() => setShown(s => s + 1), 750); return () => clearTimeout(t); } }, [trace, shown, auto]);

  const chooseSample = (id) => { const s = scenario?.voiceSamples.find(x => x.id === id); if (s) { setSampleId(id); setText(s.text); setSource('sample'); } };

  const switchCountry = async (instanceId) => {
    setSwitching(true); setError(null); reset();
    try {
      await bricsAPI.switchInstance(instanceId);
      await loadScenario();
    } catch (e) { setError(e); } finally { setSwitching(false); }
  };

  const startRec = async () => {
    setRec({ on: false, note: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); chunks.current = [];
      mr.ondataavailable = e => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        setRec({ on: false, note: 'Transcribing with Whisper…' });
        try { const t = await judgeAPI.transcribe(b64, blob.type); setText(t.transcript); setSource('whisper'); setRec({ on: false, note: `Whisper detected language: ${t.language || 'unknown'}` }); }
        catch (e) { setRec({ on: false, note: `${e.message} You can still use a sample transcript or type the request.` }); }
      };
      mr.start(); media.current = mr; setRec({ on: true, note: 'Recording… speak in the instance language, then press Stop.' });
    } catch { setRec({ on: false, note: 'Microphone unavailable or permission denied. Use a sample transcript or type the request.' }); }
  };
  const stopRec = () => { media.current?.stop(); setRec(r => ({ ...r, on: false })); };

  const run = async () => {
    setBusy(true); setError(null); setTrace(null); setShown(0); setWhy(null); setDash(false); runId.current = String(Date.now());
    try {
      const r = await judgeAPI.submit(text, source, runId.current);
      if (r.duplicate) { setError(new Error(r.message)); return; }
      setTrace(r.trace); setShown(1);
      const g = await policyAPI.geo({}); setGeo(g);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const reset = () => { setTrace(null); setShown(0); setWhy(null); setDash(false); };

  const ask = async () => {
    setAsking(true);
    try { setWhy(await policyAPI.query('Why was this region prioritized?', { regionId: trace.request.regionId, category: trace.request.category })); }
    catch (e) { setError(e); } finally { setAsking(false); }
  };

  if (status && !status.enabled) return <div className="pi"><style>{policyStyles}</style><div className="pi-card"><h3>Judge Mode is disabled</h3><div className="pi-muted">This deployment runs with DEMO_MODE=false. Enable it (and the synthetic demonstration dataset) to run the guided walkthrough.</div></div></div>;
  if (!scenario && !error) return <Loading what="Judge Mode" />;

  const r = trace?.request, done = i => trace && shown > i;
  const step = (i, body) => (
    <div className={`pi-jstep ${done(i) ? 'done' : 'wait'}`} key={i} aria-live="polite">
      <div className="n">{done(i) ? '✓' : i + 1}</div>
      <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{STEPS[i]}</div>{done(i) && body}</div>
    </div>
  );
  const focus = trace?.cluster ? { lat: trace.cluster.lat, lng: trace.cluster.lng, zoom: 14 } : null;
  const instCountry = activeInst?.id?.startsWith('br') ? 'BR' : 'IN';

  return (
    <div className="pi">
      <style>{policyStyles}{switchStyles}</style>
      <div className="pi-head"><div>
        <div className="pi-title">Judge Mode — from one citizen voice request to a policy recommendation</div>
        <div className="pi-sub">A live walkthrough on the synthetic demonstration dataset. Nothing here is pre-computed: the request you submit passes through the same classification, clustering, scoring and prioritisation pipeline used in production, and the demand it joins was built from synthetic multilingual requests.</div>
      </div></div>
      <div className="pi-banner" role="note"><strong>SYNTHETIC DEMONSTRATION DATA</strong><span>{scenario?.dataLabel}</span></div>
      <ErrorBox error={error} />

      {/* Country switcher — demonstrates BRICS interoperability */}
      <div className="jm-country-switcher">
        <span style={{ fontSize: 12, fontWeight: 600, color: '#4b5563' }}>🌐 Active country instance:</span>
        {[{ id: 'in-demo', code: 'IN' }, { id: 'br-demo', code: 'BR' }].map(inst => (
          <button
            key={inst.id}
            className={`jm-country-btn ${instCountry === inst.code ? 'active' : ''}`}
            disabled={switching || instCountry === inst.code}
            onClick={() => switchCountry(inst.id)}
          >
            {COUNTRY_FLAG[inst.code]} {COUNTRY_NAME[inst.code]}
            {instCountry === inst.code && ' ✓'}
          </button>
        ))}
        {switching && <span style={{ fontSize: 12, color: '#6b7280' }}>Switching instance…</span>}
        {activeInst && !switching && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>
            {(activeInst.languages || []).join(', ')} · {(activeInst.adminLevels || []).join(' → ')}
          </span>
        )}
      </div>

      <div className="pi-card" style={{ marginBottom: 12 }}>
        <h3>1 · The citizen's request</h3>
        <div className="pi-row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {scenario?.voiceSamples.map(s => <button key={s.id} className={`pi-chip`} style={sampleId === s.id ? { background: 'var(--pi-accent-soft)', borderColor: 'var(--pi-accent)' } : {}} onClick={() => chooseSample(s.id)}>{s.label}</button>)}
          {!rec.on ? <button className="pi-btn ghost sm" onClick={startRec}>Record voice (Whisper)</button> : <button className="pi-btn danger sm" onClick={stopRec}>Stop recording</button>}
        </div>
        {rec.note && <div className="pi-muted" style={{ marginBottom: 6 }} role="status">{rec.note}</div>}
        <textarea className="pi-input" rows={3} value={text} onChange={e => { setText(e.target.value); setSource('typed'); }} aria-label="Citizen request transcript" maxLength={1500} />
        <div className="pi-row sp" style={{ marginTop: 8 }}>
          <span className="pi-muted">Transcript source: <b>{source === 'sample' ? 'recorded-sample transcript (no audio processed)' : source}</b>. Whisper runs only when the AI service has it enabled.</span>
          <div className="pi-row"><button className="pi-btn" disabled={busy || !text.trim()} onClick={run}>{busy ? 'Running pipeline…' : trace ? 'Run again' : 'Submit request'}</button>{trace && <button className="pi-btn ghost" onClick={reset}>Reset</button>}</div>
        </div>
      </div>

      {trace && <div className="pi-row sp" style={{ marginBottom: 8 }}><span className="pi-muted">Step {Math.min(shown, STEPS.length)} of {STEPS.length}</span>
        <div className="pi-row"><label className="pi-muted"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Auto-advance</label><button className="pi-btn ghost sm" disabled={shown >= STEPS.length} onClick={() => setShown(s => s + 1)}>Next step</button><button className="pi-btn ghost sm" disabled={shown >= STEPS.length} onClick={() => setShown(STEPS.length)}>Show all</button></div></div>}

      <div className="pi-judge-steps">
        {trace && <>
          {step(0, <div className="pi-kv"><span><b>Channel</b>{r.channel}</span><span><b>Language detected</b>{r.language}</span><span><b>Country instance</b>{COUNTRY_NAME[instCountry]}</span></div>)}
          {step(1, <><div style={{ marginTop: 6, fontSize: 14 }}>"{r.text}"</div><div className="pi-muted" style={{ marginTop: 4 }}>Source: {source === 'whisper' ? 'OpenAI Whisper (open weights)' : source === 'sample' ? 'bundled sample transcript — no audio was processed' : source}. Personal details are redacted before storage.</div></>)}
          {step(2, <div className="pi-kv"><span><b>Need</b>{r.categoryLabel} → {r.subcategory}</span><span><b>Confidence</b>{pct(r.confidence)}</span><span><b>Engine</b>{r.classifier}</span><span><b>Matched terms</b>{r.matchedTerms.join(', ') || '—'}</span><span><b>Urgency</b>{r.urgencyBand}</span><span><b>Affected infrastructure</b>{r.affectedInfrastructure}</span></div>)}
          {step(3, <div className="pi-kv"><span><b>Region</b>{r.regionName || 'unresolved'}</span><span><b>Method</b>{r.locationSource}</span><span><b>Coordinates</b>{r.lat?.toFixed(4)}, {r.lng?.toFixed(4)}</span><span><b>Location text</b>{r.locationText}</span></div>)}
          {step(4, trace.cluster ? <div className="pi-kv"><span><b>Cluster</b>{trace.cluster.id}</span><span><b>Requests in cluster</b>{trace.cluster.requestCount}</span><span><b>Distinct locations</b>{trace.cluster.uniqueLocations}</span><span><b>Radius</b>{trace.cluster.radiusKm} km</span><span><b>Region demand</b>{trace.demand.requestCount} unique requests, score {trace.demand.demandScore}/100</span></div> : <div className="pi-muted">Request kept but not yet clustered (location unresolved).</div>)}
          {step(5, geo && <div style={{ marginTop: 8 }}><PolicyMap mini geo={geo} focus={focus} layers={{ requests: true, hotspots: true, gaps: false, density: false, investments: false, recommended: false }} /></div>)}
          {step(6, trace.gap && <div className="pi-kv"><span><b>Availability</b>{trace.gap.availability != null ? `${pct(trace.gap.availability)} of benchmark` : 'not measured'}</span><span><b>Gap</b>{trace.gap.gap != null ? pct(trace.gap.gap) : '—'}</span><span><b>Severity</b>{trace.gap.severity} <SeverityBadge band={trace.gap.severityBand} /></span><span><b>Confidence</b>{pct(trace.gap.confidence)}</span><div style={{ flexBasis: '100%' }} className="pi-muted">{trace.gap.reasoning.slice(0, 4).join(' ')}</div></div>)}
          {step(7, <div className="pi-kv"><span><b>Residents affected (estimate)</b><b style={{ color: 'var(--pi-ink)', fontSize: 16 }}>{fmt(trace.gap?.populationAffected)}</b></span><span><b>Region population</b>{fmt(trace.region?.population)}</span>{trace.cluster && <span><b>Cluster footprint</b>≈{fmt(trace.cluster.affectedPopulation)}</span>}</div>)}
          {step(8, trace.alignment && <><div style={{ marginTop: 6, fontWeight: 600 }}>{trace.alignment.label}</div><div className="pi-muted" style={{ marginTop: 3 }}>{trace.alignment.note}</div>{trace.alignment.matched.length > 0 && <div style={{ marginTop: 4, fontSize: 12.5 }}>{trace.alignment.matched.map(m => <div key={m.id}>• {m.name} ({m.stage})</div>)}</div>}</>)}
          {step(9, trace.project && <><div className="pi-row" style={{ marginTop: 6 }}><PriorityBadge band={trace.project.band} /><b>{trace.project.priorityScore}/100</b><span className="pi-muted">rank #{trace.project.rank} of {' '}the region-needs analysed</span></div><div style={{ marginTop: 6, fontSize: 13.5 }}>{trace.project.rationale}</div><div className="pi-kv"><span><b>Proposed intervention</b>{trace.project.proposedIntervention}</span><span><b>Responsible department</b>{trace.project.responsibleDepartment}</span><span><b>Status</b>pending human review</span></div></>)}
          {step(10, <><div className="pi-muted" style={{ marginTop: 4 }}>The policymaker view shows the same item with its complete evidence trail.</div><button className="pi-btn sm" style={{ marginTop: 6 }} onClick={() => setDash(d => !d)}>{dash ? 'Hide dashboard' : 'Open policymaker dashboard'}</button></>)}
          {step(11, <><button className="pi-btn sm" style={{ marginTop: 6 }} disabled={asking} onClick={ask}>{asking ? 'Asking…' : 'Ask: "Why was this region prioritized?"'}</button>{why && <div className="pi-card" style={{ marginTop: 8 }}><div className="pi-answer">{why.narration?.verified ? why.narration.text : why.answer}</div><div className="pi-muted" style={{ marginTop: 6 }}>Answer computed from stored evidence ({why.method}); confidence {pct(why.confidence)}.</div></div>}</>)}
        </>}
        {!trace && <div className="pi-empty">Choose or record a request and press <b>Submit request</b>. The twelve steps will fill in as the pipeline computes each result.</div>}
      </div>

      {/* Data Provenance Panel */}
      {trace && (
        <div className="jm-provenance">
          <h5>📋 Data Provenance & Evidence Chain</h5>
          <div className="jm-prov-row"><span className="jm-prov-key">Country instance</span><span>{COUNTRY_NAME[instCountry]} ({instCountry})</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Classification engine</span><span>{r?.classifier || 'lexicon-rule-based'} — no black box, explainable outputs</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Citizen request data</span><span><span className="jm-synth-tag">⚠ Synthetic</span> Demonstration dataset — not real citizen records</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Infrastructure data</span><span><span className="jm-synth-tag">⚠ Synthetic</span> Illustrative sector benchmarks — not official government statistics</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Investment data</span><span><span className="jm-synth-tag">⚠ Synthetic</span> Illustrative public investment schemes — not real budget data</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Pipeline determinism</span><span>Fully deterministic scoring — same inputs always yield same outputs</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Privacy protection</span><span>k-anonymity enforced on geo layer · PII redacted · submitter identity one-way hashed</span></div>
          <div className="jm-prov-row"><span className="jm-prov-key">Human review required</span><span>All priority recommendations must be reviewed before action (see Governance tab)</span></div>
        </div>
      )}

      {dash && trace?.project && <div style={{ marginTop: 16, borderTop: '2px solid var(--pi-line)', paddingTop: 12 }}><PolicyDashboard user={tokenStore.getOfficer()} embedded initialTab="priorities" focusProjectId={trace.project.id} /></div>}
    </div>
  );
}
