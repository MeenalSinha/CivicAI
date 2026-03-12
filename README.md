# CivicAI

**Open-source AI-powered civic governance platform for Indian municipalities.**

Citizens report infrastructure problems via text, image, or voice. Municipal officers manage, triage, and resolve complaints through a real-time dashboard with predictive analytics.

---

## AI Stack

| Capability | Model |
|-----------|-------|
| Text classification & chat | Mistral-7B-Instruct-v0.3 (4-bit QLoRA) |
| Image analysis | YOLOv8 |
| Voice transcription | OpenAI Whisper |
| Predictive intelligence | Statistical engine + Mistral narration |
| Fallback (always on) | Rule-based classifier (no GPU/internet needed) |

Fine-tuned on **29,137 real BBMP Bengaluru complaints** across English, Hindi, and Hinglish (CivicComp-HiEn dataset, CC BY-SA 4.0).

---

## Quick Start

```bash
# 1. Copy and fill environment variables
cp backend/.env.example backend/.env
# Edit backend/.env — set HF_TOKEN and JWT_SECRET (see below)

# 2. Start all services
docker-compose --env-file backend/.env up --build
```

| URL | Service |
|-----|---------|
| http://localhost:3000 | Frontend (citizen + officer) |
| http://localhost:3001/api/health | Backend health check |
| http://localhost:8000/health | AI service status |
| http://localhost:8000/docs | FastAPI Swagger UI |

**First run downloads ~14 GB of model weights.** Subsequent runs use cached Docker volumes.

---

## Required Environment Variables

Open `backend/.env` and set these two before starting:

```env
# HuggingFace token — needed to download Mistral-7B
# Get yours at: https://huggingface.co/settings/tokens
# Accept Mistral license at: https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3
HF_TOKEN=hf_your_token_here

# 64-character random hex string — generate with:
#   openssl rand -hex 64
JWT_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX
```

Everything else has safe defaults. See `backend/.env.example` for the full list.

---

## Default Login

| Account | Username | Password |
|---------|----------|----------|
| Municipal Officer | `officer` | `CivicAI@2024` |
| Administrator | `admin` | `Admin@CivicAI2024` |

Change `DEFAULT_OFFICER_PASSWORD` in `.env` before deploying.

---

## Project Structure

```
civicai/
├── docker-compose.yml          # Full stack: ai-service + backend + frontend
├── .gitignore
├── README.md
├── SETUP_GUIDE.docx            # Detailed setup & reference guide
│
├── ai-service/                 # Python 3.11 — model inference (FastAPI, port 8000)
│   ├── main.py                 # Mistral-7B · YOLOv8 · Whisper · /predict endpoint
│   ├── requirements.txt
│   ├── Dockerfile
│   └── training/
│       ├── finetune_lora.py                    # QLoRA fine-tuning script
│       ├── civic_complaints_dataset.jsonl      # 29,137 BBMP complaints (full)
│       └── civic_complaints_starter_500.jsonl  # 500-example quick-test subset
│
├── backend/                    # Node.js 22 — REST API + WebSocket (Express, port 3001)
│   ├── server.js               # All routes, JWT auth, rate limiting, WS broadcast
│   ├── package.json
│   ├── Dockerfile
│   ├── .env.example            # ← copy this to .env and fill in
│   ├── .env                    # ← your local config (gitignored)
│   ├── ai/
│   │   └── aiService.js        # AI bridge: Mistral → Anthropic → rule-based fallback
│   ├── database/
│   │   └── db.js               # SQLite persistence + predictive engine
│   ├── middleware/
│   │   ├── auth.js             # Documentation stub (JWT lives in server.js)
│   │   └── rateLimiter.js      # Documentation stub (rate limiting in server.js)
│   └── tests/
│       └── run.js              # Test suite (runs against a fresh temp DB)
│
└── frontend/                   # React 18 — SPA served by nginx (port 3000)
    ├── src/
    │   ├── App.jsx             # All pages: chat, image, voice, track, officer dashboard
    │   ├── api.js              # API client with JWT, WebSocket, auto-reconnect
    │   └── index.js
    ├── public/
    │   └── index.html
    ├── package.json
    └── Dockerfile
```

---

## Architecture

