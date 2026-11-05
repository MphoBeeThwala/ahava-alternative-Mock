import { webhookSignaturesRequired } from "./webhookPolicy";

describe("webhookSignaturesRequired", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it("requires signatures in production even if a flag says false", () => {
    process.env.NODE_ENV = "production";
    process.env.WEBHOOK_SIGNATURE_REQUIRED = "false";
    expect(webhookSignaturesRequired("false")).toBe(true);
  });

  it("requires signatures when NODE_ENV is unset or unrecognised (staging, typos)", () => {
    delete process.env.NODE_ENV;
    expect(webhookSignaturesRequired("false")).toBe(true);
    process.env.NODE_ENV = "staging";
    expect(webhookSignaturesRequired("false")).toBe(true);
  });

  it("allows an explicit opt-out only in development or test", () => {
    process.env.NODE_ENV = "development";
    expect(webhookSignaturesRequired("false")).toBe(false);
    process.env.NODE_ENV = "test";
    expect(webhookSignaturesRequired("false")).toBe(false);
  });
});
