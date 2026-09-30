import PolicyDashboard from './policy/PolicyDashboard';
import JudgeMode from './policy/JudgeMode';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';
import { citizenAPI, officerAPI, authAPI, tokenStore, createWebSocket, WS_URL, geoStore } from './api';

// ============================================================
// GLOBAL STYLES
// ============================================================
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --white: #ffffff;
    --bg: #f5f7fa;
    --bg2: #eef1f6;
    --surface: #ffffff;
    --surface2: #f0f4f9;
    --border: #dde3ec;
    --border2: #c8d0de;
    --text: #111827;
    --text2: #4b5563;
    --text3: #9ca3af;
    --accent: #1a56db;
    --accent-light: #eff4ff;
    --accent-hover: #1345b5;
    --green: #0d9488;
    --green-light: #f0fdfa;
    --orange: #d97706;
    --orange-light: #fffbeb;
    --red: #dc2626;
    --red-light: #fef2f2;
    --purple: #7c3aed;
    --purple-light: #f5f3ff;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
    --shadow: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
    --shadow-lg: 0 10px 30px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.04);
    --radius: 10px;
    --radius-lg: 14px;
    --font: 'Inter', -apple-system, sans-serif;
    --font-mono: 'IBM Plex Mono', monospace;
  }

  html, body { height: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  #root { height: 100%; }

  /* ---- LAYOUT ---- */
  .app { display: flex; flex-direction: column; min-height: 100vh; }

  .topnav {
    background: var(--white);
    border-bottom: 1px solid var(--border);
    height: 56px;
    display: flex;
    align-items: center;
    padding: 0 20px;
    gap: 16px;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: var(--shadow-sm);
  }
  .nav-brand {
    font-size: 17px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -0.3px;
  }
  .nav-divider { width: 1px; height: 20px; background: var(--border); }
  .nav-subtitle { font-size: 12px; color: var(--text3); font-weight: 500; }
  .nav-mode-tabs { display: flex; gap: 2px; background: var(--bg2); border-radius: 8px; padding: 3px; }
  .nav-mode-btn {
    padding: 5px 16px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    background: transparent;
    color: var(--text2);
    font-family: var(--font);
    transition: all 0.15s;
  }
  .nav-mode-btn:hover { background: var(--white); color: var(--text); }
  .nav-mode-btn.active { background: var(--white); color: var(--accent); box-shadow: var(--shadow-sm); }
  .nav-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .nav-status {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--text3);
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }
  .status-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green);
  }
  .status-dot.offline { background: var(--text3); }
  .notif-btn {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text2);
    font-family: var(--font);
    font-weight: 500;
    transition: all 0.15s;
  }
  .notif-btn:hover { border-color: var(--accent); color: var(--accent); }
  .notif-count {
    position: absolute; top: -5px; right: -5px;
    background: var(--red); color: white;
    font-size: 10px; font-weight: 700;
    width: 16px; height: 16px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }

  /* ---- SIDEBAR ---- */
  .layout { flex: 1; display: flex; overflow: hidden; }
  .sidebar {
    width: 210px;
    background: var(--white);
    border-right: 1px solid var(--border);
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .sidebar-section-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text3);
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 8px 10px 4px;
    margin-top: 4px;
  }
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
    color: var(--text2);
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s;
    border: 1px solid transparent;
  }
  .sidebar-item:hover { background: var(--bg2); color: var(--text); }
  .sidebar-item.active {
    background: var(--accent-light);
    color: var(--accent);
    border-color: rgba(26,86,219,0.15);
    font-weight: 600;
  }
  .sidebar-icon {
    width: 18px; text-align: center; font-size: 14px; flex-shrink: 0;
  }
  .sidebar-divider { height: 1px; background: var(--border); margin: 6px 0; }

  /* ---- CONTENT ---- */
  .content { flex: 1; overflow-y: auto; padding: 24px; }
  .page-header { margin-bottom: 24px; }
  .page-title { font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; margin-bottom: 3px; }
  .page-subtitle { font-size: 13px; color: var(--text3); }

  /* ---- CARDS ---- */
  .card {
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: var(--shadow-sm);
  }
  .card-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text3);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 16px;
  }

  /* ---- STAT CARDS ---- */
  .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  .stat-card {
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    box-shadow: var(--shadow-sm);
  }
  .stat-label { font-size: 12px; color: var(--text3); font-weight: 500; margin-bottom: 8px; }
  .stat-value { font-size: 32px; font-weight: 700; color: var(--text); letter-spacing: -1px; line-height: 1; }
  .stat-value.blue { color: var(--accent); }
  .stat-value.green { color: var(--green); }
  .stat-value.orange { color: var(--orange); }
  .stat-value.red { color: var(--red); }
  .stat-sub { font-size: 12px; color: var(--text3); margin-top: 6px; }

  /* ---- BADGES ---- */
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge-critical { background: var(--red-light); color: var(--red); }
  .badge-high { background: var(--orange-light); color: var(--orange); }
  .badge-medium { background: var(--accent-light); color: var(--accent); }
  .badge-low { background: var(--green-light); color: var(--green); }
  .badge-pending { background: var(--orange-light); color: var(--orange); }
  .badge-in_progress { background: var(--accent-light); color: var(--accent); }
  .badge-resolved { background: var(--green-light); color: var(--green); }

  /* ---- COMPLAINT ITEMS ---- */
  .complaint-list { display: flex; flex-direction: column; gap: 8px; }
  .complaint-card {
    background: var(--white);
    border: 1px solid var(--border);
    border-left: 3px solid transparent;
    border-radius: var(--radius);
    padding: 14px 16px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .complaint-card:hover { box-shadow: var(--shadow); border-color: var(--border2); }
  .complaint-card.CRITICAL { border-left-color: var(--red); }
  .complaint-card.HIGH { border-left-color: var(--orange); }
  .complaint-card.MEDIUM { border-left-color: var(--accent); }
  .complaint-card.LOW { border-left-color: var(--green); }
  .complaint-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
  .complaint-type { font-size: 14px; font-weight: 600; color: var(--text); }
  .complaint-badges { display: flex; gap: 5px; flex-wrap: wrap; }
  .complaint-desc {
    font-size: 13px; color: var(--text2); line-height: 1.5;
    margin-bottom: 8px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .complaint-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .complaint-ticket { font-family: var(--font-mono); font-size: 11px; color: var(--accent); font-weight: 600; }
  .complaint-dept {
    font-size: 11px; color: var(--text3);
    background: var(--bg2); padding: 2px 7px; border-radius: 4px; font-weight: 500;
  }
  .complaint-loc { font-size: 11px; color: var(--text3); }
  .complaint-time { font-size: 11px; color: var(--text3); margin-left: auto; }

  /* ---- CHAT ---- */
  .chat-wrap { display: flex; flex-direction: column; height: calc(100vh - 100px); max-width: 720px; }
  .chat-header {
    background: var(--white); border: 1px solid var(--border); border-bottom: none;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding: 14px 18px; display: flex; align-items: center; gap: 12px;
  }
  .chat-avatar {
    width: 38px; height: 38px; border-radius: 10px;
    background: var(--accent); color: white;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700; flex-shrink: 0;
  }
  .chat-agent-name { font-size: 14px; font-weight: 600; }
  .chat-agent-status { font-size: 11px; color: var(--green); font-weight: 500; }
  .chat-lang-note { font-size: 11px; color: var(--text3); margin-left: auto; }
  .chat-messages {
    flex: 1; overflow-y: auto;
    background: var(--bg2);
    border: 1px solid var(--border);
    padding: 16px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .chat-messages::-webkit-scrollbar { width: 4px; }
  .chat-messages::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .msg { max-width: 78%; }
  .msg-user { align-self: flex-end; }
  .msg-bot { align-self: flex-start; }
  .msg-bubble {
    padding: 9px 13px;
    border-radius: 12px;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .msg-user .msg-bubble {
    background: var(--accent); color: white;
    border-radius: 12px 12px 3px 12px;
  }
  .msg-bot .msg-bubble {
    background: var(--white); color: var(--text);
    border: 1px solid var(--border);
    border-radius: 12px 12px 12px 3px;
    box-shadow: var(--shadow-sm);
  }
  .msg-time { font-size: 10px; color: var(--text3); margin-top: 3px; padding: 0 3px; }
  .msg-user .msg-time { text-align: right; }
  .msg-ticket {
    background: var(--green-light);
    border: 1px solid rgba(13,148,136,0.2);
    border-radius: 9px;
    padding: 11px 13px;
    margin-top: 7px;
    font-size: 12px;
  }
  .msg-ticket-title { font-size: 11px; font-weight: 700; color: var(--green); margin-bottom: 7px; text-transform: uppercase; letter-spacing: 0.4px; }
  .msg-ticket-row { display: flex; gap: 8px; color: var(--text2); margin-bottom: 3px; }
  .msg-ticket-key { color: var(--text3); width: 90px; flex-shrink: 0; }
  .chat-input-wrap {
    background: var(--white);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    padding: 12px;
    box-shadow: var(--shadow-sm);
  }
  .chat-quick-btns { display: flex; gap: 6px; margin-bottom: 9px; flex-wrap: wrap; }
  .quick-btn {
    padding: 4px 11px; border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface); color: var(--text2);
    font-size: 11px; cursor: pointer; font-family: var(--font);
    font-weight: 500; transition: all 0.15s; white-space: nowrap;
  }
  .quick-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
  .chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
  .chat-textarea {
    flex: 1; background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 9px 13px;
    color: var(--text); font-size: 13.5px;
    font-family: var(--font); resize: none;
    outline: none; max-height: 100px; line-height: 1.5;
  }
  .chat-textarea:focus { border-color: var(--accent); background: var(--white); }
  .chat-textarea::placeholder { color: var(--text3); }
  .send-btn {
    width: 38px; height: 38px; border-radius: 9px;
    background: var(--accent); border: none;
    cursor: pointer; color: white; font-size: 15px;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0; font-family: var(--font);
  }
  .send-btn:hover { background: var(--accent-hover); }
  .send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .typing-indicator {
    display: flex; gap: 4px; padding: 9px 13px;
    background: var(--white); border: 1px solid var(--border);
    border-radius: 12px 12px 12px 3px;
    box-shadow: var(--shadow-sm);
    width: fit-content;
  }
  .typing-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text3); animation: typeBounce 1.2s infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.15s; }
  .typing-dot:nth-child(3) { animation-delay: 0.3s; }

  /* ---- BUTTONS ---- */
  .btn {
    padding: 8px 16px; border-radius: 8px;
    border: none; cursor: pointer; font-size: 13px; font-weight: 600;
    font-family: var(--font); display: inline-flex; align-items: center; gap: 6px;
    transition: all 0.15s;
  }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-success { background: var(--green); color: white; }
  .btn-success:hover { background: #0b8078; }
  .btn-success:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-outline {
    background: var(--white); color: var(--text2);
    border: 1px solid var(--border);
  }
  .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
  .btn-sm { padding: 5px 12px; font-size: 12px; border-radius: 7px; }
  .btn-danger { background: var(--red); color: white; }
  .btn-full { width: 100%; justify-content: center; padding: 11px; }

  /* ---- FORMS ---- */
  .form-group { margin-bottom: 14px; }
  .form-label { font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 5px; display: block; }
  .form-input {
    width: 100%; background: var(--white);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 13px;
    color: var(--text); font-size: 13.5px;
    font-family: var(--font); outline: none;
    transition: border-color 0.15s;
  }
  .form-input:focus { border-color: var(--accent); }
  .form-input::placeholder { color: var(--text3); }
  .form-textarea { resize: vertical; min-height: 80px; }
  .form-select {
    width: 100%; background: var(--white);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 13px;
    color: var(--text); font-size: 13.5px;
    font-family: var(--font); outline: none; cursor: pointer;
  }
  .form-select:focus { border-color: var(--accent); }

  /* ---- FILTER BAR ---- */
  .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-bar .form-input { min-width: 200px; flex: 1; }
  .filter-bar .form-select { min-width: 140px; }

  /* ---- MODAL ---- */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.35);
    backdrop-filter: blur(3px);
    z-index: 200;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .modal {
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 24px;
    max-width: 580px; width: 100%;
    max-height: 85vh; overflow-y: auto;
  }
  .modal-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
  .modal-title { font-size: 17px; font-weight: 700; }
  .modal-close {
    background: none; border: none; cursor: pointer;
    font-size: 18px; color: var(--text3); padding: 2px 6px; border-radius: 5px;
    font-family: var(--font);
  }
  .modal-close:hover { background: var(--bg2); color: var(--text); }

  /* ---- DETAIL GRID ---- */
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .detail-field {
    background: var(--bg2); border-radius: 8px; padding: 11px 13px;
    border: 1px solid var(--border);
  }
  .detail-key { font-size: 11px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
  .detail-val { font-size: 13px; font-weight: 500; color: var(--text); }
  .confidence-row { display: flex; align-items: center; gap: 10px; }
  .conf-bar { flex: 1; height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .conf-fill { height: 100%; background: var(--green); border-radius: 3px; transition: width 0.4s; }

  /* ---- UPLOAD ---- */
  .upload-zone {
    border: 2px dashed var(--border2);
    border-radius: var(--radius-lg);
    padding: 36px 24px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--bg);
  }
  .upload-zone:hover { border-color: var(--accent); background: var(--accent-light); }
  .upload-zone.drag-active { border-color: var(--accent); background: var(--accent-light); }
  .upload-icon { font-size: 36px; color: var(--text3); margin-bottom: 10px; }
  .upload-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .upload-hint { font-size: 12px; color: var(--text3); }

  /* ---- VOICE ---- */
  .voice-center { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 32px; }
  .voice-btn {
    width: 80px; height: 80px; border-radius: 50%;
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; transition: all 0.25s;
    box-shadow: var(--shadow);
  }
  .voice-btn.idle { background: var(--bg2); border: 2px solid var(--border2); color: var(--text2); }
  .voice-btn.idle:hover { background: var(--accent-light); border-color: var(--accent); color: var(--accent); }
  .voice-btn.recording {
    background: var(--red); color: white;
    animation: voicePulse 1.5s infinite;
    box-shadow: 0 0 0 0 rgba(220,38,38,0.4);
  }
  .voice-bars { display: flex; gap: 3px; align-items: center; height: 36px; }
  .voice-bar {
    width: 4px; border-radius: 2px;
    background: var(--accent);
    animation: voiceWave 1s infinite;
  }
  .voice-bar:nth-child(2) { animation-delay: 0.1s; }
  .voice-bar:nth-child(3) { animation-delay: 0.2s; }
  .voice-bar:nth-child(4) { animation-delay: 0.3s; }
  .voice-bar:nth-child(5) { animation-delay: 0.2s; }

  /* ---- TRACK ---- */
  .timeline { display: flex; flex-direction: column; gap: 0; }
  .tl-item { display: flex; gap: 12px; }
  .tl-left { display: flex; flex-direction: column; align-items: center; }
  .tl-dot {
    width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; margin-top: 2px;
    border: 2px solid transparent;
  }
  .tl-dot.done { background: var(--green); border-color: var(--green); }
  .tl-dot.active { background: white; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(26,86,219,0.15); }
  .tl-dot.pending { background: var(--border2); border-color: var(--border2); }
  .tl-line { width: 1px; flex: 1; min-height: 20px; margin: 3px 0; }
  .tl-line.done { background: var(--green); }
  .tl-line.pending { background: var(--border); }
  .tl-content { padding-bottom: 16px; flex: 1; }
  .tl-label { font-size: 13px; font-weight: 600; }
  .tl-label.done { color: var(--green); }
  .tl-label.active { color: var(--accent); }
  .tl-label.pending { color: var(--text3); }
  .tl-sub { font-size: 11px; color: var(--text3); margin-top: 1px; }

  /* ---- INSIGHTS ---- */
  .insights-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .insight-card {
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    box-shadow: var(--shadow-sm);
  }
  .insight-key { font-size: 10px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 7px; }
  .insight-val { font-size: 13px; color: var(--text); line-height: 1.6; }

  /* ---- CHARTS ---- */
  .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .chart-full { grid-column: 1/-1; }

  /* ---- AI STATUS ---- */
  .ai-status {
    display: flex; align-items: center; gap: 7px;
    background: var(--accent-light); border: 1px solid rgba(26,86,219,0.15);
    border-radius: 8px; padding: 8px 13px;
    font-size: 12px; color: var(--accent); font-weight: 500;
  }
  .ai-spinner {
    width: 13px; height: 13px;
    border: 2px solid rgba(26,86,219,0.2);
    border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.7s linear infinite;
  }

  /* ---- NOTIFICATION PANEL ---- */
  .notif-panel {
    position: fixed; top: 62px; right: 16px;
    width: 320px;
    background: var(--white);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 150; overflow: hidden;
  }
  .notif-panel-header {
    padding: 13px 16px;
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; font-weight: 600;
  }
  .notif-item {
    padding: 11px 16px;
    border-bottom: 1px solid var(--border);
    cursor: pointer; transition: background 0.15s;
  }
  .notif-item:hover { background: var(--bg2); }
  .notif-item.unread { background: var(--accent-light); }
  .notif-item-msg { font-size: 12px; color: var(--text); line-height: 1.5; margin-bottom: 3px; }
  .notif-item-time { font-size: 10px; color: var(--text3); }

  /* ---- MISC ---- */
  .divider { height: 1px; background: var(--border); margin: 16px 0; }
  .empty-state { text-align: center; padding: 40px; color: var(--text3); }
  .empty-icon { font-size: 36px; color: var(--border2); margin-bottom: 10px; }
  .section-title { font-size: 14px; font-weight: 700; margin-bottom: 14px; color: var(--text); }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .flex-row { display: flex; align-items: center; gap: 8px; }
  .flex-between { display: flex; align-items: center; justify-content: space-between; }
  .mb-8 { margin-bottom: 8px; }
  .mb-12 { margin-bottom: 12px; }
  .mb-16 { margin-bottom: 16px; }
  .mb-20 { margin-bottom: 20px; }
  .tag {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600;
    background: var(--bg2); color: var(--text2);
  }
  .info-box {
    background: var(--accent-light); border: 1px solid rgba(26,86,219,0.15);
    border-radius: 9px; padding: 12px 14px;
    font-size: 13px; color: var(--text2); line-height: 1.6;
  }
  .result-box {
    background: var(--green-light); border: 1px solid rgba(13,148,136,0.2);
    border-radius: 9px; padding: 14px 16px;
  }
  .result-box-title { font-size: 12px; font-weight: 700; color: var(--green); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.4px; }

  /* ---- WELCOME ---- */
  .welcome-wrap { max-width: 640px; margin: 0 auto; text-align: center; padding: 40px 20px; }
  .welcome-logo {
    width: 52px; height: 52px; border-radius: 14px;
    background: var(--accent); color: white;
    font-size: 22px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px; box-shadow: 0 4px 14px rgba(26,86,219,0.25);
  }
  .welcome-title { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 10px; }
  .welcome-desc { font-size: 14px; color: var(--text2); line-height: 1.7; margin-bottom: 32px; }
  .welcome-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; text-align: left; }
  .welcome-card {
    background: var(--white); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 18px;
    cursor: pointer; transition: all 0.2s;
  }
  .welcome-card:hover { border-color: var(--accent); box-shadow: var(--shadow); transform: translateY(-1px); }
  .welcome-card-icon {
    width: 36px; height: 36px; border-radius: 9px;
    background: var(--accent-light); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 700; margin-bottom: 10px;
  }
  .welcome-card-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .welcome-card-desc { font-size: 12px; color: var(--text3); line-height: 1.5; }

  /* ---- ANIMATIONS ---- */
  @keyframes typeBounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes voicePulse {
    0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); }
    70% { box-shadow: 0 0 0 14px rgba(220,38,38,0); }
    100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
  }
  @keyframes voiceWave {
    0%, 100% { height: 8px; }
    50% { height: 28px; }
  }
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeSlideIn 0.25s ease; }
  .new-item { animation: fadeSlideIn 0.3s ease; }

  input[type="file"] { display: none; }
  textarea::-webkit-scrollbar { width: 4px; }
  textarea::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
