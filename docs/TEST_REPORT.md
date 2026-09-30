# Test report

Environment: Node 22, sql.js SQLite, AI service **unreachable by design** (fallback paths tested). Date of run: 2026-09-30.

| Suite | Command | Result |
|---|---|---|
| Legacy backend (DB, auth, CRUD, escalation, fallback) | `node tests/run.js` | **23 / 23 passed** (unchanged from baseline) |
| Intelligence layer | `node tests/intelligence.test.js` | **44 / 44 passed** |
| BRICS readiness (Brazil instance, Portuguese) | `node tests/brics.test.js` | **7 / 7 passed** |
| API + WebSocket integration (spawns real servers) | `node tests/integration.test.js` | **38 / 38 passed** |
| Frontend production build | `npx react-scripts build` | **Compiled successfully** |
| Endpoint smoke test for every route the UI calls | curl with judge-session token | all 200 |

## Coverage against the requested test list
| Requested | Evidence |
|---|---|
| Multilingual requests | language detection (en/hi/hinglish/pt/ru); classifier accuracy ≥ 97 % on 662 synthetic requests (measured 655/662); Hindi & Hinglish via REST |
| Image submission | REST `/analyze-image` with model unavailable → graceful fallback, validation of bad MIME |
| Voice submission | `/voice-complaint` (Hinglish); `/transcribe-audio` and `/judge/transcribe` return 503 without leaking internals when Whisper is off. **Real Whisper transcription not exercised** |
| Geolocation | GPS→region, gazetteer, malformed GPS, unresolved-location flag |
| Clustering | proximity/need separation, footprint population cap |
| Demand scoring | component sum = score, weights configurable, volume/growth monotonic, growth-rate arithmetic |
| Gap calculation | gap = 1 − availability, population arithmetic, missing-data path with reduced confidence |
| Investment alignment | four classes + overlap; neutral-language assertion |
| Prioritisation | components sum to score; rationale present; ranking changes when inputs/weights change; idempotent recompute |
| Dashboard data | overview, geo layers (k-anonymity), priorities filters, trends, investments, outcomes |
| Policy queries | 4 canonical questions + "why"; unsupported question refused; narration guard rejects invented numbers |
| Authentication / roles | 401/403 matrix; policymaker blocked from complaint PII; admin-only config/audit/import |
| Notifications | legacy list endpoint still 200 |
| WebSocket | `connected`, `new_complaint`, `intelligence_updated` received |
| Privacy | identity absent from `citizen_requests`; policy JSON scanned for names/phones/ticket ids |
| Governance | review workflow, audit hash chain + tamper detection, human reclassification |
| Judge flow | end-to-end submit → trace (steps 3–10) and dashboard reads, no manual DB edits |

## Defects found and fixed during testing
1. Demo data path resolved to `config/data/…` → fixed.
2. Alignment `overlap` flag was not persisted → column added (with migration).
3. Off-topic questions ("who won the cricket match") were answered as a summary → domain guard added.
4. Malformed JSON body returned 500 → now 400.
5. Requests with no resolvable location were placed at a default centre → now `unresolved`, excluded from spatial aggregation and sent to human review.
6. Lexicon gaps found by the accuracy test ("road is broken and damaged", "doctors are absent") → added.
7. Legacy runner never exited (open timers) → explicit exit so `npm test` can chain.

## Not tested (see KNOWN_LIMITATIONS)
Live Mistral/YOLO/Whisper inference, `/extract` and `/narrate` against a real model, browser rendering / accessibility tooling, load/performance beyond ~700 requests.
