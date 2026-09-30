# CivicAI v4 — Architecture

CivicAI turns citizen requests into **population-level development signals** and then into **explainable, human-reviewed infrastructure recommendations**. Legacy complaint handling (tickets, officer workflow) is preserved and now feeds the same pipeline.

```
Citizen request (chat | text | voice | image | messaging webhook)
  → intake service (routes + intelligence/intake.js)
      ├─ legacy complaint (identity + officer workflow)            [complaints table]
      └─ normalised anonymised request (hashed submitter, redacted) [citizen_requests]
  → multilingual understanding  (language registry, taxonomy lexicon; Mistral/vision only if unsure)
  → geolocation  (GPS → gazetteer → unresolved+review; never guessed from a default centre)
  → duplicate / spam guard      (same-submitter repeat, rate limit)
  → clustering                  (same need, ≤1.2 km, deterministic)
  → development demand + Demand Score   (7 configurable components)
  → infrastructure gap          (availability vs benchmark, population in gap, confidence, reasoning)
  → investment alignment        (neutral classes, overlap detection)
  → prioritisation              (9 configurable components, bands P1–P4)
  → recommendation + evidence trail    → human review (approve / needs info / reject) → audit log
  → policy dashboard, policy Q&A, Judge Mode
  → feedback + outcome measurement (resolution, satisfaction, demand before/after completed projects)
```

## Design rules
| Rule | How it is enforced |
|---|---|
| Scores are computed, not generated | `intelligence/{demand,gaps,investment,priority}.js` are pure functions; `modelTrace.llmUsedForScores=false` on every recommendation; tests recompute the ranking after changing inputs/weights |
| LLM only where language is the task | `ai/aiService.js`: `extractDevelopmentNeed` (only when lexicon confidence < 0.6; output validated against taxonomy ids) and `narrateFacts` (optional; every number verified against source facts, otherwise discarded) |
| No India-specific core | Country, currency, admin levels, languages, departments, benchmarks live in `config/` (`countries.json`, `instances/*`, `languages.json`, `taxonomy.json`, `lexicons/*`). `tests/brics.test.js` runs a Brazilian instance with Portuguese requests and asserts no India constants leak |
| Identity separated from intelligence | Name/phone exist only in `complaints`. `citizen_requests` stores redacted text and a salted one-way hash. Policy endpoints return aggregates only |
| Recommendations are advisory | Every recommendation starts `pending_review`; review requires policymaker/admin, notes are mandatory for reject/needs-info, all actions are hash-chain audit-logged |

## Modules (backend)
- `config/` — `taxonomy.json` (16 categories, 51 subcategories, extendable), `languages.json`, `lexicons/`, `countries.json`, `instances/`
- `intelligence/` — `language, taxonomy, normalize, textutils, geo, clustering, demand, gaps, investment, priority, explain, trends, policyQuery, views, pipeline, intake, config`
- `adapters/` — `DataSourceAdapter` interface + `json-file`, `inline-json`, `inline-csv`, `http-json` (host allow-list), `geojson-boundaries`; `schemas.js` validators; `importDataset()` = fetch → validate → upsert → register source → audit
- `routes/` — `policy.js` (policy API, review, config, datasets, Judge Mode), `channels.js` (WhatsApp Cloud / Telegram / SMS / generic normalisers)
- `database/` — `db.js` (legacy, unchanged schema + additive `requestId`), `devdb.js` (v4 schema, audit chain)
- `demo/` — `synthetic.js` (reproducible synthetic request text; **no scores**), `loadDemo.js` (loads through the real adapters)

## Scoring
**Demand score (0–100)** = 100 × Σ wᵢ·cᵢ over *volume* (per-capita + log absolute), *growth* (last window vs prior), *persistence* (active weeks / 12), *concentration* (share in the largest cluster, damped for tiny samples), *affected population* (cluster footprint × density), *urgency*, *citizen support* (log upvotes). Default weights 0.20/0.15/0.12/0.10/0.15/0.16/0.12; configurable, normalised.

**Gap** = 1 − mean(min(1, value/benchmark)); severity = 65 % gap + 35 % demand; confidence from data completeness/age, request count, classifier confidence, location quality. With no infrastructure data the gap is *not measured* and confidence is reduced (stated in the reasoning).

**Priority (0–100)** = demand .22, gap .20, population .12, urgency .08, safety .10, persistence .06, growth .06, investment gap .10, equity .06. Bands: P1 ≥ 70, P2 ≥ 55, P3 ≥ 40, else P4. Every component's value × weight = points is returned and rendered.

## Real-time
`new_complaint`, `complaint_updated`, `escalation` (legacy) plus `intelligence_updated` (after any pipeline run) and `recommendation_reviewed`. The dashboard refreshes on these.
