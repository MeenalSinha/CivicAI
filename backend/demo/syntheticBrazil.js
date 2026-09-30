// ============================================================
// BRAZIL SYNTHETIC citizen-request generator (demonstration only).
// Produces reproducible Portuguese-language citizen request TEXT + metadata.
// All generated rows are flagged isSynthetic=1 and labelled in the UI.
// Uses the SAME pipeline as India — only the language/location context differs.
// ============================================================
import { rng, jitterAround } from '../intelligence/geo.js';

const T = {
  // Water supply
  no_supply: {
    pt: [
      'Falta de água há {n} dias no {loc}. Estamos sem abastecimento e as famílias estão sofrendo.',
      'Há {n} dias sem água no {loc}. Os moradores precisam de ajuda urgente.',
      'Sem água no bairro {loc} faz mais de uma semana. Precisamos de uma solução.'
    ]
  },
  contaminated: {
    pt: [
      'A água que chega nas torneiras do {loc} está suja e com mau cheiro. Medo de ficar doente.',
      'Água contaminada no {loc}. Saiu marrom das torneiras hoje de manhã.',
      'A água está turva e fede no {loc}. Vizinhos estão reclamando há dias.'
    ]
  },
  // Flooding / drainage
  waterlogging: {
    pt: [
      'Alagamento na rua do {loc} toda vez que chove. A água chega até o joelho.',
      'Rua do {loc} inunda sempre que tem chuva. Carros ficam presos e crianças não conseguem ir para a escola.',
      'Ponto de alagamento crítico no {loc}. Já perdemos móveis por causa da enchente.'
    ]
  },
  blocked_drain: {
    pt: [
      'Bueiro entupido no {loc}. Água suja parada na rua há dias.',
      'Sarjeta entupida no {loc}. Mau cheiro insuportável e risco de dengue.',
      'Entupimento na galeria de drenagem no {loc}. Precisamos de limpeza urgente.'
    ]
  },
  // Roads
  pothole: {
    pt: [
      'Buraco enorme na rua do {loc} causando acidentes. Várias motos já caíram.',
      'Muitos buracos na via principal do {loc}. Está perigoso para veículos.',
      'Buraco no asfalto do {loc} há {n} semanas. Ninguém vem consertar.'
    ]
  },
  missing_road: {
    pt: [
      'Rua do {loc} sem asfalto. Quando chove fica intransitável de lama.',
      'A rua principal do {loc} é de terra batida. Os moradores pedem pavimentação há anos.',
      'Rua sem pavimento no {loc}. Crianças chegam enlameadas na escola.'
    ]
  },
  // Sanitation
  sewer_overflow: {
    pt: [
      'Esgoto estourando na rua do {loc}. Mau cheiro e risco de doenças.',
      'Vazamento de esgoto no {loc} há {n} dias. Crianças brincam perto e é perigoso.',
      'Cano de esgoto rompido no {loc}. Precisa de reparo urgente.'
    ]
  },
  // Garbage
  garbage_overflow: {
    pt: [
      'Lixo acumulado no {loc} há {n} dias. O caminhão não passou e está apodrecendo.',
      'Descarte irregular de lixo no {loc}. Está atraindo ratos e baratas.',
      'Lixeira transbordando no {loc}. Mau cheiro e risco de epidemia.'
    ]
  },
  // Healthcare
  no_facility: {
    pt: [
      'Não tem UBS perto do {loc}. Para ir ao posto de saúde são mais de 8km.',
      'O {loc} não tem unidade de saúde. Quando alguém fica doente não sabemos o que fazer.',
      'Falta posto de saúde no {loc}. A população está muito carente de atendimento médico.'
    ]
  },
  // Education
  no_school: {
    pt: [
      'Não tem escola perto do {loc}. As crianças andam muito longe e é perigoso.',
      'Falta escola no {loc}. Os pais precisam mandar os filhos para outro bairro.',
      'Precisamos de uma escola no {loc}. As crianças ficam sem vagas todo ano.'
    ]
  },
  // Public transport
  bus_service: {
    pt: [
      'O ônibus não passa no {loc}. Para pegar transporte público andamos mais de 2km.',
      'Linha de ônibus insuficiente no {loc}. Os horários são poucos e os ônibus chegam lotados.',
      'Falta de transporte público no {loc}. Não conseguimos chegar ao trabalho a tempo.'
    ]
  },
  // Electricity
  streetlight: {
    pt: [
      'Poste sem luz no {loc}. A rua fica escura à noite e fica perigosa.',
      'Iluminação pública queimada no {loc} há semanas. Precisamos de mais segurança.',
      'Falta iluminação na rua do {loc}. Já tivemos roubos por causa do escuro.'
    ]
  }
};

