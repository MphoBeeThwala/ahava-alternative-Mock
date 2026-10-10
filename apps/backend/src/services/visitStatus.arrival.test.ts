import { ARRIVAL_RADIUS_M, distanceMeters, evaluateArrival } from './visitStatus';

const JHB = { lat: -26.2041, lng: 28.0473 };
// ~111 m per 0.001 degree of latitude
const northBy = (m: number) => ({ lat: JHB.lat + m / 111_195, lng: JHB.lng });

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(JHB, JHB)).toBe(0);
  });

  it('measures about 111 km per degree of latitude', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('is symmetric', () => {
    const a = { lat: -33.9249, lng: 18.4241 };
    expect(distanceMeters(a, JHB)).toBeCloseTo(distanceMeters(JHB, a), 6);
  });
});

describe('evaluateArrival', () => {
  it('allows and verifies a nurse within the radius', () => {
    const r = evaluateArrival({ target: JHB, nurse: northBy(50) });
    expect(r).toMatchObject({ allowed: true, verified: true });
    expect((r as { distanceMeters: number }).distanceMeters).toBeLessThanOrEqual(ARRIVAL_RADIUS_M);
  });

  it('asks for a reason when the nurse is too far, and reports the distance', () => {
    const r = evaluateArrival({ target: JHB, nurse: northBy(1_000) });
    expect(r.allowed).toBe(false);
    expect(r).toMatchObject({ code: 'ARRIVAL_TOO_FAR' });
    expect((r as { distanceMeters: number }).distanceMeters).toBeGreaterThan(900);
  });

  it('allows a far nurse who gives a valid reason, unverified, and keeps the reason', () => {
    const r = evaluateArrival({ target: JHB, nurse: northBy(1_000), reason: 'WRONG_PIN' });
    expect(r).toMatchObject({ allowed: true, verified: false, overrideReason: 'WRONG_PIN' });
  });

  it('ignores a reason that is not on the list', () => {
    const r = evaluateArrival({ target: JHB, nurse: northBy(1_000), reason: 'because' });
    expect(r.allowed).toBe(false);
  });

  it('needs a reason when the nurse position is missing or invalid', () => {
    for (const nurse of [undefined, null, {}, { lat: 'x', lng: 1 }, { lat: 95, lng: 0 }, { lat: NaN, lng: 0 }]) {
      const r = evaluateArrival({ target: JHB, nurse });
      expect(r).toMatchObject({ allowed: false, code: 'ARRIVAL_POSITION_UNKNOWN' });
    }
    expect(evaluateArrival({ target: JHB, nurse: null, reason: 'GPS_INACCURATE' }))
      .toMatchObject({ allowed: true, verified: false, overrideReason: 'GPS_INACCURATE', distanceMeters: null });
  });

  it('does not block when the booking has no usable location', () => {
    for (const target of [null, undefined, {}, { lat: 200, lng: 0 }]) {
      expect(evaluateArrival({ target, nurse: JHB })).toMatchObject({ allowed: true, verified: false, note: 'NO_BOOKING_LOCATION' });
    }
  });

  it('honours a custom radius', () => {
    expect(evaluateArrival({ target: JHB, nurse: northBy(500), radiusM: 1_000 })).toMatchObject({ allowed: true, verified: true });
    expect(evaluateArrival({ target: JHB, nurse: northBy(500), radiusM: 100 }).allowed).toBe(false);
  });
});
