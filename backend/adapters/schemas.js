// Standardised dataset schemas + validators. Every adapter (JSON, CSV, HTTP, GeoJSON, ...)
// must produce records that pass these validators; the engines only ever see this shape.
import { isValidCategory } from '../intelligence/taxonomy.js';
import { STAGE_FACTOR } from '../intelligence/investment.js';

export const DATASET_TYPES = ['regions', 'assets', 'investments'];

export const SCHEMAS = {
  regions: {
    required: ['id', 'name', 'lat', 'lng', 'population', 'areaKm2'],
    optional: ['aliases', 'level', 'parentId', 'district', 'state', 'countryCode', 'radiusKm', 'populationYear', 'deprivation', 'geometry'],
    description: 'Administrative / demographic regions (wards, districts, municipalities...). Boundaries are centroid+radius by default; geometry (GeoJSON) is optional.'
  },
  assets: {
    required: ['id', 'regionId', 'sector', 'metric', 'value', 'benchmark'],
    optional: ['assetType', 'unit', 'asOf'],
    description: 'Infrastructure availability indicators per region and development category (sector = taxonomy category id).'
  },
  investments: {
    required: ['id', 'name', 'sector', 'stage'],
    optional: ['regionIds', 'coverage', 'budget', 'currency', 'plannedCompletion', 'completedAt', 'targetPopulation', 'department', 'source', 'notes'],
    description: 'Government projects / public investments with stage, budget, target population and geographic coverage (coverage = {regionId: share 0..1}).'
  }
};

const num = v => typeof v === 'number' && Number.isFinite(v);

export function validateRecords(type, records, ctx = {}) {
  const errors = [], ok = [];
  const regionIds = ctx.regionIds || null;
  if (!Array.isArray(records)) return { valid: [], errors: [{ index: -1, error: 'Payload must be an array of records' }] };
  records.forEach((r, i) => {
    const e = [];
    if (!r || typeof r !== 'object') { errors.push({ index: i, error: 'Record must be an object' }); return; }
    for (const f of SCHEMAS[type].required) if (r[f] === undefined || r[f] === null || r[f] === '') e.push(`missing ${f}`);
    if (type === 'regions') {
      if (!num(r.lat) || Math.abs(r.lat) > 90) e.push('lat must be a number in [-90, 90]');
      if (!num(r.lng) || Math.abs(r.lng) > 180) e.push('lng must be a number in [-180, 180]');
      if (!num(r.population) || r.population <= 0) e.push('population must be > 0');
      if (!num(r.areaKm2) || r.areaKm2 <= 0) e.push('areaKm2 must be > 0');
    }
    if (type === 'assets') {
      if (!isValidCategory(r.sector)) e.push(`unknown sector "${r.sector}" (must be a taxonomy category id)`);
      if (!num(r.value) || r.value < 0) e.push('value must be >= 0');
      if (!num(r.benchmark) || r.benchmark <= 0) e.push('benchmark must be > 0');
      if (regionIds && r.regionId && !regionIds.has(r.regionId)) e.push(`unknown regionId "${r.regionId}"`);
    }
    if (type === 'investments') {
      if (!isValidCategory(r.sector)) e.push(`unknown sector "${r.sector}"`);
      if (!(r.stage in STAGE_FACTOR)) e.push(`stage must be one of ${Object.keys(STAGE_FACTOR).join(', ')}`);
      if (r.budget != null && (!num(r.budget) || r.budget < 0)) e.push('budget must be >= 0');
      if (r.coverage) for (const [rid, share] of Object.entries(r.coverage)) {
        if (!num(share) || share < 0 || share > 1) e.push(`coverage share for ${rid} must be within [0,1]`);
        if (regionIds && !regionIds.has(rid)) e.push(`coverage references unknown region "${rid}"`);
      }
      if (!r.coverage && !(r.regionIds || []).length) e.push('provide coverage or regionIds');
    }
    if (e.length) errors.push({ index: i, id: r.id, error: e.join('; ') }); else ok.push(r);
  });
  return { valid: ok, errors };
}
