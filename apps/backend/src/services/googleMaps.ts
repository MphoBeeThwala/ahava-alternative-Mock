/**
 * Google Maps Platform, server side only: address autocomplete and place
 * details for booking, and a drive-time ETA for the visit tracker.
 *
 * Why server side: the API key never reaches a browser, and every call passes
 * through the application's own caps, so a bug or abuse cannot run up a bill
 * before Google's console quota would stop it. No map is rendered, so there are
 * no map-load charges.
 *
 * Off unless ALL of these are set (the third is the legal gate, same pattern as
 * the clinical *_SIGNED_OFF flags: addresses and coordinates go to Google, so
 * the consent wording must name it first):
 *   GOOGLE_MAPS_SERVER_KEY, GOOGLE_MAPS_ENABLED=true, GOOGLE_MAPS_LEGAL_SIGNED_OFF=true
 *
 * Any failure (disabled, capped, timeout, bad response) is a MapsUnavailableError:
 * callers fall back to the manual address and the straight-line distance. A
 * maps outage must never block a booking.
 */
import { getRedis } from './redis';

export class MapsUnavailableError extends Error {
  constructor(public readonly reason: 'disabled' | 'capped' | 'failed', message?: string) {
    super(message ?? `Maps unavailable: ${reason}`);
    this.name = 'MapsUnavailableError';
  }
}

export type MapsSku = 'autocomplete' | 'details' | 'routes';

const DEFAULT_MONTHLY_CAP: Record<MapsSku, number> = {
  // Kept under Google's free monthly allowance per SKU (10,000 at the time of writing).
  autocomplete: 9_000,
  details: 9_000,
  routes: 9_000,
};

const TIMEOUT_MS = 5_000;

export const mapsEnabled = (): boolean =>
  process.env.GOOGLE_MAPS_ENABLED === 'true'
  && process.env.GOOGLE_MAPS_LEGAL_SIGNED_OFF === 'true'
  && !!process.env.GOOGLE_MAPS_SERVER_KEY;

const capFor = (sku: MapsSku): number => {
  const raw = parseInt(process.env[`GOOGLE_MAPS_CAP_${sku.toUpperCase()}`] ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MONTHLY_CAP[sku];
};

const monthKey = (sku: MapsSku, now = new Date()) => `gmaps:${sku}:${now.toISOString().slice(0, 7)}`;

// Used when Redis is not running (local dev) or a Redis call fails. Per process,
// so a multi-instance deploy can exceed it: Google's own console quota is the
// real hard stop, this is the first line.
const memoryCounts = new Map<string, number>();

/** Counts one call against the month's cap. True if it may go ahead. */
export async function reserve(sku: MapsSku, now = new Date()): Promise<boolean> {
  const key = monthKey(sku, now);
  const cap = capFor(sku);
  let used: number;
  try {
    const redis = getRedis();
    used = await redis.incr(key);
    if (used === 1) await redis.expire(key, 40 * 24 * 3600);
  } catch {
    used = (memoryCounts.get(key) ?? 0) + 1;
    memoryCounts.set(key, used);
  }
  return used <= cap;
}

/** Test helper. */
export const _resetMapsCountersForTests = () => memoryCounts.clear();

async function call(sku: MapsSku, url: string, init: RequestInit): Promise<any> {
  if (!mapsEnabled()) throw new MapsUnavailableError('disabled');
  if (!(await reserve(sku))) throw new MapsUnavailableError('capped');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_SERVER_KEY!, ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw new MapsUnavailableError('failed', `Google responded ${res.status}`); // never include the body or URL: they can echo the key
    return await res.json();
  } catch (err) {
    if (err instanceof MapsUnavailableError) throw err;
    throw new MapsUnavailableError('failed', 'Google request failed');
  } finally {
    clearTimeout(timer);
  }
}

export interface AddressSuggestion { placeId: string; text: string }
export interface ResolvedAddress { address: string; lat: number; lng: number }

const region = () => (process.env.GOOGLE_MAPS_REGION || 'za').toLowerCase();

/**
 * Address suggestions. Pass the same sessionToken to the placeDetails call that
 * follows: Google then bills the typing as one free session, not per keystroke.
 */
export async function autocompleteAddress(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
  const data = await call('autocomplete', 'https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text' },
    body: JSON.stringify({ input, sessionToken, includedRegionCodes: [region()] }),
  });
  const out: AddressSuggestion[] = [];
  for (const s of Array.isArray(data?.suggestions) ? data.suggestions : []) {
    const p = s?.placePrediction;
    if (typeof p?.placeId === 'string' && typeof p?.text?.text === 'string') out.push({ placeId: p.placeId, text: p.text.text });
    if (out.length === 5) break;
  }
  return out;
}

/** The chosen suggestion's formatted address and coordinates. Only these two fields are requested. */
export async function placeDetails(placeId: string, sessionToken: string): Promise<ResolvedAddress> {
  const data = await call('details', `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`, {
    method: 'GET',
    headers: { 'X-Goog-FieldMask': 'formattedAddress,location' },
  });
  const lat = data?.location?.latitude;
  const lng = data?.location?.longitude;
  if (typeof data?.formattedAddress !== 'string' || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new MapsUnavailableError('failed', 'Unexpected place details response');
  }
  return { address: data.formattedAddress, lat, lng };
}

/**
 * Drive time and distance between two points. TRAFFIC_UNAWARE on purpose: it is
 * Google's cheaper tier, and a visit ETA to the nearest minute does not need live traffic.
 */
export async function driveEta(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }): Promise<{ seconds: number; meters: number }> {
  const data = await call('routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
  });
  const route = data?.routes?.[0];
  const seconds = typeof route?.duration === 'string' ? parseInt(route.duration, 10) : NaN; // "743s"
  if (!Number.isFinite(seconds) || typeof route?.distanceMeters !== 'number') throw new MapsUnavailableError('failed', 'Unexpected route response');
  return { seconds, meters: route.distanceMeters };
}

// ETA cache: one Google routes call per visit per minute at most. The call runs
// in the background so a slow Google never delays the location update itself;
// the patient gets the last known ETA (null until the first one lands).
const ETA_REFRESH_MS = 60_000;
const etaCache = new Map<string, { at: number; seconds: number | null }>();

export function etaForVisit(visitId: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }): number | null {
  const cached = etaCache.get(visitId);
  const now = Date.now();
  if (!mapsEnabled() || (cached && now - cached.at < ETA_REFRESH_MS)) return cached?.seconds ?? null;
  etaCache.set(visitId, { at: now, seconds: cached?.seconds ?? null }); // claim the slot before the call returns
  if (etaCache.size > 500) {
    for (const [id, v] of etaCache) if (now - v.at > 10 * 60_000) etaCache.delete(id);
  }
  driveEta(from, to)
    .then((r) => etaCache.set(visitId, { at: Date.now(), seconds: r.seconds }))
    .catch(() => { /* keep the last ETA; the straight-line distance still shows */ });
  return cached?.seconds ?? null;
}

/** Test helper. */
export const _clearEtaCacheForTests = () => etaCache.clear();