`;

// ============================================================
// UTILITIES
// ============================================================
function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const PRIORITY_CLASS = { CRITICAL: 'badge-critical', HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' };
const STATUS_CLASS = { pending: 'badge-pending', in_progress: 'badge-in_progress', resolved: 'badge-resolved' };
const STATUS_LABEL = { pending: 'Pending', in_progress: 'In Progress', resolved: 'Resolved' };
const DEPT_COLORS = {
  'Road Maintenance': '#1a56db', 'Sanitation': '#0d9488',
  'Water Supply': '#0891b2', 'Electrical Department': '#d97706', 'General Administration': '#7c3aed'
};
const CHART_COLORS = ['#1a56db', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

// ============================================================
// SMALL COMPONENTS
// ============================================================
function PriorityBadge({ priority }) {
  return <span className={`badge ${PRIORITY_CLASS[priority] || 'badge-medium'}`}>{priority}</span>;
}
function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_CLASS[status] || 'badge-pending'}`}>{STATUS_LABEL[status] || status}</span>;
}

function ComplaintCard({ complaint, onClick }) {
  return (
    <div className={`complaint-card ${complaint.priority} new-item`} onClick={() => onClick && onClick(complaint)}>
      <div className="complaint-top">
        <span className="complaint-type">{complaint.issueType}</span>
        <div className="complaint-badges">
          <PriorityBadge priority={complaint.priority} />
          <StatusBadge status={complaint.status} />
        </div>
      </div>
      <div className="complaint-desc">{complaint.description}</div>
      <div className="complaint-meta">
        <span className="complaint-ticket">{complaint.ticketId}</span>
        <span className="complaint-dept">{complaint.department}</span>
        <span className="complaint-loc">{complaint.location?.text}</span>
        <span className="complaint-time">{timeAgo(complaint.timestamp)}</span>
      </div>
    </div>
  );
}

