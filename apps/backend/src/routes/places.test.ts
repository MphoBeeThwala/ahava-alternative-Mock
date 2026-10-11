import express from 'express';
import request from 'supertest';

jest.mock('../services/googleMaps', () => {
  class MapsUnavailableError extends Error { constructor(public reason: string) { super(reason); } }
  return {
    MapsUnavailableError,
    mapsEnabled: jest.fn(() => true),
    autocompleteAddress: jest.fn(),
    placeDetails: jest.fn(),
  };
});

import placesRoutes from './places';
import * as maps from '../services/googleMaps';

const mocked = maps as unknown as {
  mapsEnabled: jest.Mock; autocompleteAddress: jest.Mock; placeDetails: jest.Mock; MapsUnavailableError: new (r: string) => Error;
};

function appAs(role: string) {
  const app = express();
  app.use((req, _res, next) => { (req as any).user = { id: `user-${role}`, role }; next(); });
  app.use('/places', placesRoutes);
  return app;
}

const TOKEN = 'session-token-123';

beforeEach(() => { jest.clearAllMocks(); mocked.mapsEnabled.mockReturnValue(true); });

describe('GET /places/config', () => {
  it('reports whether maps are on', async () => {
    mocked.mapsEnabled.mockReturnValue(false);
    const res = await request(appAs('PATIENT')).get('/places/config');
    expect(res.body).toMatchObject({ success: true, enabled: false });
  });
});

describe('GET /places/autocomplete', () => {
  it('returns suggestions for a patient', async () => {
    mocked.autocompleteAddress.mockResolvedValue([{ placeId: 'ChIJabc1234567', text: '12 Main Road' }]);
    const res = await request(appAs('PATIENT')).get('/places/autocomplete').query({ input: '12 Main', sessionToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, suggestions: [{ placeId: 'ChIJabc1234567', text: '12 Main Road' }] });
    expect(mocked.autocompleteAddress).toHaveBeenCalledWith('12 Main', TOKEN);
  });

  it('refuses nurses, and does not call Google', async () => {
    const res = await request(appAs('NURSE')).get('/places/autocomplete').query({ input: '12 Main', sessionToken: TOKEN });
    expect(res.status).toBe(403);
    expect(mocked.autocompleteAddress).not.toHaveBeenCalled();
  });

  it('rejects short input and bad session tokens before calling Google', async () => {
    const app = appAs('PATIENT');
    expect((await request(app).get('/places/autocomplete').query({ input: '12', sessionToken: TOKEN })).status).toBe(400);
    expect((await request(app).get('/places/autocomplete').query({ input: '12 Main', sessionToken: 'x' })).status).toBe(400);
    expect((await request(app).get('/places/autocomplete').query({ input: 'x'.repeat(201), sessionToken: TOKEN })).status).toBe(400);
    expect(mocked.autocompleteAddress).not.toHaveBeenCalled();
  });

  it('answers available:false (not an error) when maps are off, capped or failing', async () => {
    mocked.autocompleteAddress.mockRejectedValue(new mocked.MapsUnavailableError('capped'));
    const res = await request(appAs('PATIENT')).get('/places/autocomplete').query({ input: '12 Main', sessionToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, suggestions: [] });
  });

  it('passes an unexpected error on as a 500, not as "unavailable"', async () => {
    mocked.autocompleteAddress.mockRejectedValue(new Error('boom'));
    const res = await request(appAs('PATIENT')).get('/places/autocomplete').query({ input: '12 Main', sessionToken: TOKEN });
    expect(res.status).toBe(500);
  });
});

describe('GET /places/details', () => {
  it('returns the resolved address', async () => {
    mocked.placeDetails.mockResolvedValue({ address: '12 Main Rd', lat: -26.25, lng: 27.85 });
    const res = await request(appAs('PATIENT')).get('/places/details').query({ placeId: 'ChIJabc1234567', sessionToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, place: { address: '12 Main Rd', lat: -26.25, lng: 27.85 } });
  });

  it('rejects a malformed place id without calling Google', async () => {
    const res = await request(appAs('PATIENT')).get('/places/details').query({ placeId: '../../etc?x=1', sessionToken: TOKEN });
    expect(res.status).toBe(400);
    expect(mocked.placeDetails).not.toHaveBeenCalled();
  });

  it('answers available:false when maps are unavailable', async () => {
    mocked.placeDetails.mockRejectedValue(new mocked.MapsUnavailableError('failed'));
    const res = await request(appAs('PATIENT')).get('/places/details').query({ placeId: 'ChIJabc1234567', sessionToken: TOKEN });
    expect(res.body).toMatchObject({ success: true, available: false });
  });
});
