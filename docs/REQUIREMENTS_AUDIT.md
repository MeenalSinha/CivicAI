# Track 1 requirements audit

Legend: **IMPLEMENTED** = built and covered by an automated test or an executed check · **PARTIAL** = built, with a stated gap · **NOT IMPLEMENTED**.
Items that stay PARTIAL could not be closed in this environment (no GPU models, no browser); the reason is stated rather than hidden.

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | Existing baseline preserved | IMPLEMENTED | Legacy suite 23/23 unchanged; officer workflow, tracking, upvotes, analytics, map, notifications, predictions verified in integration tests |
| 2 | Pipeline: request → … → outcome measurement | IMPLEMENTED | `intelligence/pipeline.js`; feedback + before/after outcomes in `trends.js` |
| 3 | Text / chat intake, Hindi, Hinglish, English | IMPLEMENTED | REST tests in three languages; classifier accuracy 655/662 on synthetic set |
| 3 | Voice intake | PARTIAL | Transcript path and Judge Mode tested; **Whisper transcription itself not run** (model unavailable). UI labels sample vs Whisper transcripts |
| 3 | Image intake | PARTIAL | Endpoint, validation and fallback tested; **YOLOv8 not run**. Vision result feeds `imageEvidence` |
| 3 | Messaging-oriented input | PARTIAL | Secret-protected webhooks for WhatsApp Cloud/Telegram/SMS/generic (text + location); no signature verification, media download or replies |
| 3 | Additional BRICS languages | IMPLEMENTED | Registry + lexicon overlays; Portuguese requests classified in `brics.test.js`; ru/zh/ar script detection |
| 3 | All 15 extracted fields + one normalised schema | IMPLEMENTED | `normalizeRequest`; test asserts identical keys for every channel |
| 4 | 16-category taxonomy, extensible | IMPLEMENTED | 16 categories / 51 subcategories in JSON; runtime `extendTaxonomy` tested |
| 5 | Demand aggregation (volume, unique locations, growth, population, urgency, persistence, support, geographic + category concentration) | IMPLEMENTED | `demand.js`; tests for growth arithmetic, monotonicity, category shares sum to 1 |
| 5 | Configurable Demand Score | IMPLEMENTED | Weights in `config_kv`, `PUT /policy/config/weights`, UI editor, audit-logged |
| 6 | Infrastructure gap (demand, availability, gap, population, severity, confidence, reasoning) | IMPLEMENTED | `gaps.js`; missing-data path tested |
| 7 | Investment data model and alignment engine (5 findings, neutral language) | IMPLEMENTED | `investment.js`; neutral-language test |
| 8 | Transparent prioritisation with "why" | IMPLEMENTED | Components sum to score (tested); rationale "Priority increased because…" |
| 9A–E | Policy dashboard: overview, map layers (requests, hotspots, gaps, density, investments, recommended), priorities, trends, explainability | IMPLEMENTED | UI compiled; every endpoint it uses exercised over HTTP. **Not viewed in a browser** (see 19) |
| 10 | Policy query interface, no fabrication | IMPLEMENTED | Intent-based, answers only from tables, off-topic refused, narration number-verified. Fixed set of intents (not open-domain) |
| 11 | Modular / interoperable architecture, clean APIs | IMPLEMENTED | Adapters, schemas, channel normalisers, documented API |
| 12 | BRICS-ready configuration | PARTIAL | Countries, currencies, languages, admin levels, departments, categories, benchmarks configurable; tested with a Brazil instance. "Governance structures" are only a label + review flags, not a modelled hierarchy |
| 13 | AI safety & governance (confidence, evidence, uncertainty, audit, human review, RBAC, anonymisation, spam, traceability) | IMPLEMENTED | All tested; hash-chained audit with tamper detection |
| 14 | Privacy: identity separated from intelligence, aggregates in policy views | IMPLEMENTED | Tests scan API output for names/phones/ticket ids; k-anonymity on map |
| 15 | AI stack preserved; right tool per task; scores programmatic | IMPLEMENTED | `llmUsedForScores=false`; LLM only for extraction (low confidence) and verified narration. New `/extract`, `/narrate` untested on a live model |
| 16 | Data model, relationships, indexes, migration | IMPLEMENTED | 15 tables + indexes; additive migrations tested on fresh DBs |
| 17 | Adapters for open data, municipal DBs, demographics, registries, GIS, investment data, citizen reports | IMPLEMENTED | json/csv/http/geojson adapters with validation |
| 17 | Satellite-derived datasets | NOT IMPLEMENTED | Interface allows it (an adapter emitting `assets`), no adapter written |
| 17 | Synthetic data clearly labelled | IMPLEMENTED | `isSynthetic` on every row/source, banners in UI, caveat in evidence trail |
| 18 | Judge Mode, 12 steps, no manual DB edits | IMPLEMENTED | Integration test runs steps 1–10 and dashboard reads; UI drives 11–12. Voice step uses Whisper only if enabled |
| 19 | Government-style UI, accessibility | PARTIAL | Restrained palette, focus rings, ARIA roles/labels, keyboard-operable tables/drawer; **no visual review or automated accessibility audit was possible** |
| 20 | No regressions | IMPLEMENTED | Legacy + integration suites |
| 21 | Loading / error / empty / unavailable-AI / malformed / duplicate handling | IMPLEMENTED | Tested: empty deployment, AI down, bad JSON, bad GPS, duplicate, spam |
| 21 | No dead APIs / controls without backend | PARTIAL | Every UI control has a backend; `POST /policy/datasets/import` and `GET /taxonomy` are integrator APIs with no UI |
| 22 | Backend tests, frontend build, integration tests, coverage list | IMPLEMENTED | 112 automated tests + build; see TEST_REPORT |
| 24 | Deliverables 1–10 | IMPLEMENTED | Code, README, ARCHITECTURE, DATA_SCHEMA, API, JUDGE_MODE, sample datasets, TEST_REPORT, KNOWN_LIMITATIONS, this audit |

## Remaining PARTIAL / NOT IMPLEMENTED — why they were not "fixed first"
Each needs something unavailable here: GPU model weights (Whisper/YOLO/`/extract`), a browser (visual/accessibility review), provider credentials (messaging signatures), or a real satellite data feed. They are listed in `KNOWN_LIMITATIONS.md` so nobody has to discover them in front of judges. **Before a live demo:** run the stack with `PRELOAD_WHISPER=true` and open Judge Mode once in a browser.
