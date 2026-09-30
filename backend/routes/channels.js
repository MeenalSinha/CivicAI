// Messaging-channel payload normalisers. Add a new channel by adding one function here;
// everything downstream (classification, clustering, scoring) is channel-agnostic.
// NOTE: media (voice notes/images) is not fetched from provider URLs by design (no outbound fetch to
// untrusted URLs); text and shared-location messages are supported.
export const CHANNEL_NORMALIZERS = {
  generic: b => ({ from: b.from, text: b.text, lat: b.lat, lng: b.lng, language: b.language }),
  'whatsapp-cloud': b => {
    const m = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!m) return null;
    return { from: m.from, text: m.type === 'text' ? m.text?.body : m.caption, lat: m.location?.latitude, lng: m.location?.longitude };
  },
  telegram: b => {
    const m = b?.message;
    if (!m) return null;
    return { from: m.from?.id, text: m.text || m.caption, lat: m.location?.latitude, lng: m.location?.longitude };
  },
  sms: b => ({ from: b.From || b.from, text: b.Body || b.text })
};
export function normalizeChannelPayload(channel, body) {
  const fn = CHANNEL_NORMALIZERS[channel];
  return fn ? fn(body || {}) : undefined;
}
