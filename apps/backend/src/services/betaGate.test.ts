import { isBetaGateEnabled, isValidBetaCode } from "./betaGate";

describe("betaGate", () => {
  const original = process.env.BETA_INVITE_CODES;
  afterEach(() => {
    if (original === undefined) delete process.env.BETA_INVITE_CODES;
    else process.env.BETA_INVITE_CODES = original;
  });

  it("is off when no codes are configured", () => {
    delete process.env.BETA_INVITE_CODES;
    expect(isBetaGateEnabled()).toBe(false);
    process.env.BETA_INVITE_CODES = " , ";
    expect(isBetaGateEnabled()).toBe(false);
  });

  it("accepts any configured code, ignoring case and whitespace", () => {
    process.env.BETA_INVITE_CODES = "alpha-1, Beta-Two";
    expect(isBetaGateEnabled()).toBe(true);
    expect(isValidBetaCode("ALPHA-1")).toBe(true);
    expect(isValidBetaCode("  beta-two ")).toBe(true);
  });

  it("rejects wrong, empty and non-string codes", () => {
    process.env.BETA_INVITE_CODES = "alpha-1";
    expect(isValidBetaCode("alpha-2")).toBe(false);
    expect(isValidBetaCode("")).toBe(false);
    expect(isValidBetaCode(undefined)).toBe(false);
    expect(isValidBetaCode(123)).toBe(false);
  });
});
