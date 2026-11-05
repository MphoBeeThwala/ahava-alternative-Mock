/**
 * Server-side price list for nurse visits.
 *
 * The price of a booking must never come from the client: it is what PayFast
 * charges and what the nurse is paid. The client picks a duration; the amount
 * is looked up here. Keep in step with DURATIONS in
 * workspace/src/app/patient/book-visit/page.tsx (display only).
 */
export const VISIT_TARIFF_CENTS: Readonly<Record<number, number>> = {
  30: 35000,
  60: 50000,
  90: 70000,
  120: 90000,
};

export const ALLOWED_VISIT_DURATIONS = Object.keys(VISIT_TARIFF_CENTS).map(Number);

/** Amount in cents for a duration, or null if the duration is not on the tariff. */
export function visitPriceCents(durationMinutes: number): number | null {
  return VISIT_TARIFF_CENTS[durationMinutes] ?? null;
}
