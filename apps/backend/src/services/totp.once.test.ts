const updateMany = jest.fn();
jest.mock("../lib/prisma", () => ({ __esModule: true, default: { user: { updateMany: (...a: unknown[]) => updateMany(...a) } } }));
jest.mock("@node-rs/bcrypt", () => ({}));
jest.mock("../utils/encryption", () => ({ encryptData: jest.fn(), decryptData: jest.fn() }));

import { authenticator } from "otplib";
import { verifyTotpCodeOnce } from "./totp";

describe("verifyTotpCodeOnce", () => {
  const secret = authenticator.generateSecret();
  beforeEach(() => updateMany.mockReset());

  it("accepts a valid code once and records its time step", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await verifyTotpCodeOnce("u1", secret, authenticator.generate(secret))).toBe(true);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where.id).toBe("u1");
    expect(arg.where.OR).toEqual([{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: arg.data.totpLastUsedStep } }]);
  });

  it("rejects a replay of the same code (step already used)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await verifyTotpCodeOnce("u1", secret, authenticator.generate(secret))).toBe(false);
  });

  it("rejects a wrong code without touching the database", async () => {
    expect(await verifyTotpCodeOnce("u1", secret, "000000")).toBe(false);
    expect(await verifyTotpCodeOnce("u1", secret, "abc")).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
