// ============================================================
// SYNTHETIC citizen-request generator (demonstration only).
// Produces reproducible multilingual request TEXT + metadata. It does NOT
// produce any classification/score: every request is pushed through the real
// normalisation + clustering + scoring pipeline, so all intelligence is computed.
// All generated rows are flagged isSynthetic=1 and labelled in the UI.
// ============================================================
import { rng, hashString, jitterAround } from '../intelligence/geo.js';

const T = {
  pothole: { en: ['Big pothole on the road near {loc}, vehicles are getting damaged.', 'There are many potholes on the main road in {loc}; it is dangerous for two-wheelers.'], hinglish: ['{loc} mein sadak par bada gadda hai, gaadiyan kharab ho rahi hain.', '{loc} ke paas road par gadde hi gadde hain, accident ka darr hai.'], hi: ['{loc} में सड़क पर बड़ा गड्ढा है, गाड़ियों को नुकसान हो रहा है।', '{loc} की मुख्य सड़क पर कई गड्ढे हैं, दुर्घटना का खतरा है।'] },
  road_damage: { en: ['The road is broken and damaged near {loc}.', 'Cracked road surface in {loc}, needs urgent repair.'], hinglish: ['{loc} mein sadak toot gayi hai, jaldi theek karo.', '{loc} ki sadak kharab hai, bahut dikkat hoti hai.'], hi: ['{loc} में सड़क टूटी हुई है, मरम्मत करें।', '{loc} की सड़क खराब है और बहुत परेशानी होती है।'] },
  missing_road: { en: ['There is no proper road to our colony in {loc}, it is a dirt road.', 'Unpaved dirt road in {loc}; residents cannot reach the main road in the rains.'], hinglish: ['{loc} mein humare mohalla tak pakki sadak nahi hai, kachi sadak hai.', '{loc} mein kacchi sadak hai, barish mein bahut dikkat hoti hai.'], hi: ['{loc} में हमारे मोहल्ले तक पक्की सड़क नहीं है, कच्ची सड़क है।', '{loc} में कच्चा रास्ता है, बारिश में परेशानी होती है।'] },
  no_supply: { en: ['No water supply in {loc} for days, families are struggling.', 'Water is not coming in our area {loc}; there is a severe water shortage.'], hinglish: ['{loc} mein paani nahi aa raha, hamare mohalla mein dikkat hai.', '{loc} mein paani ki kami hai, bahut pareshani hai.'], hi: ['{loc} में पानी नहीं आ रहा है, परेशानी है।', '{loc} में पानी की कमी है, सभी परिवार परेशान हैं।'] },
  contaminated: { en: ['Dirty water is coming from the taps in {loc}, it smells bad.', 'Contaminated water supply in {loc}, people are falling sick.'], hinglish: ['{loc} mein ganda paani aa raha hai, bimar hone ka darr hai.', '{loc} ke nal se ganda pani aata hai.'], hi: ['{loc} में गंदा पानी आ रहा है, बदबू आती है।', '{loc} में दूषित पानी की समस्या है।'] },
  waterlogging: { en: ['Severe waterlogging in {loc} after rain, the street is flooded.', 'Water logging near {loc} every time it rains, knee deep water on the street.'], hinglish: ['{loc} mein baarish ke baad jalbharav ho jata hai, paani bhar jata hai.', '{loc} ke paas paani bhar gaya hai, jalbharav hai.'], hi: ['{loc} में बारिश के बाद जलभराव हो जाता है, पानी भर गया है।', '{loc} में हर बार पानी जमा हो जाता है, जलभराव की समस्या है।'] },
  blocked_drain: { en: ['Blocked drain in {loc}, dirty water is overflowing onto the street.', 'Clogged drain near {loc} has not been cleaned for weeks.'], hinglish: ['{loc} mein nali jam ho gayi hai, saaf-safai nahi hoti.', '{loc} ke paas naali jam hai, safai nahi hui.'], hi: ['{loc} में नाली जाम हो गई है, सफाई नहीं होती।', '{loc} की नाली भर गई है और ओवरफ्लो हो रही है।'] },
  sewer_overflow: { en: ['Sewage is overflowing on the road in {loc}, sewer line is blocked.', 'Sewer overflow near {loc} for many days, terrible smell.'], hinglish: ['{loc} mein sewer overflow ho raha hai, sadak par sewage hai.', '{loc} ke paas sewer jam hai, badbu aa rahi hai.'], hi: ['{loc} में सीवर ओवरफ्लो हो रहा है।', '{loc} में सीवेज सड़क पर बह रहा है।'] },
  garbage_overflow: { en: ['Garbage is piled up near {loc}, the dustbin is overflowing.', 'Garbage overflow in {loc} for several days, terrible smell.'], hinglish: ['{loc} mein kachra ka dher laga hai, dustbin bhar gaya hai.', '{loc} ke paas kachra overflow ho raha hai, badbu aa rahi hai.'], hi: ['{loc} में कचरे का ढेर लगा है, कूड़ा उठाया नहीं जा रहा।', '{loc} के पास कचरा फैला हुआ है, बदबू आ रही है।'] },
  no_collection: { en: ['Garbage is not collected in {loc}; the collection vehicle has not come for a week.', 'Waste not collected for days in {loc}, no collection vehicle.'], hinglish: ['{loc} mein kachra nahi utha, kachre ki gadi nahi aayi.', '{loc} mein kachra gaadi nahi aa rahi hai.'], hi: ['{loc} में कचरा नहीं उठा, कचरा गाड़ी नहीं आई।', '{loc} में कूड़े की गाड़ी नहीं आ रही है।'] },
  streetlight: { en: ['Street lights are not working near {loc}, the road is very dark at night.', 'Streetlight broken in {loc}, nobody has repaired it.'], hinglish: ['{loc} mein streetlight kharab hai, andhera rehta hai.', '{loc} ke paas street light band hai, raat ko dikkat hoti hai.'], hi: ['{loc} में स्ट्रीट लाइट खराब है, अंधेरा रहता है।', '{loc} में बत्ती नहीं जल रही, रात में अंधेरा है।'] },
  power_outage: { en: ['Frequent power cuts in {loc}, no electricity for hours.', 'Power outage in {loc} again, this is happening daily.'], hinglish: ['{loc} mein bijli nahi aa rahi, baar baar power cut hota hai.', '{loc} mein bijli gul hai, roz light nahi rehti.'], hi: ['{loc} में बिजली नहीं है, बार-बार बिजली कटौती होती है।', '{loc} में बिजली गुल रहती है।'] },
  no_facility: { en: ['There is no hospital or clinic near {loc}, we have to travel very far when someone is ill.', 'We need a health centre in {loc}; the nearest hospital is too far for residents.'], hinglish: ['{loc} ke paas koi hospital nahi hai, aspatal bahut door hai.', '{loc} mein clinic nahi hai, mareez ko door le jana padta hai.'], hi: ['{loc} के पास अस्पताल नहीं है, इलाज के लिए बहुत दूर जाना पड़ता है।', '{loc} में स्वास्थ्य केंद्र नहीं है, अस्पताल दूर है।'] },
  staff_shortage: { en: ['The government clinic in {loc} has no doctor available most days.', 'Doctors are absent at the health centre in {loc}.'], hinglish: ['{loc} ke aspatal mein doctor nahi milte, staff nahi hai.', '{loc} ke clinic mein doctor available nahi rehte.'], hi: ['{loc} के अस्पताल में डॉक्टर नहीं मिलते।', '{loc} के क्लिनिक में डॉक्टर उपलब्ध नहीं रहते।'] },
  no_school: { en: ['There is no school near {loc}, children walk very far.', 'We need a school in {loc}; the nearest school is too far for kids.'], hinglish: ['{loc} ke paas school nahi hai, bachche door jaate hain.', '{loc} mein school chahiye, school door hai.'], hi: ['{loc} के पास स्कूल नहीं है, बच्चे दूर जाते हैं।', '{loc} में स्कूल चाहिए, स्कूल दूर है।'] },
  bus_service: { en: ['No bus service to {loc}, we need a bus route.', 'Very few buses come to {loc}; the bus stop has no shelter.'], hinglish: ['{loc} mein bus nahi aati, bus service ki zarurat hai.', '{loc} ke liye bus route nahi hai, bus stop bhi door hai.'], hi: ['{loc} में बस सेवा नहीं है, बस की सुविधा चाहिए।', '{loc} में बस नहीं आती, बस स्टॉप दूर है।'] },
  no_coverage: { en: ['No mobile network in {loc}, there is no signal inside houses.', 'Poor network and weak signal in {loc}; we need a mobile tower.'], hinglish: ['{loc} mein network nahi aata, signal nahi milta.', '{loc} mein mobile tower ki zarurat hai, network ki problem hai.'], hi: ['{loc} में नेटवर्क नहीं आता, सिग्नल नहीं मिलता।', '{loc} में टावर नहीं है, नेटवर्क की समस्या है।'] }
};
const SUFFIX = {
  en: ['', '', ' It has been like this for {n} days.', ' The whole colony is affected.', ' Please act soon.'],
  hinglish: ['', '', ' Pichle {n} din se yahi haal hai.', ' Poore mohalla ke log pareshan hain.', ' Kripya jaldi dhyan dein.'],
  hi: ['', '', ' पिछले {n} दिनों से यही हाल है।', ' पूरे मोहल्ले के लोग परेशान हैं।', ' कृपया जल्दी ध्यान दें।']
};
export const SUB_CATEGORY = {
  pothole: 'roads_transport', road_damage: 'roads_transport', missing_road: 'roads_transport', no_supply: 'water_supply', contaminated: 'water_supply',
  waterlogging: 'drainage_flood', blocked_drain: 'drainage_flood', sewer_overflow: 'sanitation', garbage_overflow: 'waste_management', no_collection: 'waste_management',
  streetlight: 'electricity', power_outage: 'electricity', no_facility: 'public_healthcare', staff_shortage: 'public_healthcare', no_school: 'education', bus_service: 'public_mobility', no_coverage: 'digital_connectivity'
};
const IMAGE_SUBS = new Set(['pothole', 'road_damage', 'garbage_overflow', 'streetlight', 'waterlogging', 'blocked_drain', 'sewer_overflow']);

