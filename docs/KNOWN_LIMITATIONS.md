# Known limitations (honest list)

1. **Hybrid data provenance.** Populations and geographic boundaries use verified real public sources (e.g., Census of India 2011, IBGE). Infrastructure metrics, investments, and the ~1400 citizen requests are synthetic demonstration data explicitly labeled as such in the data model and UI.
2. **Region boundaries are centroid + radius** (optional GeoJSON geometry is stored but assignment uses nearest-centroid). Point-in-polygon assignment is not implemented.
3. **Whisper / Mistral / YOLO were not run in the development sandbox** (no GPU/model weights). Their integration paths, timeouts and fallbacks are tested with the AI service *unavailable*; the lexicon classifier and rule-based paths are what the automated tests exercise. `/extract` and `/narrate` (new) are untested against a live model.
4. **Frontend was compiled (`react-scripts build`) and every endpoint it calls was exercised over HTTP, but it was not viewed in a browser** in this environment; there are no automated UI/e2e tests. Map tiles require internet access.
5. **Lexicon classifier** covers English, Hindi, Hinglish (full) and Portuguese (small overlay). Accuracy 99 % on the synthetic set is measured on text written by the same team that wrote the lexicon; expect lower accuracy on real free text. Low-confidence text is routed to the LLM (if available) or human review.
6. **Clustering is greedy and recomputed from scratch** on each run — fine for tens of thousands of requests, not for millions (needs incremental/DB-side clustering).
7. **Affected-population estimates** are heuristics (cluster footprint × density; region population × gap). They are shown with their formula and confidence, not as census figures.
8. **Growth/trend windows** use fixed windows (30 d; quarter split into two 45-day halves) because the demo holds 13 weeks of history.
9. **Privacy:** hashing uses a server salt; exact GPS is stored on requests (needed for clustering) but policy views expose only a 500 m grid with k-anonymity. No formal differential-privacy guarantee.
10. **Messaging channels:** Comprehensive payload normalization, cryptographic signature verification (HMAC-SHA256), media attachment downloads (WhatsApp/Telegram), and outbound Twilio SMS replies are fully implemented. Voice transcription and image analysis rely on external AI services.
11. **Auth:** JWT in `sessionStorage`, seeded default passwords (documented, must be changed), single-node SQLite (sql.js) persisted to a file — not horizontally scalable.
12. **Only English UI strings** for the citizen and policy interfaces (input is multilingual; UI localisation is not done).
13. **Outcome measurement** is correlational (before/after windows) and flagged as such; no causal inference.
