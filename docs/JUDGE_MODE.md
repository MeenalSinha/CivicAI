# Judge Mode demo flow

Open **Judge Mode** in the top navigation (no login; the server issues a 2-hour demo policymaker session when `DEMO_MODE=true`). The synthetic dataset loads automatically on first boot — **no manual database editing**.

1. **Voice request** — choose the Hinglish or Hindi sample, *or* press *Record voice* (uses Whisper if `PRELOAD_WHISPER=true`; otherwise the UI says so and you use a sample). The screen states plainly whether the transcript came from Whisper, a bundled sample text, or typing.
2. **Transcription** shown (PII redacted before storage).
3. **Classification** — need, subcategory, confidence, classifier and the matched terms.
4. **Location** — region, method (GPS / gazetteer), coordinates.
5. **Clustering** — cluster id, requests, distinct locations, radius; region demand score.
6. **Hotspot on map** (Leaflet, zoomed to the cluster).
7. **Infrastructure gap** with reasoning.
8. **Residents affected** (estimate; formula in the evidence trail).
9. **Investment coverage** — neutral wording, mapped projects.
10. **Explainable priority** — score, band, "Priority increased because…", intervention, department, status *pending human review*.
11. **Policymaker dashboard** opens on that item with the full evidence trail; approve/request info/reject (audit-logged).
12. **Ask "why was this region prioritized?"** — answered from stored evidence.

Story in the default data: Eastern Periphery (120 k residents) has 28 % of the healthcare benchmark, healthcare requests rising, and no mapped healthcare project → ranked #1. Nothing about this ranking is hard-coded; `tests/intelligence.test.js` proves the ranking changes when inputs or weights change.