// [region, subcategory, weekly rate at start, weekly rate at end, mean upvotes, fromWeek]
// This encodes the demonstration SCENARIO only; scores/gaps/priorities are computed downstream.
export const PROFILES = [
  ['r08', 'no_facility', 1, 5, 4, 0], ['r08', 'staff_shortage', 0, 1, 2, 4], ['r08', 'missing_road', 2, 3, 3, 0], ['r08', 'bus_service', 1, 3, 2, 0], ['r08', 'no_school', .5, 1.5, 2, 0],
  ['r09', 'no_supply', 3, 4, 5, 0], ['r09', 'contaminated', 1, 2, 3, 0], ['r09', 'waterlogging', 1, 2, 2, 0], ['r09', 'sewer_overflow', 1, 2, 2, 0], ['r09', 'no_collection', 1, 2, 2, 0],
  ['r03', 'waterlogging', 1, 5, 5, 0], ['r03', 'pothole', 2, 2, 3, 0],
  ['r05', 'waterlogging', 2, 3, 4, 0], ['r05', 'sewer_overflow', 2, 2, 3, 0], ['r05', 'contaminated', 1, 1.5, 3, 0],
  ['r06', 'no_coverage', 1, 2, 2, 0], ['r06', 'missing_road', 1, 1.5, 2, 0], ['r06', 'no_facility', .5, 1.5, 2, 0],
  ['r02', 'pothole', 3, 2, 3, 0], ['r02', 'streetlight', 3, .4, 3, 0],
  ['r01', 'garbage_overflow', 5, 1, 4, 0], ['r01', 'no_collection', 2, .3, 2, 0],
  ['r04', 'pothole', 3, 4, 4, 0], ['r04', 'road_damage', 2, 2, 3, 0],
  ['r07', 'pothole', .5, .5, 1, 0], ['r07', 'streetlight', .5, .5, 1, 0],
  ['r10', 'power_outage', 1.5, 3, 3, 9], ['r10', 'blocked_drain', .5, .5, 1, 0]
];