```
Browser
  ↕ HTTP / WebSocket
Frontend (React + nginx :3000)
  ↕ REST API
Backend (Node.js + Express :3001)
  ├─ SQLite (persistent, named volume)
  ├─ JWT auth · Rate limiting · WebSocket broadcast
  ├─ Auto-escalation worker (5 min)
  └─ Predictive engine (statistical + Mistral narration)
       ↕ HTTP
AI Service (FastAPI :8000)
  ├─ Mistral-7B   → /classify · /chat · /insights · /predict
  ├─ YOLOv8      → /analyze-image
  └─ Whisper     → /transcribe
       ↓ fallback chain
Anthropic Claude API (optional, set ANTHROPIC_API_KEY)
       ↓ fallback chain
Rule-based classifier (always available)
```

All three containers share a private `civicai` Docker bridge network. Only ports 3000 and 3001 need to be exposed to the host.

---

## Features

### Citizen
- **Chat** — conversational complaint submission (Mistral-7B, EN/Hindi/Hinglish)
- **Image** — drag-and-drop photo upload (YOLOv8 detects potholes, garbage, flooding, etc.)
- **Voice** — browser recording or raw audio upload (Whisper transcription)
- **Track** — look up any complaint by ticket ID (e.g. `TKT-042`)
- **Live updates** — WebSocket feed, no polling required

### Officer Dashboard
- Complaint list with filters (status, priority, department, search)
- Real-time analytics charts (Recharts)
- Interactive map (Leaflet)
- AI Insights — Mistral analysis of recent complaints
- **Predictive Urban Intelligence** — ward-level risk predictions with LLM briefings

### Predictive Urban Intelligence
Statistical trend analysis (velocity, backlog pressure, severity) narrated by Mistral-7B:

```
⚠ INTELLIGENCE BRIEFING
Ward 12 and MG Road face imminent sanitation and road safety failures.

[HIGH RISK] Garbage overflow likely in Ward 12 within 3 days
based on rapidly rising complaint frequency.
↳ Immediate preventive inspection recommended.
```

---

## GPU / CPU

| Mode | Setup | Inference speed |
|------|-------|----------------|
| GPU (recommended) | Uncomment `deploy: resources:` in docker-compose.yml | ~1–3s per classification |
| CPU | No changes needed | ~20–40s per classification |

Requires NVIDIA Container Toolkit for GPU mode. See `SETUP_GUIDE.docx`.

---

## Fine-tuning

```bash
# Full fine-tune on 29,137 BBMP complaints (~1-2 hours on GPU)
python ai-service/training/finetune_lora.py \
  --dataset_path ai-service/training/civic_complaints_dataset.jsonl \
  --output_dir ./lora-civicai \
  --epochs 3

# Quick test with 500 examples (~5 minutes)
python ai-service/training/finetune_lora.py \
  --dataset_path ai-service/training/civic_complaints_starter_500.jsonl \
  --output_dir ./lora-test \
  --epochs 1

# Activate adapter
echo "LORA_ADAPTER_PATH=./lora-civicai" >> backend/.env
docker-compose up --build ai-service
```

---

## Running Tests

```bash
cd backend && node tests/run.js
```

Tests run against a fresh temporary database. Covers: DB seed, CRUD, analytics, escalation worker, JWT auth, bcrypt.

---

## Local Development (Without Docker)

```bash
# AI service
cd ai-service
pip install -r requirements.txt
HF_TOKEN=hf_xxx uvicorn main:app --host 0.0.0.0 --port 8000

# Backend (new terminal)
cd backend && npm install && node server.js

# Frontend (new terminal)
cd frontend && npm install
REACT_APP_API_URL=http://localhost:3001/api \
  REACT_APP_WS_URL=ws://localhost:3001 npm start
```

---

## Dataset

**CivicComp-HiEn** — 29,137 instruction-output pairs derived from real BBMP Bengaluru civic complaints.

- Languages: English, Hindi, Hinglish (parallel triplets)
- Source: OpenCity.in (anonymised, PII removed)
- License: CC BY-SA 4.0
- Citation: Tripathi, Mathew & Shariefullah — Amrita Vishwa Vidyapeetham, 2026

---

## License

Source code: MIT  
Dataset (`ai-service/training/`): CC BY-SA 4.0
