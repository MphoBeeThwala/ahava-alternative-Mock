/**
 * AH-13: PHI encryption gained AAD binding and a key-rotation path. These
 * tests pin both, plus the v2/legacy backward-compat decrypt paths — this
 * util still has to read data written before this change.
 */
import crypto from "crypto";
import { encryptData, decryptData, isEncryptedPayload } from "./encryption";

function testKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

describe("encryption", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("v3 (current format)", () => {
    it("round-trips plaintext with no AAD", () => {
      process.env.ENCRYPTION_KEY = testKey();
      const encrypted = encryptData("hello");
      expect(encrypted.startsWith("v3:")).toBe(true);
      expect(decryptData(encrypted)).toBe("hello");
    });

    it("round-trips plaintext with matching AAD", () => {
      process.env.ENCRYPTION_KEY = testKey();
      const aad = "user:abc123:totpSecret";
      const encrypted = encryptData("secret-value", aad);
      expect(decryptData(encrypted, aad)).toBe("secret-value");
    });

    it("fails to decrypt with the wrong AAD", () => {
      process.env.ENCRYPTION_KEY = testKey();
      const encrypted = encryptData("secret-value", "user:abc123:totpSecret");
      expect(() => decryptData(encrypted, "user:other-user:totpSecret")).toThrow();
    });

    it("fails to decrypt with no AAD when one was used to encrypt", () => {
      process.env.ENCRYPTION_KEY = testKey();
      const encrypted = encryptData("secret-value", "user:abc123:totpSecret");
      expect(() => decryptData(encrypted)).toThrow();
    });

    it("recognizes its own output as an encrypted payload", () => {
      process.env.ENCRYPTION_KEY = testKey();
      expect(isEncryptedPayload(encryptData("x"))).toBe(true);
      expect(isEncryptedPayload("plain text")).toBe(false);
    });
  });

  describe("key rotation", () => {
    it("tags new writes with ENCRYPTION_KEY_ID and can still read them back", () => {
      process.env.ENCRYPTION_KEY = testKey();
      process.env.ENCRYPTION_KEY_ID = "2026-09";
      const encrypted = encryptData("value");
      expect(encrypted.split(":")[1]).toBe("2026-09");
      expect(decryptData(encrypted)).toBe("value");
    });

    it("still decrypts data from a retired key once it's set as PREVIOUS", () => {
      const oldKey = testKey();
      process.env.ENCRYPTION_KEY = oldKey;
      process.env.ENCRYPTION_KEY_ID = "2026-01";
      const encryptedUnderOldKey = encryptData("legacy-value");

      // Rotate: a new current key/id, the old one demoted to PREVIOUS.
      process.env.ENCRYPTION_KEY = testKey();
      process.env.ENCRYPTION_KEY_ID = "2026-09";
      process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = "2026-01";

      expect(decryptData(encryptedUnderOldKey)).toBe("legacy-value");

      // And new writes use the new key/id.
      const encryptedUnderNewKey = encryptData("fresh-value");
      expect(encryptedUnderNewKey.split(":")[1]).toBe("2026-09");
    });

    it("throws a clear error for an unknown key id (rotated out without a PREVIOUS slot)", () => {
      process.env.ENCRYPTION_KEY = testKey();
      process.env.ENCRYPTION_KEY_ID = "2026-01";
      const encrypted = encryptData("value");

      process.env.ENCRYPTION_KEY = testKey();
      process.env.ENCRYPTION_KEY_ID = "2026-09";
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;

      expect(() => decryptData(encrypted)).toThrow(/no encryption key configured/i);
    });
  });

  describe("backward compatibility with data written before AH-13", () => {
    it("still decrypts the v2 format (no AAD, single key)", () => {
      const key = testKey();
      process.env.ENCRYPTION_KEY = key;

      // Hand-construct a v2 payload the way the old encryptData did.
      const algorithm = "aes-256-gcm";
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, "base64"), iv);
      const encrypted = Buffer.concat([cipher.update("old-value", "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const v2Payload = ["v2", iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");

      expect(isEncryptedPayload(v2Payload)).toBe(true);
      expect(decryptData(v2Payload)).toBe("old-value");
    });
  });
});