// ============================================================
// COMPLAINT DETAIL MODAL
// ============================================================
function ComplaintModal({ complaint, onClose, onUpdate }) {
  const [status, setStatus] = useState(complaint.status);
  const [notes, setNotes] = useState(complaint.notes || '');
  const [officerName, setOfficerName] = useState(complaint.officerName || '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const steps = [
    { label: 'Complaint Registered', sub: `Ticket ${complaint.ticketId} created`, state: 'done' },
    { label: 'AI Processing Complete', sub: `Classified as ${complaint.issueType} — ${Math.round((complaint.aiConfidence || 0.85) * 100)}% confidence`, state: 'done' },
    { label: 'Assigned to Department', sub: complaint.department, state: 'done' },
    { label: 'Work In Progress', sub: 'Field team dispatched', state: ['in_progress', 'resolved'].includes(complaint.status) ? (complaint.status === 'resolved' ? 'done' : 'active') : 'pending' },
    { label: 'Issue Resolved', sub: 'Complaint closed', state: complaint.status === 'resolved' ? 'done' : 'pending' }
  ];

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await onUpdate(complaint.id, { status, notes, officerName });
      setSaveMsg('Updated successfully.');
      setTimeout(onClose, 800);
    } catch {
      setSaveMsg('Update failed. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fade-in" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{complaint.issueType}</div>
            <div className="flex-row" style={{ marginTop: 6 }}>
              <span className="complaint-ticket" style={{ fontSize: 13 }}>{complaint.ticketId}</span>
              <PriorityBadge priority={complaint.priority} />
              <StatusBadge status={complaint.status} />
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div style={{ background: 'var(--bg2)', borderRadius: 9, padding: '11px 13px', marginBottom: 16, fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, border: '1px solid var(--border)' }}>
          {complaint.description}
        </div>

        <div className="detail-grid">
          <div className="detail-field"><div className="detail-key">Department</div><div className="detail-val">{complaint.department}</div></div>
          <div className="detail-field"><div className="detail-key">Location</div><div className="detail-val">{complaint.location?.text}</div></div>
          <div className="detail-field"><div className="detail-key">Citizen</div><div className="detail-val">{complaint.citizenName}</div></div>
          <div className="detail-field"><div className="detail-key">Channel</div><div className="detail-val" style={{ textTransform: 'capitalize' }}>{complaint.channel}</div></div>
          <div className="detail-field"><div className="detail-key">Language</div><div className="detail-val">{complaint.detectedLanguage}</div></div>
          <div className="detail-field"><div className="detail-key">Community Votes</div><div className="detail-val">{complaint.upvotes} upvotes</div></div>
        </div>

        <div className="detail-field mb-16">
          <div className="detail-key" style={{ marginBottom: 8 }}>AI Confidence Score</div>
          <div className="confidence-row">
            <div className="conf-bar">
              <div className="conf-fill" style={{ width: `${(complaint.aiConfidence || 0.85) * 100}%` }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>
              {Math.round((complaint.aiConfidence || 0.85) * 100)}%
            </span>
          </div>
        </div>

        <div className="section-title">Progress Timeline</div>
        <div className="timeline mb-16">
          {steps.map((s, i) => (
            <div key={i} className="tl-item">
              <div className="tl-left">
                <div className={`tl-dot ${s.state}`} />
                {i < steps.length - 1 && <div className={`tl-line ${s.state === 'done' ? 'done' : 'pending'}`} />}
              </div>
              <div className="tl-content">
                <div className={`tl-label ${s.state}`}>{s.label}</div>
                <div className="tl-sub">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="divider" />
        <div className="section-title">Update Complaint</div>

        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Officer Name</label>
          <input className="form-input" value={officerName} onChange={e => setOfficerName(e.target.value)} placeholder="Enter officer name" />
        </div>
        <div className="form-group">
          <label className="form-label">Resolution Notes</label>
          <textarea className="form-input form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe action taken or current status..." />
        </div>

        {saveMsg && (
          <div style={{ marginBottom: 10, fontSize: 12, color: saveMsg.includes('success') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
            {saveMsg}
          </div>
        )}

        <button className="btn btn-success btn-full" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// MAP VIEW - Leaflet
// ============================================================
function MapView({ complaints }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !ref.current) return;

    const loadLeaflet = () => {
      if (!window.L) {
        setTimeout(loadLeaflet, 200);
        return;
      }
      const L = window.L;
      const map = L.map(ref.current).setView([28.6139, 77.2090], 12);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      const colors = { CRITICAL: '#dc2626', HIGH: '#d97706', MEDIUM: '#1a56db', LOW: '#0d9488' };

      complaints.forEach(c => {
        if (!c.location?.lat) return;
        const color = colors[c.priority] || '#1a56db';
        const icon = L.divIcon({
          html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
          className: '', iconSize: [22, 22], iconAnchor: [11, 11]
        });
        L.marker([c.location.lat, c.location.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:Inter,sans-serif;font-size:12px;min-width:180px">
              <div style="font-weight:700;margin-bottom:4px">${c.ticketId} — ${c.issueType}</div>
              <div style="color:#4b5563;margin-bottom:4px">${c.location.text}</div>
              <div style="display:flex;gap:5px">
                <span style="background:${color}22;color:${color};padding:2px 7px;border-radius:99px;font-weight:700;font-size:11px">${c.priority}</span>
                <span style="background:#f3f4f6;color:#6b7280;padding:2px 7px;border-radius:99px;font-size:11px">${STATUS_LABEL[c.status]}</span>
              </div>
            </div>
          `);
      });
    };

    if (!window.L) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);

      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = loadLeaflet;
      document.head.appendChild(js);
    } else {
      loadLeaflet();
    }
  }, [complaints]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

// ============================================================
// PAGES - CITIZEN
// ============================================================
function WelcomePage({ onNavigate }) {
  const cards = [
    { id: 'chat', icon: 'C', title: 'Report via Chat', desc: 'Describe your issue in natural language — English, Hindi, or Hinglish' },
    { id: 'image', icon: 'I', title: 'Upload Image', desc: 'AI vision automatically detects and classifies civic issues from photos' },
    { id: 'voice', icon: 'V', title: 'Voice Report', desc: 'Record a voice complaint and let AI transcribe and process it' },
    { id: 'track', icon: 'T', title: 'Track Complaint', desc: 'Check the real-time status of your filed complaints' }
  ];
  return (
    <div className="welcome-wrap fade-in">
      <div className="welcome-logo">CA</div>
      <h1 className="welcome-title">CivicAI Platform</h1>
      <p className="welcome-desc">
        AI-powered civic governance connecting citizens to municipal officers.
        Report infrastructure issues, track resolutions, and build a better city — together.
      </p>
      <div className="welcome-grid">
        {cards.map(c => (
          <div key={c.id} className="welcome-card" onClick={() => onNavigate(c.id)}>
            <div className="welcome-card-icon">{c.icon}</div>
            <div className="welcome-card-title">{c.title}</div>
            <div className="welcome-card-desc">{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Opt-in geolocation: nothing is requested until the citizen presses the button.
function LocationShare() {
  const [state, setState] = useState(geoStore.get() ? 'on' : 'off');
  const [err, setErr] = useState('');
  const enable = async () => {
    setErr('');
    try { await geoStore.request(); setState('on'); } catch (e) { setErr(e.message); }
  };
  const disable = () => { geoStore.clear(); setState('off'); };
  return (
    <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' }}>
      {state === 'on'
        ? <><span style={{ color: 'var(--green)', fontWeight: 600 }}>Location shared for more accurate reporting.</span><button className="btn btn-outline btn-sm" onClick={disable}>Stop sharing</button></>
        : <><button className="btn btn-outline btn-sm" onClick={enable}>Use my location</button><span>Optional. Improves accuracy; only approximate area is used in public analysis.</span></>}
      {err && <span style={{ color: 'var(--red)' }} role="alert">{err}</span>}
    </div>
  );
}

function RequestNote({ request }) {
  if (!request) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text2)', background: 'var(--accent-light)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
      Recorded as a development need: <b>{request.categoryLabel}</b>{request.subcategoryLabel ? ` - ${request.subcategoryLabel}` : ''}
      {request.regionName ? <> in <b>{request.regionName}</b></> : <> (location to be confirmed)</>}. Similar requests from your area are grouped so planners can see the shared need.
    </div>
  );
}

function FeedbackForm({ complaint }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [state, setState] = useState({ sent: false, error: '' });
  if (complaint.status !== 'resolved') return null;
  if (state.sent) return <div style={{ marginTop: 14, fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>Thank you - your feedback helps measure real outcomes.</div>;
  const send = async () => {
    try { await citizenAPI.sendFeedback(complaint.id, rating, comment); setState({ sent: true, error: '' }); }
    catch (e) { setState({ sent: false, error: e.message }); }
  };
  return (
    <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
      <div className="section-title">Was your issue fixed to your satisfaction?</div>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }} role="radiogroup" aria-label="Satisfaction rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} role="radio" aria-checked={rating === n} className={`btn btn-sm ${rating === n ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRating(n)}>{n}</button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>1 = not resolved, 5 = fully resolved</span>
      </div>
      <textarea className="form-input" rows={2} maxLength={300} placeholder="Optional comment (do not include personal details)" value={comment} onChange={e => setComment(e.target.value)} />
      {state.error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }} role="alert">{state.error}</div>}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={!rating} onClick={send}>Submit feedback</button>
    </div>
  );
}

function ChatPage() {
  const [messages, setMessages] = useState([
    {
      id: 1, role: 'bot',
      content: 'Welcome to CivicAI. I can help you report civic issues such as potholes, garbage overflow, broken streetlights, water leakage, or damaged infrastructure. You can write in English, Hindi, or Hinglish.',
      timestamp: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    const userMsg = { id: Date.now(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(p => [...p, userMsg]);
    setInput(''); setError('');
    setLoading(true);

    try {
      const data = await citizenAPI.chat(text, messages.slice(-6), sessionId);
      setSessionId(data.sessionId);
      setMessages(p => [...p, { id: Date.now() + 1, role: 'bot', content: data.duplicate ? `${data.reply}\n\n(This looks like a repeat of a request you already sent, so it was linked to your existing ticket.)` : data.reply, complaint: data.complaint, request: data.request, timestamp: new Date().toISOString() }]);
    } catch (err) {
      setError(err.message || 'Could not connect to server. Please ensure the backend is running on port 3001.');
    }
    setLoading(false);
  };

  const quickMessages = [
    'There is a pothole near Sector 14 metro station',
    'Garbage overflow on Main Market Road',
    'Street light not working near the park',
    'Water pipe burst on NH-8 underpass'
  ];

  return (
    <div className="chat-wrap">
      <div className="chat-header">
        <div className="chat-avatar">AI</div>
        <div>
          <div className="chat-agent-name">CivicAI Assistant</div>
          <div className="chat-agent-status">Online — AI Powered</div>
        </div>
        <div className="chat-lang-note">Supports English, Hindi, Hinglish</div>
      </div>
      <div style={{ padding: '8px 14px 0' }}><LocationShare /></div>
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`msg msg-${msg.role}`}>
            <div className="msg-bubble">{msg.content}</div>
            {msg.complaint && (
              <div className="msg-ticket">
                <div className="msg-ticket-title">Complaint Registered Successfully</div>
                <div className="msg-ticket-row"><span className="msg-ticket-key">Ticket ID</span><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{msg.complaint.ticketId}</span></div>
                <div className="msg-ticket-row"><span className="msg-ticket-key">Issue Type</span><span>{msg.complaint.issueType}</span></div>
                <div className="msg-ticket-row"><span className="msg-ticket-key">Priority</span><span><PriorityBadge priority={msg.complaint.priority} /></span></div>
                <div className="msg-ticket-row"><span className="msg-ticket-key">Assigned To</span><span>{msg.complaint.department}</span></div>
                <div className="msg-ticket-row"><span className="msg-ticket-key">AI Confidence</span><span>{Math.round((msg.complaint.aiConfidence || 0.85) * 100)}%</span></div>
              </div>
            )}
            {msg.request && <RequestNote request={msg.request} />}
            <div className="msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
        {loading && (
          <div className="msg msg-bot">
            <div className="typing-indicator">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
          </div>
        )}
        {error && <div style={{ textAlign: 'center', color: 'var(--red)', fontSize: 12, padding: 8, background: 'var(--red-light)', borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)' }}>{error}</div>}
        <div ref={endRef} />
      </div>
      <div className="chat-input-wrap">
        <div className="chat-quick-btns">
          {quickMessages.map((q, i) => (
            <button key={i} className="quick-btn" onClick={() => setInput(q)}>{q.length > 38 ? q.slice(0, 38) + '...' : q}</button>
          ))}
        </div>
        <div className="chat-input-row">
          <textarea
            className="chat-textarea" rows={2}
            placeholder="Describe the civic issue in your area..."
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="send-btn" onClick={send} disabled={loading || !input.trim()}>--&gt;</button>
        </div>
      </div>
    </div>
  );
}

function ImagePage() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [location, setLocation] = useState('');
  const [citizenName, setCitizenName] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) { setError('Please select a valid image file.'); return; }
    const reader = new FileReader();
    reader.onload = e => { setPreview(e.target.result); setImage(e.target.result); setError(''); };
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!image) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await citizenAPI.analyzeImage(image, location, citizenName);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Analysis failed. Please check the backend connection.');
    }
    setLoading(false);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Image-Based Reporting</h1>
        <p className="page-subtitle">Upload a photo — AI vision will automatically detect and classify the civic issue</p>
      </div>
      <LocationShare />
      <div className="grid-2">
        <div>
          <div
            className={`upload-zone ${drag ? 'drag-active' : ''}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
          >
            {preview
              ? <img src={preview} alt="Preview" style={{ maxHeight: 200, borderRadius: 9, maxWidth: '100%', display: 'block', margin: '0 auto' }} />
              : (
                <>
                  <div className="upload-icon">[ ]</div>
                  <div className="upload-title">Drop image here or click to upload</div>
                  <div className="upload-hint">JPG, PNG, WebP — AI will detect issues automatically</div>
                </>
              )
            }
          </div>
          <input type="file" ref={fileRef} accept="image/*" onChange={e => handleFile(e.target.files[0])} />

          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="form-input" placeholder="Location (e.g. Sector 14, Main Road)" value={location} onChange={e => setLocation(e.target.value)} />
            <input className="form-input" placeholder="Your name (optional)" value={citizenName} onChange={e => setCitizenName(e.target.value)} />
            <button className="btn btn-primary btn-full" onClick={analyze} disabled={!image || loading}>
              {loading ? 'Analyzing...' : 'Analyze Image'}
            </button>
          </div>

          {error && <div style={{ marginTop: 10, padding: '9px 12px', background: 'var(--red-light)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>}

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">Computer Vision Capabilities</div>
            {['Pothole Detection', 'Garbage Overflow Classification', 'Infrastructure Damage Assessment', 'Water Leakage Identification', 'Streetlight Status Detection'].map(c => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', marginBottom: 7 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                {c}
              </div>
            ))}
          </div>
        </div>

        <div>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14 }}>
              <div className="ai-spinner" style={{ width: 40, height: 40, border: '3px solid rgba(26,86,219,0.15)', borderTopColor: 'var(--accent)' }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>Analyzing with AI Vision...</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Running object detection pipeline</div>
            </div>
          )}

          {result && !loading && (
            <div className="fade-in">
              <div className="section-title">Detection Results</div>
              <div className="card mb-12">
                <div className="flex-between mb-12">
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{result.vision?.issueType}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                      Severity: <span style={{ color: result.vision?.severity === 'severe' ? 'var(--red)' : 'var(--orange)', fontWeight: 600 }}>{result.vision?.severity}</span>
                    </div>
                  </div>
                  <PriorityBadge priority={result.vision?.priority} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8 }}>
                  {result.vision?.description}
                </div>
                <div className="detail-key" style={{ marginBottom: 7 }}>AI Confidence</div>
                <div className="confidence-row">
                  <div className="conf-bar">
                    <div className="conf-fill" style={{ width: `${(result.vision?.confidence || 0.85) * 100}%` }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>{Math.round((result.vision?.confidence || 0.85) * 100)}%</span>
                </div>
              </div>

              {result.complaint && (
                <div className="result-box">
                  <div className="result-box-title">Ticket Auto-Generated</div>
                  <div className="detail-grid" style={{ marginBottom: 0 }}>
                    <div className="detail-field"><div className="detail-key">Ticket ID</div><div className="detail-val" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{result.complaint.ticketId}</div></div>
                    <div className="detail-field"><div className="detail-key">Priority</div><div className="detail-val"><PriorityBadge priority={result.complaint.priority} /></div></div>
                    <div className="detail-field"><div className="detail-key">Department</div><div className="detail-val">{result.complaint.department}</div></div>
                    <div className="detail-field"><div className="detail-key">Status</div><div className="detail-val"><StatusBadge status={result.complaint.status} /></div></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!result && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
              <div className="empty-state">
                <div className="empty-icon">[ ]</div>
                <div>Upload an image to see detection results</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VoicePage() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const recogRef = useRef(null);

  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in your browser. Please type your complaint in the text area below.');
      return;
    }
    const r = new SpeechRecognition();
    r.continuous = true; r.interimResults = true; r.lang = 'en-IN';
    r.onresult = e => {
      const t = Array.from(e.results).map(x => x[0].transcript).join(' ');
      setTranscript(t);
    };
    r.onerror = e => setError(`Speech recognition error: ${e.error}`);
    r.start();
    recogRef.current = r;
    setRecording(true); setError('');
  };

  const stopRecording = () => {
    recogRef.current?.stop();
    setRecording(false);
  };

  const submit = async () => {
    if (!transcript.trim()) return;
    setLoading(true); setError('');
    try {
      const data = await citizenAPI.submitVoice(transcript);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Submission failed. Please check backend connection.');
    }
    setLoading(false);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Voice Complaint</h1>
        <p className="page-subtitle">Record your complaint using voice — AI will transcribe and process it automatically</p>
      </div>
      <LocationShare />
      <div style={{ maxWidth: 640 }}>
        <div className="card mb-16">
          <div className="voice-center">
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
              {recording ? 'Recording... speak clearly about the civic issue' : 'Click the button to start recording'}
            </div>
            <button className={`voice-btn ${recording ? 'recording' : 'idle'}`} onClick={recording ? stopRecording : startRecording}>
              {recording ? '||' : 'REC'}
            </button>
            {recording && (
              <div className="voice-bars">
                {[1,2,3,4,5].map(i => <div key={i} className="voice-bar" style={{ animationDelay: `${i * 0.1}s` }} />)}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
              {recording ? 'Click Stop when done' : 'Supports English and Hindi — uses browser Web Speech API'}
            </div>
          </div>

          <div className="divider" />

          <div className="form-group">
            <label className="form-label">Transcript</label>
            <textarea
              className="form-input form-textarea" rows={4}
              placeholder="Your voice transcript will appear here, or type your complaint manually..."
              value={transcript} onChange={e => setTranscript(e.target.value)}
            />
          </div>

          {error && <div style={{ marginBottom: 10, padding: '9px 12px', background: 'var(--red-light)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>}

          <button className="btn btn-primary btn-full" onClick={submit} disabled={!transcript.trim() || loading}>
            {loading ? 'Processing...' : 'Submit Voice Complaint'}
          </button>
        </div>

        {result?.complaint && (
          <div className="result-box fade-in">
            <div className="result-box-title">Voice Complaint Submitted</div>
            <div className="detail-grid" style={{ marginBottom: 0 }}>
              <div className="detail-field"><div className="detail-key">Ticket ID</div><div className="detail-val" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{result.complaint.ticketId}</div></div>
              <div className="detail-field"><div className="detail-key">Issue Type</div><div className="detail-val">{result.complaint.issueType}</div></div>
              <div className="detail-field"><div className="detail-key">Priority</div><div className="detail-val"><PriorityBadge priority={result.complaint.priority} /></div></div>
              <div className="detail-field"><div className="detail-key">Department</div><div className="detail-val">{result.complaint.department}</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrackPage() {
  const [ticketId, setTicketId] = useState('');
  const [complaint, setComplaint] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const track = async () => {
    if (!ticketId.trim()) return;
    setLoading(true); setError(''); setComplaint(null);
    try {
      const data = await citizenAPI.trackComplaint(ticketId.trim().toUpperCase());
      setComplaint(data);
    } catch (err) {
      setError(err.message || 'Complaint not found.');
    }
    setLoading(false);
  };

  const steps = complaint ? [
    { label: 'Complaint Registered', sub: `Ticket created: ${complaint.ticketId}`, state: 'done' },
    { label: 'AI Processing', sub: `Classified as ${complaint.issueType}`, state: 'done' },
    { label: 'Department Assigned', sub: complaint.department, state: 'done' },
    { label: 'Work In Progress', sub: 'Field team dispatched', state: ['in_progress', 'resolved'].includes(complaint.status) ? (complaint.status === 'resolved' ? 'done' : 'active') : 'pending' },
    { label: 'Issue Resolved', sub: 'Complaint closed', state: complaint.status === 'resolved' ? 'done' : 'pending' }
  ] : [];

  return (
    <div className="fade-in" style={{ maxWidth: 580 }}>
      <div className="page-header">
        <h1 className="page-title">Track Your Complaint</h1>
        <p className="page-subtitle">Enter your ticket ID to check the current resolution status</p>
      </div>

      <div className="card mb-16">
        <div style={{ display: 'flex', gap: 9 }}>
          <input
            className="form-input" style={{ flex: 1 }}
            placeholder="Enter ticket ID (e.g. TKT-001)"
            value={ticketId} onChange={e => setTicketId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && track()}
          />
          <button className="btn btn-primary" onClick={track} disabled={loading || !ticketId.trim()}>
            {loading ? '...' : 'Track'}
          </button>
        </div>
        {error && <div style={{ marginTop: 9, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        <div style={{ marginTop: 9, fontSize: 12, color: 'var(--text3)' }}>
          Demo tickets: TKT-001, TKT-002, TKT-003, TKT-004, TKT-005, TKT-006
        </div>
      </div>

      {complaint && (
        <div className="card fade-in">
          <div className="flex-between mb-12">
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{complaint.issueType}</div>
              <div className="flex-row">
                <span className="complaint-ticket" style={{ fontSize: 13 }}>{complaint.ticketId}</span>
                <PriorityBadge priority={complaint.priority} />
                <StatusBadge status={complaint.status} />
              </div>
            </div>
          </div>

          <div style={{ padding: '10px 13px', background: 'var(--bg2)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, border: '1px solid var(--border)' }}>
            {complaint.description}
          </div>

          <div className="detail-grid mb-16">
            <div className="detail-field"><div className="detail-key">Location</div><div className="detail-val">{complaint.location?.text}</div></div>
            <div className="detail-field"><div className="detail-key">Department</div><div className="detail-val">{complaint.department}</div></div>
            <div className="detail-field"><div className="detail-key">Filed On</div><div className="detail-val">{new Date(complaint.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
            <div className="detail-field"><div className="detail-key">Last Updated</div><div className="detail-val">{timeAgo(complaint.updatedAt)}</div></div>
          </div>

          {complaint.notes && (
            <div style={{ padding: '10px 13px', background: 'var(--green-light)', border: '1px solid rgba(13,148,136,0.2)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Officer Notes</div>
              {complaint.notes}
            </div>
          )}

          <div className="section-title">Progress</div>
          <div className="timeline">
            {steps.map((s, i) => (
              <div key={i} className="tl-item">
                <div className="tl-left">
                  <div className={`tl-dot ${s.state}`} />
                  {i < steps.length - 1 && <div className={`tl-line ${s.state === 'done' ? 'done' : 'pending'}`} />}
                </div>
                <div className="tl-content">
                  <div className={`tl-label ${s.state}`}>{s.label}</div>
                  <div className="tl-sub">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
          <FeedbackForm complaint={complaint} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// PAGES - OFFICER DASHBOARD
// ============================================================
function OfficerDashboard({ officer }) {
  const [tab, setTab] = useState('overview');
  const [complaints, setComplaints] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [insights, setInsights] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', department: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [cData, aData] = await Promise.all([
        officerAPI.getComplaints(),
        officerAPI.getAnalytics()
      ]);
      setComplaints(cData.complaints || []);
      setAnalytics(aData);
    } catch (err) {
      setError(`Failed to load data: ${err.message}. Make sure the backend is running on port 3001.`);
    }
    setLoading(false);
  }, []);

  const loadInsights = useCallback(async () => {
    try {
      const data = await officerAPI.getInsights();
      setInsights(data);
    } catch {}
  }, []);

  const loadPredictions = useCallback(async () => {
    try {
      const data = await officerAPI.getPredictions();
      setPredictions(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
    loadInsights();
    loadPredictions();
    const cleanup = createWebSocket(
      ({ event, data }) => {
        if (event === 'new_complaint') {
          setComplaints(prev => [data, ...prev]);
          setAnalytics(prev => prev ? { ...prev, total: prev.total + 1, pending: prev.pending + 1 } : prev);
        } else if (event === 'complaint_updated') {
          setComplaints(prev => prev.map(c => c.id === data.id ? data : c));
          loadData();
        }
      }
    );
    return cleanup;
  }, [loadData, loadInsights]);

  const handleUpdate = async (id, updates) => {
    await officerAPI.updateComplaint(id, updates);
    await loadData();
  };

  const filtered = complaints.filter(c => {
    const s = filters.search.toLowerCase();
    return (
      (!s || c.description?.toLowerCase().includes(s) || c.issueType?.toLowerCase().includes(s) || c.ticketId?.toLowerCase().includes(s) || c.location?.text?.toLowerCase().includes(s)) &&
      (!filters.status || c.status === filters.status) &&
      (!filters.priority || c.priority === filters.priority) &&
      (!filters.department || c.department === filters.department)
    );
  });

  if (loading) return <div className="empty-state"><div className="ai-spinner" style={{ width: 32, height: 32, margin: '0 auto 12px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} /><div>Loading dashboard...</div></div>;

  return (
    <div className="fade-in">
      {selectedComplaint && <ComplaintModal complaint={selectedComplaint} onClose={() => setSelectedComplaint(null)} onUpdate={handleUpdate} />}

      <div className="flex-between mb-20">
        <div>
          <h1 className="page-title">Officer Dashboard</h1>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>Municipal Control Center — Real-time complaint management</p>
        </div>
        <div className="flex-row">
          <button className="btn btn-outline btn-sm" onClick={loadData}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--red-light)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 9, fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      {analytics && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total Complaints</div>
            <div className="stat-value blue">{analytics.total}</div>
            <div className="stat-sub">All time</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pending</div>
            <div className="stat-value orange">{analytics.pending}</div>
            <div className="stat-sub">Awaiting action</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">In Progress</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{analytics.inProgress}</div>
            <div className="stat-sub">Active tasks</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Resolved</div>
            <div className="stat-value green">{analytics.resolved}</div>
            <div className="stat-sub">{analytics.resolutionRate ?? 0}% resolution rate</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 9, padding: 3, marginBottom: 20, width: 'fit-content' }}>
        {[['overview', 'Overview'], ['complaints', 'Complaints'], ['map', 'Map View'], ['analytics', 'Analytics'], ['insights', 'AI Insights'], ['predictions', 'Predictions']].map(([v, l]) => (
          <button key={v}
            style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: tab === v ? 'var(--white)' : 'transparent', color: tab === v ? 'var(--accent)' : 'var(--text2)', boxShadow: tab === v ? 'var(--shadow-sm)' : 'none', fontFamily: 'var(--font)', transition: 'all 0.15s' }}
            onClick={() => setTab(v)}
          >{l}</button>
        ))}
      </div>

      {tab === 'overview' && analytics && (
        <div>
          <div className="charts-grid mb-16">
            <div className="card">
              <div className="card-title">Complaints by Department</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analytics.byDepartment} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: 'white', border: '1px solid #dde3ec', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {analytics.byDepartment.map((d, i) => (
                      <Cell key={i} fill={DEPT_COLORS[d.name] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-title">Issue Type Distribution</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={analytics.byType} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {analytics.byType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'white', border: '1px solid #dde3ec', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card mb-16">
            <div className="card-title">Recent Complaints</div>
            <div className="complaint-list">
              {analytics.recentComplaints?.map(c => <ComplaintCard key={c.id} complaint={c} onClick={setSelectedComplaint} />)}
            </div>
          </div>
        </div>
      )}

      {tab === 'complaints' && (
        <div>
          <div className="filter-bar">
            <input className="form-input" placeholder="Search by description, ticket ID, or location..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} style={{ flex: 2 }} />
            <select className="form-select" value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))} style={{ minWidth: 130 }}>
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
            <select className="form-select" value={filters.priority} onChange={e => setFilters(p => ({ ...p, priority: e.target.value }))} style={{ minWidth: 130 }}>
              <option value="">All Priority</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <select className="form-select" value={filters.department} onChange={e => setFilters(p => ({ ...p, department: e.target.value }))} style={{ minWidth: 160 }}>
              <option value="">All Departments</option>
              <option value="Road Maintenance">Road Maintenance</option>
              <option value="Sanitation">Sanitation</option>
              <option value="Water Supply">Water Supply</option>
              <option value="Electrical Department">Electrical Department</option>
            </select>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Showing {filtered.length} of {complaints.length} complaints — Click any complaint to view details and update status
          </div>
          <div className="complaint-list">
            {filtered.map(c => <ComplaintCard key={c.id} complaint={c} onClick={setSelectedComplaint} />)}
            {!filtered.length && <div className="empty-state"><div className="empty-icon">[ ]</div><div>No complaints match your filters</div></div>}
          </div>
        </div>
      )}

      {tab === 'map' && (
        <div className="card">
          <div className="flex-between mb-16">
            <div className="card-title" style={{ marginBottom: 0 }}>City Complaint Map</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[['Critical', '#dc2626'], ['High', '#d97706'], ['Medium', '#1a56db'], ['Low', '#0d9488']].map(([l, c]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)' }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: c }} /> {l}
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 500, borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <MapView complaints={complaints} />
          </div>
        </div>
      )}

      {tab === 'analytics' && analytics && (
        <div>
          <div className="charts-grid mb-16">
            <div className="card chart-full">
              <div className="card-title">Weekly Resolution Trend</div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={[
                  { day: 'Mon', resolved: 4, new: 7 }, { day: 'Tue', resolved: 6, new: 5 },
                  { day: 'Wed', resolved: 8, new: 9 }, { day: 'Thu', resolved: 5, new: 6 },
                  { day: 'Fri', resolved: 10, new: 8 }, { day: 'Sat', resolved: 7, new: 4 },
                  { day: 'Today', resolved: analytics.resolved, new: analytics.pending }
                ]} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'white', border: '1px solid #dde3ec', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="resolved" stroke="#0d9488" fill="rgba(13,148,136,0.1)" strokeWidth={2} name="Resolved" />
                  <Area type="monotone" dataKey="new" stroke="#1a56db" fill="rgba(26,86,219,0.08)" strokeWidth={2} name="New" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-title">Department Workload</div>
              {analytics.byDepartment.map(d => (
                <div key={d.name} style={{ marginBottom: 12 }}>
                  <div className="flex-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{d.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: DEPT_COLORS[d.name] || 'var(--accent)' }}>{d.count} complaints</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(d.count / analytics.total) * 100}%`, background: DEPT_COLORS[d.name] || 'var(--accent)', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-title">Key Performance Metrics</div>
              {[
                {
                  label: 'Avg Resolution Time',
                  value: analytics.avgResolutionTime != null ? `${analytics.avgResolutionTime}h` : 'N/A',
                  color: 'var(--accent)'
                },
                {
                  label: 'Resolution Rate',
                  value: `${analytics.resolutionRate ?? 0}%`,
                  color: 'var(--green)'
                },
                {
                  label: 'AI Confidence (avg)',
                  value: analytics.aiAccuracy != null ? `${analytics.aiAccuracy}%` : 'N/A',
                  color: 'var(--purple)'
                },
                {
                  label: 'Pending Complaints',
                  value: `${analytics.pending}`,
                  color: analytics.pending > 10 ? 'var(--red)' : 'var(--orange)'
                }
              ].map(m => (
                <div key={m.label} className="flex-between" style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>{m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Hotspot Areas</div>
            {analytics.hotspots?.length
              ? analytics.hotspots.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--border2)', width: 28 }}>#{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{h.location}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{h.type} — {h.count} community votes</div>
                  </div>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: i === 0 ? 'var(--red)' : i === 1 ? 'var(--orange)' : 'var(--accent)' }} />
                </div>
              ))
              : <div style={{ fontSize: 13, color: 'var(--text3)' }}>No hotspots detected yet.</div>
            }
          </div>
        </div>
      )}

      {tab === 'insights' && (
        <div>
          <div className="info-box mb-16">
            AI-generated insights from analyzing {complaints.length} complaints using language model analysis.
            These insights help prioritize municipal resources and predict infrastructure issues.
          </div>
          {insights ? (
            <div className="insights-grid">
              {[
                { key: 'topIssue', label: 'Most Common Issue' },
                { key: 'criticalHotspot', label: 'Critical Hotspot' },
                { key: 'recommendation', label: 'AI Recommendation' },
                { key: 'trend', label: 'Current Trend' },
                { key: 'departmentAlert', label: 'Department Alert' },
                { key: 'predictedIssues', label: 'Predicted Issues' }
              ].map(({ key, label }) => (
                <div key={key} className="insight-card">
                  <div className="insight-key">{label}</div>
                  <div className="insight-val">{insights[key]}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="ai-spinner" style={{ width: 32, height: 32, margin: '0 auto 12px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
              <div>Generating AI insights...</div>
            </div>
          )}
        </div>
      )}

      {tab === 'predictions' && (
        <div>
          {/* ── Header ───────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Predictive Urban Intelligence</h2>
                {predictions?.narrativeModel && (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '2px 8px', borderRadius: 4, background: predictions.narrativeModel === 'fallback' ? '#f3f4f6' : '#eff4ff', color: predictions.narrativeModel === 'fallback' ? '#6b7280' : '#1a56db', border: '1px solid', borderColor: predictions.narrativeModel === 'fallback' ? '#e5e7eb' : '#bfdbfe' }}>
                    {predictions.narrativeModel === 'mistral-7b' ? '⚡ Mistral-7B' : predictions.narrativeModel === 'anthropic-fallback' ? '⚡ Claude' : '◈ Statistical'}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text3)', maxWidth: 560, margin: 0 }}>
                Statistical trend analysis narrated by AI — complaint velocity, unresolved backlog, and severity pressure per ward.
              </p>
            </div>
            <button className="btn btn-outline btn-sm" onClick={loadPredictions}>Refresh</button>
          </div>

          {/* ── City-wide headline alert (from Mistral) ───────────────────── */}
          {predictions?.headline && (
            <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a56db 100%)', borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ fontSize: 20, lineHeight: 1, marginTop: 2, flexShrink: 0 }}>⚠</div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#93c5fd', marginBottom: 4 }}>INTELLIGENCE BRIEFING</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', lineHeight: 1.4 }}>{predictions.headline}</div>
              </div>
            </div>
          )}

          {/* ── Summary stats ─────────────────────────────────────────────── */}
          {predictions?.summary && (
            <div className="stats-row" style={{ marginBottom: 24 }}>
              <div className="stat-card" style={{ borderTop: '3px solid #dc2626' }}>
                <div className="stat-label">High Risk Zones</div>
                <div className="stat-value" style={{ color: '#dc2626' }}>{predictions.summary.highRisk}</div>
                <div className="stat-sub">Immediate attention</div>
              </div>
              <div className="stat-card" style={{ borderTop: '3px solid #d97706' }}>
                <div className="stat-label">Medium Risk Zones</div>
                <div className="stat-value orange">{predictions.summary.mediumRisk}</div>
                <div className="stat-sub">Schedule inspection</div>
              </div>
              <div className="stat-card" style={{ borderTop: '3px solid #1a56db' }}>
                <div className="stat-label">Wards at Risk</div>
                <div className="stat-value blue">{predictions.summary.wardsAtRisk}</div>
                <div className="stat-sub">Unique locations</div>
              </div>
              <div className="stat-card" style={{ borderTop: '3px solid #0d9488' }}>
                <div className="stat-label">Complaints Analysed</div>
                <div className="stat-value green">{predictions.summary.analysedComplaints}</div>
                <div className="stat-sub">Statistical basis</div>
              </div>
            </div>
          )}

          {/* ── Prediction cards ──────────────────────────────────────────── */}
          {predictions?.predictions?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {predictions.predictions.map(p => {
                const riskColors = {
                  HIGH:   { border: '#dc2626', badgeBg: '#fee2e2', text: '#991b1b', glow: '#dc262620' },
                  MEDIUM: { border: '#d97706', badgeBg: '#fef3c7', text: '#92400e', glow: '#d9770610' },
                  LOW:    { border: '#1a56db', badgeBg: '#dbeafe', text: '#1e40af', glow: '#1a56db08' },
                };
                const col = riskColors[p.riskLevel] || riskColors.LOW;
                // Mini velocity sparkline: draw 7 fictional bars proportional to recent vs prior
                const barCount = 7;
                const prior = p.priorCount || 0;
                const recent = p.recentCount || 0;
                const maxBar = Math.max(prior, recent, 1);
                const sparkBars = Array.from({ length: barCount }, (_, i) => {
                  // Ramp from prior/7 per day to recent/7 per day across the 7 bars
                  const t = i / (barCount - 1);
                  const h = Math.round(((prior / barCount) * (1 - t) + (recent / barCount) * t) / (maxBar / barCount) * 24);
                  return Math.max(3, Math.min(28, h));
                });

                return (
                  <div key={p.id}
                    style={{ background: 'var(--white)', border: `1px solid var(--border)`, borderLeft: `4px solid ${col.border}`, borderRadius: 10, padding: '16px 20px', transition: 'box-shadow 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>

                      {/* Left: narrative + basis + action */}
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '2px 8px', borderRadius: 4, background: col.badgeBg, color: col.text }}>{p.riskLevel} RISK</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono, monospace)' }}>{p.ward}</span>
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>·</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{p.issueType}</span>
                        </div>

                        {/* AI narrative — the LLM-generated prediction sentence */}
                        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6, lineHeight: 1.45 }}>
                          {p.narrative || p.predictionText}
                        </p>

                        {/* Statistical basis */}
                        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{p.basisText}</p>

                        {/* Recommended action */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '4px 10px' }}>
                          <span style={{ fontSize: 12, color: '#065f46', fontWeight: 600 }}>↳ {p.recommendedAction}</span>
                        </div>
                      </div>

                      {/* Right: days countdown + confidence + sparkline */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, minWidth: 130 }}>
                        {/* Days countdown */}
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 32, fontWeight: 800, color: col.border, lineHeight: 1 }}>{p.daysUntilLikely}</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.08em' }}>DAYS</div>
                        </div>

                        {/* Confidence */}
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{p.confidence}%</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)' }}>confidence</div>
                        </div>

                        {/* Velocity sparkline */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }} title={`Trend: ${p.velocityPct >= 0 ? '+' : ''}${p.velocityPct}% week-over-week`}>
                          {sparkBars.map((h, i) => (
                            <div key={i} style={{ width: 6, height: h, borderRadius: 2, background: i < barCount / 2 ? `${col.border}55` : col.border, transition: 'height 0.4s ease' }} />
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right' }}>
                          {p.velocityPct >= 0 ? '+' : ''}{p.velocityPct}% WoW
                        </div>
                      </div>
                    </div>

                    {/* Confidence progress bar */}
                    <div style={{ marginTop: 14, height: 3, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${p.confidence}%`, background: `linear-gradient(90deg, ${col.border}66, ${col.border})`, borderRadius: 2, transition: 'width 0.7s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : predictions ? (
            <div className="empty-state">
              <div className="empty-icon">◈</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No risk patterns detected</div>
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>Predictions require complaint history with active trends. Check back as more data arrives.</div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="ai-spinner" style={{ width: 32, height: 32, margin: '0 auto 12px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
              <div>Computing predictions...</div>
            </div>
          )}

          {/* ── Footer ───────────────────────────────────────────────────────── */}
          {predictions?.generatedAt && (
            <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>
              Statistical engine · {predictions.summary?.analysedComplaints || 0} complaints · {new Date(predictions.generatedAt).toLocaleTimeString()}
              {predictions.narrativeModel && predictions.narrativeModel !== 'fallback' && (
                <span> · Narrated by {predictions.narrativeModel === 'mistral-7b' ? 'Mistral-7B' : 'Claude'}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// NOTIFICATION PANEL
// ============================================================
function NotificationPanel({ onClose }) {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    citizenAPI.getNotifications()
      .then(d => setNotifications(d.notifications || []))
      .catch(() => {});
  }, []);

  return (
    <div className="notif-panel fade-in">
      <div className="notif-panel-header">
        <span>Notifications</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => citizenAPI.markAllRead().catch(() => {})}>Mark all read</button>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text3)', fontFamily: 'var(--font)' }} onClick={onClose}>x</button>
        </div>
      </div>
      {notifications.length
        ? notifications.map(n => (
          <div key={n.id} className={`notif-item ${!n.read ? 'unread' : ''}`}>
            <div className="notif-item-msg">{n.message}</div>
            <div className="notif-item-time">{timeAgo(n.timestamp)}</div>
          </div>
        ))
        : <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No notifications yet</div>
      }
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
// ============================================================
// LOGIN PAGE
// ============================================================
function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await authAPI.login(username.trim(), password);
      tokenStore.set(data.token);
      tokenStore.setOfficer(data.officer);
      onLogin(data.officer);
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '40px 36px', width: 360, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>CivicAI</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>Officer Dashboard Login</div>
        </div>
        {error && (
          <div style={{ background: 'var(--red-light)', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
            {error}
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Username</label>
          <input
            className="input"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="officer"
            autoFocus
          />
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="CivicAI@2024"
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <div style={{ marginTop: 18, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
          Default: officer / CivicAI@2024
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState('citizen');
  const [page, setPage] = useState('welcome');
  const [showNotif, setShowNotif] = useState(false);
  const [notifCount, setNotifCount] = useState(3);
  const [wsConnected, setWsConnected] = useState(false);
  const [officer, setOfficer] = useState(() => tokenStore.getOfficer());
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = globalStyles;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // Listen for auth expiry
  useEffect(() => {
    const handler = () => { setOfficer(null); setShowLogin(true); setMode('citizen'); setPage('welcome'); };
    window.addEventListener('civicai:auth-expired', handler);
    return () => window.removeEventListener('civicai:auth-expired', handler);
  }, []);

  useEffect(() => {
    const cleanup = createWebSocket(
      ({ event }) => { if (event === 'new_complaint' || event === 'escalation') setNotifCount(p => p + 1); },
      () => setWsConnected(true),
      () => setWsConnected(false)
    );
    return cleanup;
  }, []);

  const citizenNav = [
    { id: 'welcome', label: 'Home' },
    { id: 'chat', label: 'Chat Assistant' },
    { id: 'image', label: 'Image Report' },
    { id: 'voice', label: 'Voice Report' },
    { id: 'track', label: 'Track Complaint' }
  ];

  const canSeeComplaints = !officer || ['officer', 'admin'].includes(officer.role);
  const switchMode = (m) => {
    if ((m === 'officer' || m === 'policy') && !officer) {
      setShowLogin(true);
      return;
    }
    setMode(m);
    setPage(m === 'citizen' ? 'welcome' : m);
  };

  const handleLogin = (officerData) => {
    setOfficer(officerData);
    setShowLogin(false);
    const m = officerData.role === 'policymaker' ? 'policy' : 'officer';
    setMode(m);
    setPage(m);
  };

  const handleLogout = () => {
    tokenStore.clearAll();
    setOfficer(null);
    setMode('citizen');
    setPage('welcome');
  };

  if (showLogin) {
    return (
      <div className="app">
        <style>{globalStyles}</style>
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="app">
      <style>{globalStyles}</style>

      <nav className="topnav">
        <span className="nav-brand">CivicAI</span>
        <div className="nav-divider" />
        <span className="nav-subtitle">Development Demand Intelligence for Public Infrastructure</span>

        <div className="nav-mode-tabs" style={{ marginLeft: 20 }}>
          <button className={`nav-mode-btn ${mode === 'citizen' ? 'active' : ''}`} onClick={() => switchMode('citizen')}>
            Citizen Portal
          </button>
          {canSeeComplaints && (
            <button className={`nav-mode-btn ${mode === 'officer' ? 'active' : ''}`} onClick={() => switchMode('officer')}>
              Officer Dashboard
            </button>
          )}
          <button className={`nav-mode-btn ${mode === 'policy' ? 'active' : ''}`} onClick={() => switchMode('policy')}>
            Policy Intelligence
          </button>
          <button className={`nav-mode-btn ${mode === 'judge' ? 'active' : ''}`} onClick={() => switchMode('judge')}>
            Judge Mode
          </button>
        </div>

        <div className="nav-right">
          <div className="nav-status">
            <div className={`status-dot ${wsConnected ? '' : 'offline'}`} />
            {wsConnected ? 'Live' : 'Connecting...'}
          </div>
          <button className="notif-btn" onClick={() => { setShowNotif(p => !p); setNotifCount(0); }}>
            Notifications
            {notifCount > 0 && <span className="notif-count">{notifCount}</span>}
          </button>
          {officer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>{officer.name}</span>
              <button
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', cursor: 'pointer', color: 'var(--text2)', fontFamily: 'var(--font)' }}
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </nav>

      {showNotif && <NotificationPanel onClose={() => setShowNotif(false)} />}

      <div className="layout">
        {mode === 'citizen' && (
          <nav className="sidebar">
            <div className="sidebar-section-label">Citizen Portal</div>
            {citizenNav.map(item => (
              <div key={item.id} className={`sidebar-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
                <span className="sidebar-icon">
                  {item.id === 'welcome' ? 'H' : item.id === 'chat' ? 'C' : item.id === 'image' ? 'I' : item.id === 'voice' ? 'V' : 'T'}
                </span>
                {item.label}
              </div>
            ))}
            <div className="sidebar-divider" />
            <div className="sidebar-section-label">Track Complaint</div>
            <div className="sidebar-item" onClick={() => setPage('track')} style={{ fontSize: 12 }}>
              <span className="sidebar-icon" style={{ fontFamily: 'var(--font-mono)' }}>→</span>
              <span style={{ fontSize: 12 }}>Enter Ticket ID</span>
            </div>
          </nav>
        )}

        <main className="content">
          {mode === 'citizen' && page === 'welcome' && <WelcomePage onNavigate={setPage} />}
          {mode === 'citizen' && page === 'chat' && <ChatPage />}
          {mode === 'citizen' && page === 'image' && <ImagePage />}
          {mode === 'citizen' && page === 'voice' && <VoicePage />}
          {mode === 'citizen' && page === 'track' && <TrackPage />}
          {mode === 'officer' && officer && canSeeComplaints && <OfficerDashboard officer={officer} />}
          {mode === 'policy' && officer && <PolicyDashboard user={officer} />}
          {mode === 'judge' && <JudgeMode onSession={(o) => setOfficer(o)} />}
        </main>
      </div>

      <footer style={{ background: 'var(--white)', borderTop: '1px solid var(--border)', padding: '7px 20px', display: 'flex', gap: 20, fontSize: 11, color: 'var(--text3)', alignItems: 'center' }}>
        <span>AI: Mistral-7B (open-source)</span>
        <span>Computer Vision: YOLOv8</span>
        <span>Speech: Whisper + Web Speech API</span>
        <span>Maps: OpenStreetMap + Leaflet</span>
        <span>Charts: Recharts</span>
        <span style={{ marginLeft: 'auto' }}>CivicAI v4.0 - synthetic demo data is always labelled</span>
      </footer>
    </div>
  );
}

