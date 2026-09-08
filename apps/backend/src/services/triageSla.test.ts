import { calculateSlaDeadline, getDoctorFee } from "./triageSla";

describe("triageSla", () => {
  describe("calculateSlaDeadline", () => {
    it.each([
      [1, 5],
      [2, 15],
      [3, 60],
      [4, 240],
      [5, 480],
    ])("gives level %i a %i-minute deadline", (level, minutes) => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const deadline = calculateSlaDeadline(level, createdAt);

      expect(deadline.getTime() - createdAt.getTime()).toBe(minutes * 60 * 1000);
    });

    it("falls back to 60 minutes for an unrecognized level", () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const deadline = calculateSlaDeadline(99, createdAt);

      expect(deadline.getTime() - createdAt.getTime()).toBe(60 * 60 * 1000);
    });
  });

  describe("getDoctorFee", () => {
    it.each([
      [1, 15000],
      [2, 10000],
      [3, 7500],
      [4, 5000],
      [5, 3000],
    ])("level %i pays %i cents", (level, cents) => {
      expect(getDoctorFee(level)).toBe(cents);
    });

    it("falls back to 5000 cents for an unrecognized level", () => {
      expect(getDoctorFee(99)).toBe(5000);
    });
  });
});
