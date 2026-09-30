# Data schema (v4 additions)

Legacy tables (`complaints`, `officers`, `notifications`, …) are unchanged except `complaints.requestId` (additive, auto-migrated).

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `citizen_requests` | Normalised, **anonymised** request (one schema for all channels) | id, complaintId, channel, language, category, subcategory, description *(redacted)*, locationText, lat, lng, locationSource, regionId, urgency, urgencyBand, populationRelevance, affectedInfrastructure, confidence, classifier, matchedTerms, trace, imageEvidence, submitterHash, textFingerprint, status(active/duplicate/spam), clusterId, upvotes, needsReview, isSynthetic · idx: region, category, createdAt, cluster, submitter, fingerprint |
| `request_clusters` | Spatial clusters of the same need | id, category, subcategory, regionId, centroid, radiusKm, requestCount, uniqueLocations, upvotes, avgUrgency, firstSeen, lastSeen, affectedPopulation |
| `development_demands` | Demand per region × need | requestCount, duplicatesMerged, uniqueLocations, recentCount, priorCount, growthRate, persistence, concentration, affectedPopulation, avgUrgency, safetyImpact, **demandScore**, components(JSON), weeklySeries |
| `demographic_regions` | Administrative/demographic regions | id, name, aliases, level, parentId, countryCode, lat, lng, radiusKm, population, areaKm2, density, deprivation, geometry, sourceId, isSynthetic |
| `infrastructure_assets` | Availability indicators per region × sector | regionId, sector, metric, value, benchmark, unit, asOf, sourceId |
| `infrastructure_gaps` | Computed gap | availability, gap, populationInGap, populationAffected, severity, severityBand, confidence, dataStatus, reasoning(JSON) |
| `government_investments` | Projects / public investment | name, sector, regionIds, coverage{region:share}, budget, currency, stage, plannedCompletion, completedAt, targetPopulation, department, source |
| `investment_alignments` | Alignment finding per region × need | classification, coverage, overlap, matched(JSON), note |
| `priority_projects` | Ranked priorities | rank, priorityScore, band, affectedPopulation, topEvidence, proposedIntervention, responsibleDepartment, rationale, components, confidence, investmentClass |
| `policy_recommendations` | Recommendation + human review | projectId(unique), text, evidenceTrail, modelTrace, status(pending_review/approved/rejected/needs_info), reviewer, reviewNote, version |
| `citizen_feedback` | Outcome feedback | complaintId, requestId, rating 1–5, comment |
| `data_sources` | Provenance registry | id, kind, adapter, isSynthetic, recordCount, status |
| `audit_logs` | Hash-chained audit trail | seq, ts, actorType, actorId, action, entityType, entityId, details, prevHash, hash |
| `config_kv` | Runtime configuration (scoring weights) | key, value, updatedBy |
| `pipeline_runs` | Analysis run log | trigger, stats |

## Interchange formats (adapters)
- **regions**: `id,name,lat,lng,population,areaKm2` (+ aliases, radiusKm, deprivation, geometry)
- **assets**: `id,regionId,sector,metric,value,benchmark` (+ unit, asOf) — `sector` = taxonomy category id
- **investments**: `id,name,sector,stage` + `coverage{regionId:share}` (+ budget, currency, targetPopulation, plannedCompletion, completedAt, department, source). Stages: completed, ongoing, tender, approved, planned, stalled, cancelled.
Sample files: `backend/data/samples/in-demo/*.json` (**synthetic**; dates written as `T-55d` are resolved at load).
