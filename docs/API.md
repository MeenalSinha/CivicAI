# API reference (v4)

Base `/api`. Auth: `Authorization: Bearer <JWT>` from `POST /auth/login`. Roles: `officer`, `policymaker`, `admin`.
Accounts (seeded): `officer / CivicAI@2024`, `admin / Admin@CivicAI2024`, `policymaker / Policy@CivicAI2026` — **change in production**.

## Citizen (public, unchanged contracts + additions)
| Method | Path | Notes |
|---|---|---|
| POST | `/chat` `/complaints` `/voice-complaint` `/analyze-image` `/transcribe-audio` | As before. New optional body fields `lat`,`lng`,`clientId` (duplicate/spam protection, hashed). Responses add `request` (citizen-safe normalised view). Repeat → `200 {duplicate:true}`; flood → `429`. |
| GET | `/complaints/:id`, POST `/complaints/:id/upvote` | Upvote also raises the request's citizen-support signal |
| POST | `/complaints/:id/feedback` | `{rating 1-5, comment}`; only after `resolved`, once |
| POST | `/channels/:channel/webhook` | `whatsapp-cloud`, `telegram`, `sms`, `generic`; header `x-channel-secret`; 503 unless `CHANNEL_WEBHOOK_SECRET` set |
| GET | `/taxonomy` | Categories / subcategories |

## Officer (PII) — roles `officer`, `admin`
`GET/PATCH /officer/complaints[/:id]`. Analytics/insights/predictions: any authenticated role.

## Policy intelligence — roles `officer|policymaker|admin` (aggregates only)
`GET /policy/meta | overview | geo?category&sector | priorities?band&category&regionId&limit | priorities/:id | trends | regions | gaps | investments | outcomes`
`POST /policy/query {question, context?}` → `{intent, answer, table, evidence, filters, method, narration?}`

## Governance
| Method | Path | Role |
|---|---|---|
| POST | `/policy/priorities/:id/review {status, note}` | policymaker, admin |
| GET | `/policy/review/recommendations`, `/policy/review/requests` | read / policymaker+ |
| POST | `/policy/review/requests/:id {category, subcategory}` | policymaker, admin |
| POST | `/policy/pipeline/run` | policymaker, admin |
| GET/PUT/POST | `/policy/config/weights`, `/policy/config/weights/reset` | read / admin |
| GET | `/policy/audit` | admin (includes chain verification) |
| GET/POST | `/policy/datasets`, `/policy/datasets/import {type, adapter, records\|csv\|url\|geojson}` | read / admin |
| POST | `/policy/demo/reset` | admin |

## Judge Mode (404 unless `DEMO_MODE=true`)
`GET /judge/status`, `POST /judge/session` (policymaker token, 2 h), `GET /judge/scenario`, `POST /judge/transcribe` (Whisper; 503 if disabled), `POST /judge/submit {transcript, transcriptSource, runId}` → full `trace`.

## WebSocket events
`connected`, `new_complaint`, `complaint_updated`, `escalation`, `intelligence_updated`, `recommendation_reviewed`.

## AI service (internal)
Existing `/classify /chat /analyze-image /transcribe /insights /predict /health` + new `/extract` (taxonomy-constrained) and `/narrate` (fact rephrasing).
