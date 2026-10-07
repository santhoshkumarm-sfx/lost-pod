/** Hub codes look like DEL_KirtiNagar_RTS, CJB_DC_FMRTS, ST_Godadara_RTS, Bom_Kurla_FM. */
const HUB_RE = /^[A-Za-z]{2,5}_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/;

/** Hub prefix -> city. Extend from Settings ("hub_city_codes") without a deploy. */
export const HUB_CITY_CODES: Record<string, string> = {
  AGR: 'Agra', AMD: 'Ahmedabad', BLR: 'Bengaluru', BOM: 'Mumbai', CBE: 'Coimbatore', CCU: 'Kolkata',
  CJB: 'Coimbatore', DEL: 'Delhi', FDB: 'Faridabad', GGN: 'Gurugram', HYD: 'Hyderabad', JAI: 'Jaipur',
  LKO: 'Lucknow', MAA: 'Chennai', NOI: 'Noida', PUN: 'Pune', PWL: 'Palwal', RJT: 'Rajkot', SRT: 'Surat',
  ST: 'Surat', TUP: 'Tiruppur', HAR: 'Haryana',
};

export function looksLikeHub(v: string): boolean {
  return HUB_RE.test(v.trim());
}

export function cityForHub(hub: string, extra: Record<string, string> = {}): string | null {
  const prefix = hub.split('_')[0].toUpperCase();
  return extra[prefix] ?? HUB_CITY_CODES[prefix] ?? null;
}

/**
 * Trackers put hub codes in "Location", "Hub" or "Name" columns. A hub-looking value becomes the hub
 * (and its city becomes the location); anything else is a free-text location.
 */
export function splitLocationHub(
  hubValue: string | null,
  locationValue: string | null,
  extraCodes: Record<string, string> = {},
): { hub: string | null; location: string | null } {
  let hub: string | null = null;
  let location: string | null = null;
  for (const v of [hubValue, locationValue]) {
    if (!v) continue;
    if (looksLikeHub(v)) hub = hub ?? v;
    else location = location ?? v;
  }
  if (!hub && hubValue && !looksLikeHub(hubValue)) hub = hubValue;
  if (hub && !location && looksLikeHub(hub)) location = cityForHub(hub, extraCodes);
  return { hub, location };
}
