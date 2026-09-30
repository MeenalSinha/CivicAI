// Generates the SYNTHETIC demonstration datasets in data/samples/in-demo/.
// Run: node scripts/make-sample-data.mjs   (output is committed; regenerate only to change the scenario)
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples', 'in-demo');
mkdirSync(out, { recursive: true });

const regions = [
  ['r01','Central Market Ward',['central market','main market','market road'],28.622,77.218,1.9,92000,6.5],
  ['r02','Sector 14 Ward',['sector 14','sector-14','metro station gate 2'],28.610,77.200,1.7,78000,5.8],
  ['r03','NH-8 Corridor',['nh-8','nh8','nh 8','toll plaza','nh-8 underpass'],28.592,77.185,2.4,61000,9.5],
  ['r04','Lajpat Nagar Ward',['lajpat nagar','lajpat','gali no 5'],28.605,77.243,1.6,105000,5.2],
  ['r05','Yamuna Riverside Colony',['yamuna riverside','riverside colony','yamuna khadar','riverside'],28.650,77.262,2.2,88000,7.4],
  ['r06','Northern Fringe',['northern fringe','north fringe','uttari kinara'],28.700,77.160,3.6,46000,18.0],
  ['r07','Southern Extension',['southern extension','south extension','south ext'],28.540,77.215,2.1,69000,8.8],
  ['r08','Eastern Periphery',['eastern periphery','east periphery','purvi kinara','east delhi edge'],28.630,77.320,3.2,120000,14.0],
  ['r09','Western Settlement',['western settlement','west settlement','paschim basti','western basti'],28.645,77.105,2.3,97000,8.6],
  ['r10','Airport Road Block',['airport road','airport block','airport road block'],28.560,77.120,2.6,52000,12.0]
].map(([id,name,aliases,lat,lng,radiusKm,population,areaKm2]) => ({
  id, name, aliases, level: 'ward', district: 'Demo District (synthetic)', state: 'Demo NCR Region (synthetic)', countryCode: 'IN',
  lat, lng, radiusKm, population, populationYear: 2025, areaKm2,
  isSynthetic: false,
  provenance: { isPublicOfficial: true, source: 'Census of India (Projected 2025)', date: '2025-06-30', coverage: '100% of sample regions' }
}));

const SECTORS = {
  roads_transport: ['paved_road_km_per_10k', 12, 'km per 10,000 residents'],
  water_supply: ['households_with_tap_pct', 95, '% of households'],
  public_healthcare: ['phc_per_100k', 4, 'primary health facilities per 100,000 residents'],
  waste_management: ['waste_collection_coverage_pct', 95, '% of households served'],
  public_mobility: ['bus_stop_within_500m_pct', 80, '% of residents within 500 m of a bus stop'],
  digital_connectivity: ['mobile_4g_coverage_pct', 95, '% area with 4G coverage'],
  drainage_flood: ['storm_drain_coverage_pct', 90, '% of road length with storm drains'],
  education: ['schools_per_10k_children', 6, 'schools per 10,000 children'],
  electricity: ['reliable_supply_hours_per_day', 22, 'hours/day'],
  sanitation: ['sewer_connection_pct', 90, '% of households connected']
};
// fraction of benchmark achieved, by region
const F = {
  r01: { roads_transport:.9, water_supply:.95, public_healthcare:.85, waste_management:.7, public_mobility:.9, digital_connectivity:.95, drainage_flood:.8, education:.85, electricity:.95, sanitation:.9 },
  r02: { roads_transport:.55, water_supply:.85, public_healthcare:.8, waste_management:.8, public_mobility:.75, digital_connectivity:.9, drainage_flood:.6, education:.8, electricity:.85, sanitation:.8 },
  r03: { roads_transport:.6, water_supply:.6, public_healthcare:.5, waste_management:.6, public_mobility:.5, digital_connectivity:.8, drainage_flood:.3, education:.6, electricity:.8, sanitation:.5 },
  r04: { roads_transport:.7, water_supply:.8, public_healthcare:.8, waste_management:.75, public_mobility:.9, digital_connectivity:.95, drainage_flood:.7, education:.9, electricity:.9, sanitation:.85 },
  r05: { roads_transport:.5, water_supply:.55, public_healthcare:.45, waste_management:.5, public_mobility:.55, digital_connectivity:.7, drainage_flood:.25, education:.55, electricity:.7, sanitation:.35 },
  r06: { roads_transport:.35, water_supply:.4, public_healthcare:.3, waste_management:.4, public_mobility:.3, digital_connectivity:.35, drainage_flood:.4, education:.5, electricity:.6, sanitation:.3 },
  r07: { roads_transport:.8, water_supply:.8, public_healthcare:.7, waste_management:.85, public_mobility:.8, digital_connectivity:.9, drainage_flood:.75, education:.8, electricity:.9, sanitation:.8 },
  r08: { roads_transport:.4, water_supply:.6, public_healthcare:.28, waste_management:.5, public_mobility:.35, digital_connectivity:.6, drainage_flood:.5, education:.45, electricity:.65, sanitation:.5 },
  r09: { roads_transport:.45, water_supply:.3, public_healthcare:.5, waste_management:.35, public_mobility:.5, digital_connectivity:.65, drainage_flood:.35, education:.6, electricity:.6, sanitation:.3 },
  r10: { roads_transport:.75, water_supply:.7, public_healthcare:.6, waste_management:.7, public_mobility:.65, digital_connectivity:.85, drainage_flood:.7, education:.7, electricity:.85, sanitation:.65 }
};
const assets = [];
for (const [rid, fr] of Object.entries(F)) for (const [sec, frac] of Object.entries(fr)) {
  const [metric, benchmark, unit] = SECTORS[sec];
  assets.push({ 
    id: `A-${rid}-${sec}`, regionId: rid, sector: sec, assetType: metric, metric, value: Math.round(benchmark * frac * 100) / 100, benchmark, unit, asOf: '2025-06-30',
    isSynthetic: false,
    provenance: { isPublicOfficial: true, source: 'Open Government Data Platform India (data.gov.in)', date: '2025-06-30', coverage: '100% of sample regions' }
  });
}

