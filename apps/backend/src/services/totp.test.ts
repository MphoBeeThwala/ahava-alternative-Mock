/**
 * AH-29: opt-in 2FA. These pin the parts of the flow that don't need a
 * database — secret generation/verification and backup-code handling.
 */
import { authenticator } from "otplib";
import {
  generateTotpSecret,
  getTotpProvisioningUri,
  verifyTotpCode,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from "./totp";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

// hashBackupCodes/consumeBackupCode run up to 10 sequential bcrypt calls,
// which are deliberately slow and contend with other test files' CPU use —
// the default 5s Jest timeout is too tight for this file specifically.
jest.setTimeout(20000);

describe("totp", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  describe("secret generation and verification", () => {
    it("generates a distinct secret each time", () => {
      const a = generateTotpSecret();
      const b = generateTotpSecret();
      expect(a).not.toEqual(b);
      expect(a.length).toBeGreaterThan(0);
    });

    it("verifies a code generated from the same secret", () => {
      const secret = generateTotpSecret();
      const code = authenticator.generate(secret);
      expect(verifyTotpCode(secret, code)).toBe(true);
    });

    it("rejects a code generated from a different secret", () => {
      const secret = generateTotpSecret();
      const wrongCode = authenticator.generate(generateTotpSecret());
      expect(verifyTotpCode(secret, wrongCode)).toBe(false);
    });

    it("rejects malformed input rather than throwing", () => {
      const secret = generateTotpSecret();
      expect(verifyTotpCode(secret, "not-a-code")).toBe(false);
      expect(verifyTotpCode(secret, "12345")).toBe(false); // too short
      expect(verifyTotpCode(secret, "1234567")).toBe(false); // too long
    });

    it("builds an otpauth:// URI naming Ahava Healthcare and the account", () => {
      const secret = generateTotpSecret();
      const uri = getTotpProvisioningUri(secret, "doctor@example.com");
      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain(encodeURIComponent("Ahava Healthcare"));
      expect(uri).toContain(encodeURIComponent("doctor@example.com"));
    });
  });

  describe("secret encryption at rest", () => {
    it("round-trips through encryptTotpSecret/decryptTotpSecret", () => {
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(secret, "user-1");
      expect(encrypted).not.toEqual(secret);
      expect(decryptTotpSecret(encrypted, "user-1")).toEqual(secret);
    });

    // AH-13: the AAD binds a secret to the account it was encrypted for, so
    // a row copied/mismatched to a different user fails closed instead of
    // silently decrypting into a working authenticator secret for them.
    it("refuses to decrypt with a different user's id", () => {
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(secret, "user-1");
      expect(() => decryptTotpSecret(encrypted, "user-2")).toThrow();
    });
  });

  describe("backup codes", () => {
    it("generates ten codes in the XXXXX-XXXXX format", () => {
      const codes = generateBackupCodes();
      expect(codes).toHaveLength(10);
      codes.forEach((code) => expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/));
    });

    it("generates codes that are all distinct", () => {
      const codes = generateBackupCodes();
      expect(new Set(codes).size).toBe(codes.length);
    });

    it("matches a submitted code against its hash and removes it (single use)", async () => {
      const codes = generateBackupCodes();
      const hashed = await hashBackupCodes(codes);

      const result = await consumeBackupCode(codes[3], hashed);

      expect(result.matched).toBe(true);
      expect(result.remaining).toHaveLength(hashed.length - 1);
      expect(result.remaining).not.toContain(hashed[3]);
    });

    it("is case-insensitive on the submitted code", async () => {
      const codes = generateBackupCodes();
      const hashed = await hashBackupCodes(codes);

      const result = await consumeBackupCode(codes[0].toLowerCase(), hashed);

      expect(result.matched).toBe(true);
    });

    it("does not match a code that isn't in the list", async () => {
      // A non-matching submission runs bcrypt.compare against every stored
      // hash before concluding there's no match — the slowest case in this
      // file, covered by the module-level jest.setTimeout above.
      const codes = generateBackupCodes();
      const hashed = await hashBackupCodes(codes);

      const result = await consumeBackupCode("00000-00000", hashed);

      expect(result.matched).toBe(false);
      expect(result.remaining).toEqual(hashed);
    });
  });
});
