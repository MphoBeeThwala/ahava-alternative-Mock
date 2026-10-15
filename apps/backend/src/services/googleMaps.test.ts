import {
  MapsUnavailableError, _clearEtaCacheForTests, _resetMapsCountersForTests, autocompleteAddress, driveEta, etaForVisit, mapsEnabled, placeDetails,
} from './googleMaps';

const KEY = 'test-key-not-real-123';
const ENV_KEYS = ['GOOGLE_MAPS_SERVER_KEY', 'GOOGLE_MAPS_ENABLED', 'GOOGLE_MAPS_LEGAL_SIGNED_OFF', 'GOOGLE_MAPS_CAP_ROUTES', 'GOOGLE_MAPS_CAP_AUTOCOMPLETE', 'GOOGLE_MAPS_REGION'];
const saved: Record<string, string | undefined> = {};
const fetchMock = jest.fn();

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const enable = () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = KEY;
  process.env.GOOGLE_MAPS_ENABLED = 'true';
  process.env.GOOGLE_MAPS_LEGAL_SIGNED_OFF = 'true';
};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  fetchMock.mockReset();
  (global as any).fetch = fetchMock;
  _resetMapsCountersForTests();
  _clearEtaCacheForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('switching maps on', () => {
  it('is off by default and never calls Google', async () => {
    expect(mapsEnabled()).toBe(false);
    await expect(autocompleteAddress('12 Main Road', 'session-token-1')).rejects.toMatchObject({ reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs the key, the enabled flag AND the legal sign-off flag', () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = KEY;
    process.env.GOOGLE_MAPS_ENABLED = 'true';
    expect(mapsEnabled()).toBe(false); // legal gate missing
    process.env.GOOGLE_MAPS_LEGAL_SIGNED_OFF = 'true';
    expect(mapsEnabled()).toBe(true);
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    expect(mapsEnabled()).toBe(false);
  });
});

describe('autocomplete', () => {
  it('sends the key in a header, restricts to South Africa, uses the session token, and parses suggestions', async () => {
    enable();
    fetchMock.mockResolvedValue(ok({ suggestions: [
      { placePrediction: { placeId: 'ChIJabc1234567', text: { text: '12 Main Road, Soweto' } } },
      { queryPrediction: { text: { text: 'ignored' } } },
    ] }));
    const out = await autocompleteAddress('12 Main', 'session-token-1');
    expect(out).toEqual([{ placeId: 'ChIJabc1234567', text: '12 Main Road, Soweto' }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(url).not.toContain(KEY); // the key must never be in a URL
    expect(init.headers['X-Goog-Api-Key']).toBe(KEY);
    expect(init.headers['X-Goog-FieldMask']).toContain('placePrediction.placeId');
    expect(JSON.parse(init.body)).toMatchObject({ input: '12 Main', sessionToken: 'session-token-1', includedRegionCodes: ['za'] });
  });

  it('returns at most 5 suggestions', async () => {
    enable();
    fetchMock.mockResolvedValue(ok({ suggestions: Array.from({ length: 9 }, (_, i) => ({ placePrediction: { placeId: `place-id-${i}-xxxx`, text: { text: `Address ${i}` } } })) }));
    expect(await autocompleteAddress('some street', 'session-token-1')).toHaveLength(5);
  });
});

describe('place details', () => {
  it('asks only for address and location, and parses them', async () => {
    enable();
    fetchMock.mockResolvedValue(ok({ formattedAddress: '12 Main Rd, Soweto, 1804', location: { latitude: -26.25, longitude: 27.85 } }));
    const out = await placeDetails('ChIJabc1234567', 'session-token-1');
    expect(out).toEqual({ address: '12 Main Rd, Soweto, 1804', lat: -26.25, lng: 27.85 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/places/ChIJabc1234567');
    expect(url).toContain('sessionToken=session-token-1');
    expect(init.headers['X-Goog-FieldMask']).toBe('formattedAddress,location');
  });

  it('rejects a response without coordinates', async () => {
    enable();
    fetchMock.mockResolvedValue(ok({ formattedAddress: 'x' }));
    await expect(placeDetails('ChIJabc1234567', 'session-token-1')).rejects.toBeInstanceOf(MapsUnavailableError);
  });
});

describe('drive ETA', () => {
  it('uses the cheaper traffic-unaware tier and parses the duration', async () => {
    enable();
    fetchMock.mockResolvedValue(ok({ routes: [{ duration: '743s', distanceMeters: 5210 }] }));
    expect(await driveEta({ lat: -26.2, lng: 28 }, { lat: -26.25, lng: 27.85 })).toEqual({ seconds: 743, meters: 5210 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
    expect(body.travelMode).toBe('DRIVE');
    expect(fetchMock.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('routes.duration,routes.distanceMeters');
  });
});

describe('failure handling', () => {
  it('turns an HTTP error into MapsUnavailableError without leaking the key or the response body', async () => {
    enable();
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: `bad key ${KEY}` }), text: async () => KEY });
    const err = await autocompleteAddress('12 Main Road', 'session-token-1').catch((e) => e);
    expect(err).toBeInstanceOf(MapsUnavailableError);
    expect(err.reason).toBe('failed');
    expect(String(err.message)).not.toContain(KEY);
  });

  it('turns a network error into MapsUnavailableError', async () => {
    enable();
    fetchMock.mockRejectedValue(new Error(`connect failed for ${KEY}`));
    const err = await driveEta({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(MapsUnavailableError);
    expect(String(err.message)).not.toContain(KEY);
  });
});

describe('monthly caps', () => {
  it('stops calling Google once the cap is reached', async () => {
    enable();
    process.env.GOOGLE_MAPS_CAP_ROUTES = '2';
    fetchMock.mockResolvedValue(ok({ routes: [{ duration: '60s', distanceMeters: 100 }] }));
    const a = { lat: 0, lng: 0 }, b = { lat: 1, lng: 1 };
    await driveEta(a, b);
    await driveEta(a, b);
    await expect(driveEta(a, b)).rejects.toMatchObject({ reason: 'capped' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('counts each kind of call separately', async () => {
    enable();
    process.env.GOOGLE_MAPS_CAP_AUTOCOMPLETE = '0';
    fetchMock.mockResolvedValue(ok({ routes: [{ duration: '60s', distanceMeters: 100 }] }));
    await expect(autocompleteAddress('12 Main Road', 'session-token-1')).rejects.toMatchObject({ reason: 'capped' });
    await expect(driveEta({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).resolves.toBeDefined();
  });
});

describe('etaForVisit (throttled, background)', () => {
  const flush = () => new Promise((r) => setImmediate(r));
  const from = { lat: -26.2, lng: 28 }, to = { lat: -26.25, lng: 27.85 };

  it('does nothing when maps are off', () => {
    expect(etaForVisit('v1', from, to)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null at first, then the ETA once the background call lands, with one call per minute', async () => {
    enable();
    fetchMock.mockResolvedValue(ok({ routes: [{ duration: '600s', distanceMeters: 4000 }] }));
    expect(etaForVisit('v1', from, to)).toBeNull();
    await flush();
    expect(etaForVisit('v1', from, to)).toBe(600);
    expect(etaForVisit('v1', from, to)).toBe(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the last ETA when a refresh fails', async () => {
    enable();
    fetchMock.mockResolvedValueOnce(ok({ routes: [{ duration: '600s', distanceMeters: 4000 }] }));
    etaForVisit('v2', from, to);
    await flush();
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000; // a minute later: due for a refresh
    try {
      fetchMock.mockRejectedValueOnce(new Error('down'));
      expect(etaForVisit('v2', from, to)).toBe(600);
      await flush();
      Date.now = () => realNow() + 61_000 + 61_000;
      expect(etaForVisit('v2', from, to)).toBe(600);
    } finally {
      Date.now = realNow;
    }
  });
});