const WEEKS = 13;

export function generateSyntheticRequests(regions, now = new Date(), seed = 20260930) {
  const R = rng(seed);
  const byId = Object.fromEntries(regions.map(r => [r.id, r]));
  const out = [];
  let n = 0;
  for (const [rid, sub, r0, r1, upMean, fromWeek] of PROFILES) {
    const region = byId[rid]; if (!region) continue;
    // 1-3 hotspot centres inside the region
    const hotspots = Array.from({ length: 1 + Math.floor(R() * 3) }, (_, i) => jitterAround(region, region.radiusKm * 0.6, `${rid}|${sub}|hs${i}`));
    for (let w = fromWeek; w < WEEKS; w++) {
      const f = WEEKS > 1 ? w / (WEEKS - 1) : 1;
      const rate = r0 + (r1 - r0) * f;
      // Poisson-ish sampling: floor + Bernoulli remainder
      let count = Math.floor(rate) + (R() < rate - Math.floor(rate) ? 1 : 0);
      if (R() < 0.15) count += Math.round(R()); // mild noise
      for (let k = 0; k < count; k++) {
        const daysAgo = Math.max(0.02, (WEEKS - 1 - w) * 7 + R() * 7 - 0.0);
        const ts = new Date(now.getTime() - daysAgo * 86_400_000);
        const lr = R();
        const lang = lr < 0.35 ? 'en' : lr < 0.75 ? 'hinglish' : 'hi';
        const tpl = T[sub][lang][Math.floor(R() * T[sub][lang].length)];
        const suf = SUFFIX[lang][Math.floor(R() * SUFFIX[lang].length)].replace('{n}', String(2 + Math.floor(R() * 12)));
        const useNamed = R() < 0.6;
        const alias = region.aliases?.length && R() < 0.4 ? region.aliases[Math.floor(R() * region.aliases.length)] : region.name;
        const loc = useNamed ? alias : 'our area';
        // put the region name in text even for "our area" variants so the gazetteer can place it in ~half of them
        const text = tpl.replace('{loc}', loc) + suf + (!useNamed && R() < 0.5 ? ` (${region.name})` : '');
        const cr = R();
        const channel = cr < 0.35 ? 'chat' : cr < 0.55 ? 'text' : cr < 0.75 ? 'voice' : cr < 0.85 && IMAGE_SUBS.has(sub) ? 'image' : 'messaging';
        const gps = R() < 0.55; // ~55% share GPS; others rely on text/gazetteer
        const spot = R() < 0.7 ? hotspots[Math.floor(R() * hotspots.length)] : jitterAround(region, region.radiusKm * 0.9, `${rid}|${sub}|${n}`);
        const p = jitterAround(spot, 0.35, `${rid}|${sub}|p${n}`);
        out.push({
          text, channel, language: undefined,
          lat: gps ? p.lat : null, lng: gps ? p.lng : null, locationText: undefined,
          timestamp: ts.toISOString(),
          submitterKey: `synthetic-citizen-${hashString(`${seed}|${n}`) % 900}`,
          upvotes: Math.max(0, Math.round((R() * 2 - 0.5) * upMean + (R() < 0.3 ? upMean : 0))),
          imageEvidence: channel === 'image' ? { detected: true, label: sub, confidence: 0.8 + Math.round(R() * 15) / 100, model: 'synthetic-demo' } : null,
          isSynthetic: true, _profile: `${rid}.${sub}`
        });
        n++;
      }
    }
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