const SUB_CATEGORY = {
  no_supply: 'water_supply', contaminated: 'water_supply',
  waterlogging: 'drainage_flood', blocked_drain: 'drainage_flood',
  pothole: 'roads_transport', missing_road: 'roads_transport',
  sewer_overflow: 'sanitation',
  garbage_overflow: 'waste_management',
  no_facility: 'public_healthcare',
  no_school: 'education',
  bus_service: 'public_mobility',
  streetlight: 'electricity'
};

// [bairroId, subcategory, weeklyRateStart, weeklyRateEnd, avgUpvotes, fromWeek]
// Encode demonstration scenario only; all scores are computed by the real pipeline.
export const BR_PROFILES = [
  ['b01', 'waterlogging', 2, 5, 5, 0], ['b01', 'sewer_overflow', 1, 3, 4, 0], ['b01', 'no_supply', 1, 2, 3, 0], ['b01', 'no_facility', 0.5, 2, 3, 2],
  ['b02', 'no_supply', 3, 5, 5, 0], ['b02', 'missing_road', 2, 3, 3, 0], ['b02', 'no_facility', 1, 2.5, 4, 0],
  ['b03', 'pothole', 2, 3, 3, 0], ['b03', 'blocked_drain', 1, 2, 2, 0], ['b03', 'garbage_overflow', 1, 1.5, 2, 0],
  ['b04', 'waterlogging', 3, 5, 5, 0], ['b04', 'sewer_overflow', 2, 3, 4, 0], ['b04', 'no_facility', 0.5, 1.5, 2, 4],
  ['b05', 'no_school', 1, 2, 3, 0], ['b05', 'bus_service', 2, 3, 3, 0], ['b05', 'no_facility', 1, 2, 3, 0],
  ['b06', 'bus_service', 1.5, 2, 3, 0], ['b06', 'pothole', 1.5, 2, 2, 0],
  ['b07', 'garbage_overflow', 1, 1.5, 2, 0], ['b07', 'waterlogging', 1, 2, 2, 0],
  ['b08', 'waterlogging', 2, 4, 5, 0], ['b08', 'no_supply', 1.5, 2.5, 3, 0], ['b08', 'sewer_overflow', 1, 2, 3, 0],
  ['b09', 'no_school', 0.5, 1.5, 2, 0], ['b09', 'bus_service', 1, 2, 2, 0],
  ['b10', 'waterlogging', 1, 3, 4, 0], ['b10', 'sewer_overflow', 0.5, 1.5, 2, 0], ['b10', 'streetlight', 1, 1.5, 2, 0]
];

const WEEKS = 13;

export function generateBrazilSyntheticRequests(regions, now = new Date(), seed = 20261001) {
  const R = rng(seed);
  const byId = Object.fromEntries(regions.map(r => [r.id, r]));
  const out = [];

  for (const [bid, sub, r0, r1, upMean, fromWeek] of BR_PROFILES) {
    const region = byId[bid]; if (!region) continue;
    const templates = T[sub]?.pt;
    if (!templates) continue;
    const hotspots = Array.from({ length: 1 + Math.floor(R() * 2) }, (_, i) =>
      jitterAround(region, region.radiusKm * 0.6, `${bid}|${sub}|hs${i}`));

    for (let w = fromWeek; w < WEEKS; w++) {
      const f = WEEKS > 1 ? w / (WEEKS - 1) : 1;
      const rate = r0 + (r1 - r0) * f;
      let count = Math.floor(rate) + (R() < rate - Math.floor(rate) ? 1 : 0);
      if (R() < 0.12) count += 1;

      for (let k = 0; k < count; k++) {
        const daysAgo = Math.max(0.02, (WEEKS - 1 - w) * 7 + R() * 7);
        const ts = new Date(now.getTime() - daysAgo * 86_400_000);
        const tpl = templates[Math.floor(R() * templates.length)];
        const hs = hotspots[Math.floor(R() * hotspots.length)];
        const jittered = jitterAround(hs, 0.15, `${bid}|${sub}|w${w}|k${k}`);
        const n = 2 + Math.floor(R() * 10);
        const text = tpl.replace('{loc}', region.name).replace('{n}', String(n));
        out.push({
          text,
          channel: 'text',
          language: 'pt',
          lat: jittered.lat,
          lng: jittered.lng,
          upvotes: Math.max(0, Math.round(upMean + (R() - 0.5) * upMean * 0.8)),
          timestamp: ts.toISOString(),
          isSynthetic: true,
          sourceId: 'br-demo-synthetic-requests'
        });
      }
    }
  }
  return out;
}
