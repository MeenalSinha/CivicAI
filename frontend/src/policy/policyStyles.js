// Government / public-infrastructure visual language: neutral slate, one deep-blue accent,
// colour reserved for meaning (severity), generous hierarchy, high contrast, keyboard-visible focus.
export const policyStyles = `
  .pi { --pi-ink:#0f2a43; --pi-ink2:#3b4a5a; --pi-mute:#66758a; --pi-line:#d5dce6; --pi-bg:#f4f6f9; --pi-card:#fff;
        --pi-accent:#12406d; --pi-accent-soft:#e8eff7; --pi-crit:#a4262c; --pi-high:#c2570c; --pi-mod:#8a6d00; --pi-low:#2f6b4f;
        color: var(--pi-ink); }
  .pi * { box-sizing: border-box; }
  .pi button:focus-visible, .pi select:focus-visible, .pi input:focus-visible, .pi textarea:focus-visible, .pi [tabindex]:focus-visible { outline: 3px solid #3a7bd5; outline-offset: 1px; }
  .pi-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:12px; flex-wrap:wrap; }
  .pi-title { font-size:20px; font-weight:700; letter-spacing:-0.2px; }
  .pi-sub { font-size:12.5px; color:var(--pi-mute); margin-top:2px; max-width:760px; }
  .pi-banner { display:flex; gap:10px; align-items:center; background:#fff8e1; border:1px solid #f0d98a; color:#5b4600; padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:12px; }
  .pi-banner strong { letter-spacing:.3px; }
  .pi-tabs { display:flex; gap:0; border-bottom:2px solid var(--pi-line); margin-bottom:16px; overflow-x:auto; }
  .pi-tab { background:none; border:none; padding:10px 14px; font:600 13px var(--font); color:var(--pi-mute); cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; white-space:nowrap; }
  .pi-tab:hover { color: var(--pi-ink); }
  .pi-tab.active { color: var(--pi-accent); border-bottom-color: var(--pi-accent); }
  .pi-tab .pi-count { background:var(--pi-accent); color:#fff; border-radius:9px; padding:0 6px; font-size:10.5px; margin-left:6px; }
  .pi-grid { display:grid; gap:12px; }
  .pi-kpis { grid-template-columns: repeat(auto-fill, minmax(190px,1fr)); }
  .pi-card { background:var(--pi-card); border:1px solid var(--pi-line); border-radius:8px; padding:14px; }
  .pi-card h3 { font-size:12px; text-transform:uppercase; letter-spacing:.6px; color:var(--pi-mute); font-weight:700; margin-bottom:10px; }
  .pi-kpi .v { font-size:26px; font-weight:700; letter-spacing:-.5px; line-height:1.1; font-variant-numeric: tabular-nums; }
  .pi-kpi .l { font-size:12px; color:var(--pi-ink2); margin-top:4px; font-weight:600; }
  .pi-kpi .n { font-size:11px; color:var(--pi-mute); margin-top:3px; }
  .pi-two { grid-template-columns: 1.5fr 1fr; } .pi-three { grid-template-columns: repeat(3,1fr); } .pi-four { grid-template-columns: repeat(4,1fr); }
  @media (max-width: 1100px) { .pi-two, .pi-three, .pi-four { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 760px) { .pi-two, .pi-three, .pi-four { grid-template-columns: 1fr; } }
  .pi-table { width:100%; border-collapse:collapse; font-size:12.5px; }
  .pi-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--pi-mute); padding:7px 8px; border-bottom:2px solid var(--pi-line); font-weight:700; white-space:nowrap; }
  .pi-table td { padding:9px 8px; border-bottom:1px solid #e9edf3; vertical-align:top; }
  .pi-table tr.click { cursor:pointer; } .pi-table tr.click:hover td { background:#f3f7fb; } .pi-table tr.sel td { background:var(--pi-accent-soft); }
  .pi-num { font-variant-numeric: tabular-nums; text-align:right; white-space:nowrap; }
  .pi-badge { display:inline-block; padding:2px 8px; border-radius:3px; font-size:11px; font-weight:700; letter-spacing:.2px; border:1px solid transparent; white-space:nowrap; }
  .pi-b-crit { background:#fbe9ea; color:var(--pi-crit); border-color:#efc3c5; } .pi-b-high { background:#fdeee0; color:var(--pi-high); border-color:#f3cfae; }
  .pi-b-mod { background:#fbf4d9; color:var(--pi-mod); border-color:#eddd97; } .pi-b-low { background:#e5f2ec; color:var(--pi-low); border-color:#bcdccb; }
  .pi-b-neutral { background:#eef1f5; color:var(--pi-ink2); border-color:#d5dce6; } .pi-b-info { background:var(--pi-accent-soft); color:var(--pi-accent); border-color:#c1d3e6; }
  .pi-bar { height:8px; background:#e9edf3; border-radius:4px; overflow:hidden; } .pi-bar > i { display:block; height:100%; background:var(--pi-accent); }
  .pi-row { display:flex; align-items:center; gap:8px; } .pi-row.sp { justify-content:space-between; }
  .pi-btn { background:var(--pi-accent); color:#fff; border:1px solid var(--pi-accent); padding:7px 14px; border-radius:5px; font:600 12.5px var(--font); cursor:pointer; }
  .pi-btn:hover { background:#0d3357; } .pi-btn:disabled { opacity:.5; cursor:not-allowed; }
  .pi-btn.ghost { background:#fff; color:var(--pi-accent); } .pi-btn.ghost:hover { background:var(--pi-accent-soft); }
  .pi-btn.danger { background:#fff; color:var(--pi-crit); border-color:#d9a3a6; } .pi-btn.sm { padding:4px 10px; font-size:12px; }
  .pi-input, .pi select.pi-input, .pi textarea.pi-input { width:100%; border:1px solid #b9c3d1; border-radius:5px; padding:8px 10px; font:13px var(--font); background:#fff; color:var(--pi-ink); }
  .pi-filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; align-items:center; } .pi-filters select { width:auto; min-width:150px; }
  .pi-muted { color:var(--pi-mute); font-size:12px; } .pi-empty { padding:28px; text-align:center; color:var(--pi-mute); font-size:13px; border:1px dashed var(--pi-line); border-radius:8px; background:#fafbfd; }
  .pi-err { background:#fbe9ea; border:1px solid #efc3c5; color:var(--pi-crit); padding:10px 12px; border-radius:6px; font-size:12.5px; margin-bottom:10px; }
  .pi-ok { background:#e5f2ec; border:1px solid #bcdccb; color:var(--pi-low); padding:10px 12px; border-radius:6px; font-size:12.5px; margin-bottom:10px; }
  .pi-load { padding:30px; text-align:center; color:var(--pi-mute); font-size:13px; }
  .pi-mapwrap { display:grid; grid-template-columns: 250px 1fr 300px; gap:12px; align-items:start; }
  @media (max-width: 1100px) { .pi-mapwrap { grid-template-columns: 1fr; } }
  .pi-map { height:560px; border:1px solid var(--pi-line); border-radius:8px; background:#e8edf3; z-index:0; }
  .pi-map.mini { height:300px; }
  .pi-layer { display:flex; gap:8px; align-items:flex-start; font-size:12.5px; padding:5px 0; cursor:pointer; } .pi-layer input { margin-top:3px; }
  .pi-swatch { width:11px; height:11px; border-radius:50%; display:inline-block; margin-right:6px; vertical-align:middle; border:1px solid rgba(0,0,0,.25); }
  .pi-legend { font-size:11.5px; color:var(--pi-ink2); line-height:1.7; }
  .pi-drawer { position:fixed; top:56px; right:0; bottom:0; width:min(680px,100vw); background:#fff; border-left:1px solid var(--pi-line); box-shadow:-8px 0 28px rgba(15,42,67,.14); z-index:150; display:flex; flex-direction:column; }
  .pi-drawer-h { padding:14px 18px; border-bottom:1px solid var(--pi-line); display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
  .pi-drawer-b { padding:16px 18px; overflow-y:auto; flex:1; }
  .pi-step { display:grid; grid-template-columns: 28px 1fr; gap:10px; padding:10px 0; border-bottom:1px solid #eef1f5; }
  .pi-step .n { width:24px; height:24px; border-radius:50%; background:var(--pi-accent); color:#fff; font:700 12px var(--font); display:flex; align-items:center; justify-content:center; }
  .pi-step .t { font-weight:700; font-size:13px; } .pi-step .d { font-size:12.5px; color:var(--pi-ink2); margin-top:3px; line-height:1.55; }
  .pi-sect { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--pi-mute); font-weight:700; margin:16px 0 6px; }
  .pi-answer { font-size:14px; line-height:1.65; } .pi-chip { display:inline-block; border:1px solid #b9c3d1; background:#fff; border-radius:14px; padding:4px 11px; font-size:12px; cursor:pointer; margin:0 6px 6px 0; color:var(--pi-ink2); font-family:var(--font); }
  .pi-chip:hover { background:var(--pi-accent-soft); border-color:var(--pi-accent); color:var(--pi-accent); }
  .pi-judge-steps { display:grid; gap:10px; } .pi-jstep { display:grid; grid-template-columns:34px 1fr; gap:12px; background:#fff; border:1px solid var(--pi-line); border-left:4px solid #c8d0de; border-radius:8px; padding:12px 14px; }
  .pi-jstep.done { border-left-color:var(--pi-low); } .pi-jstep.wait { opacity:.55; }
  .pi-jstep .n { width:28px; height:28px; border-radius:50%; background:#e9edf3; color:var(--pi-ink2); font:700 13px var(--font); display:flex; align-items:center; justify-content:center; }
  .pi-jstep.done .n { background:var(--pi-low); color:#fff; }
  .pi-kv { display:flex; flex-wrap:wrap; gap:6px 18px; font-size:12.5px; margin-top:6px; } .pi-kv b { color:var(--pi-mute); font-weight:600; margin-right:4px; }
  .pi-mono { font-family: var(--font-mono); font-size:12px; }
`;