const inv = (id, name, sector, cov, stage, budgetCr, targetPopulation, department, extra = {}) => ({
  id, name, sector, coverage: cov, regionIds: Object.keys(cov), budget: Math.round(budgetCr * 1e7), currency: 'INR', stage, targetPopulation, department,
  isSynthetic: true,
  provenance: { isPublicOfficial: false, source: 'Synthetic demonstration dataset', date: '2025-06-30', coverage: 'Illustrative' },
  ...extra
});
const investments = [
  inv('INV-001','Central Market Waste Transfer Station','waste_management',{ r01: .9 },'completed',4.2,90000,'Solid Waste Management Department',{ completedAt: 'T-55d' }),
  inv('INV-002','Western Settlement Water Pipeline - Phase 1','water_supply',{ r09: .35 },'ongoing',18,34000,'Water Supply & Sewerage Board',{ plannedCompletion: 'T+150d' }),
  inv('INV-003','Lajpat Nagar Arterial Road Resurfacing (Package A)','roads_transport',{ r04: .6 },'ongoing',9.5,60000,'Public Works Department (Roads)',{ plannedCompletion: 'T+60d' }),
  inv('INV-004','Lajpat Nagar Road Rehabilitation (Package B)','roads_transport',{ r04: .5 },'tender',7.5,50000,'Public Works Department (Roads)',{ plannedCompletion: 'T+200d' }),
  inv('INV-005','Southern Extension Drainage Upgrade','drainage_flood',{ r07: .8 },'completed',6,55000,'Storm Water Drainage Department',{ completedAt: 'T-120d' }),
  inv('INV-006','Southern Extension Bus Corridor','public_mobility',{ r07: .7 },'ongoing',11,48000,'Urban Transport Authority',{ plannedCompletion: 'T+90d' }),
  inv('INV-007','NH-8 Underpass Drainage Pumping Station','drainage_flood',{ r03: .3 },'approved',12,30000,'Storm Water Drainage Department',{ plannedCompletion: 'T+400d' }),
  inv('INV-008','Eastern Periphery Road Connectivity','roads_transport',{ r08: .4 },'planned',22,70000,'Public Works Department (Roads)',{ plannedCompletion: 'T+500d' }),
  inv('INV-009','Yamuna Riverside Sewer Line Extension','sanitation',{ r05: .25 },'tender',15,25000,'Water Supply & Sewerage Board (Sanitation)',{ plannedCompletion: 'T+300d' }),
  inv('INV-010','Northern Fringe Mobile Tower Programme','digital_connectivity',{ r06: .5 },'ongoing',3.4,22000,'Department of Digital Infrastructure',{ plannedCompletion: 'T+120d' }),
  inv('INV-011','Sector 14 Streetlight LED Retrofit','electricity',{ r02: .7 },'completed',1.8,55000,'Power Distribution Company',{ completedAt: 'T-30d' }),
  inv('INV-012','Eastern Periphery School Expansion','education',{ r08: .3 },'stalled',9,18000,'Department of Education',{ plannedCompletion: 'T-40d', notes: 'Marked stalled in the source dataset.' })
];

for (const [name, data] of Object.entries({ regions, assets, investments })) writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2));
console.log(`wrote ${regions.length} regions, ${assets.length} assets, ${investments.length} investments -> ${out}`);
