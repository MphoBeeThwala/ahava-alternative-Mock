/**
 * Data key from AWS KMS (lib/keyManagement.ts), with a fake KMS that
 * behaves like the real one: AES-GCM wrapping bound to the encryption
 * context, so a wrong context or wrong key id is refused.
 */
import crypto from "crypto";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import { KMS_ENCRYPTION_CONTEXT, loadEncryptionKeys } from "./keyManagement";
import { wrapDataKey } from "../scripts/wrap-encryption-key";
import {
  clearEncryptionKeyMaterial, decryptData, encryptData, getPseudonymKey,
} from "../utils/encryption";

const MASTER = crypto.randomBytes(32);
const KEY_ID = "alias/test-master";

function fakeKms() {
  const calls: any[] = [];
  const ctx = (c: Record<string, string> = {}) => Buffer.from(JSON.stringify(Object.entries(c).sort()));
  return {
    calls,
    async send(cmd: any) {
      calls.push(cmd);
      const input = cmd.input;
      if (input.KeyId && input.KeyId !== KEY_ID) throw new Error("IncorrectKeyException");
      if (cmd instanceof EncryptCommand) {
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv("aes-256-gcm", MASTER, iv);
        c.setAAD(ctx(input.EncryptionContext));
        const body = Buffer.concat([c.update(Buffer.from(input.Plaintext)), c.final()]);
        return { CiphertextBlob: Buffer.concat([iv, c.getAuthTag(), body]) };
      }
      if (cmd instanceof DecryptCommand) {
        const blob = Buffer.from(input.CiphertextBlob);
        const d = crypto.createDecipheriv("aes-256-gcm", MASTER, blob.subarray(0, 12));
        d.setAAD(ctx(input.EncryptionContext));
        d.setAuthTag(blob.subarray(12, 28));
        return { Plaintext: Buffer.concat([d.update(blob.subarray(28)), d.final()]) };
      }
      throw new Error("unexpected command");
    },
  };
}

const ENV_KEYS = [
  "ENCRYPTION_KEY_PROVIDER", "ENCRYPTION_KEY", "ENCRYPTION_KEY_PREVIOUS", "ENCRYPTION_KEY_ID", "ENCRYPTION_KEY_PREVIOUS_ID",
  "ENCRYPTION_KEY_CIPHERTEXT", "ENCRYPTION_KEY_PREVIOUS_CIPHERTEXT", "ENCRYPTION_KMS_KEY_ID", "PSEUDONYM_KEY", "NODE_ENV",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) if (k !== "NODE_ENV") delete process.env[k];
  clearEncryptionKeyMaterial();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearEncryptionKeyMaterial();
});

describe("data key from AWS KMS", () => {
  it("keeps existing data readable: the wrapped key is the same key", async () => {
    const kms = fakeKms();
    const existingKey = crypto.randomBytes(32).toString("base64");
    process.env.ENCRYPTION_KEY = existingKey;
    const oldCiphertext = encryptData("12 Existing Street");

    const wrapped = await wrapDataKey(kms, KEY_ID, existingKey);

    // Cut over: plaintext key removed, only the wrapped one configured.
    delete process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY_PROVIDER = "aws-kms";
    process.env.ENCRYPTION_KEY_CIPHERTEXT = wrapped;
    process.env.ENCRYPTION_KMS_KEY_ID = KEY_ID;
    await expect(loadEncryptionKeys({ kmsClient: kms })).resolves.toBe("aws-kms");

    expect(decryptData(oldCiphertext)).toBe("12 Existing Street");
    expect(decryptData(encryptData("new data"))).toBe("new data");
    expect(process.env.ENCRYPTION_KEY).toBeUndefined();
    const decrypt = kms.calls.find((c) => c instanceof DecryptCommand && c.input.CiphertextBlob);
    expect(decrypt.input.EncryptionContext).toEqual(KMS_ENCRYPTION_CONTEXT);
  });

  it("refuses to start with a plaintext key still in the environment", async () => {
    process.env.ENCRYPTION_KEY_PROVIDER = "aws-kms";
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    process.env.ENCRYPTION_KEY_CIPHERTEXT = "AAAA";
    await expect(loadEncryptionKeys({ kmsClient: fakeKms() })).rejects.toThrow(/plaintext ENCRYPTION_KEY/);
  });

  it("refuses a key wrapped by a different master key or for a different purpose", async () => {
    const kms = fakeKms();
    const wrapped = await wrapDataKey(kms, KEY_ID, crypto.randomBytes(32).toString("base64"));
    process.env.ENCRYPTION_KEY_PROVIDER = "aws-kms";
    process.env.ENCRYPTION_KEY_CIPHERTEXT = wrapped;

    process.env.ENCRYPTION_KMS_KEY_ID = "alias/some-other-key";
    await expect(loadEncryptionKeys({ kmsClient: kms })).rejects.toThrow();

    process.env.ENCRYPTION_KMS_KEY_ID = KEY_ID;
    const otherPurpose = await kms.send(new EncryptCommand({ KeyId: KEY_ID, Plaintext: crypto.randomBytes(32), EncryptionContext: { app: "other" } }));
    process.env.ENCRYPTION_KEY_CIPHERTEXT = Buffer.from(otherPurpose.CiphertextBlob as Buffer).toString("base64");
    await expect(loadEncryptionKeys({ kmsClient: kms })).rejects.toThrow();
  });

  it("unwraps the previous key too, so data from before a rotation stays readable", async () => {
    const kms = fakeKms();
    const oldKey = crypto.randomBytes(32).toString("base64");
    process.env.ENCRYPTION_KEY = oldKey;
    process.env.ENCRYPTION_KEY_ID = "k1";
    const oldCiphertext = encryptData("before rotation");
    delete process.env.ENCRYPTION_KEY;

    process.env.ENCRYPTION_KEY_PROVIDER = "aws-kms";
    process.env.ENCRYPTION_KMS_KEY_ID = KEY_ID;
    process.env.ENCRYPTION_KEY_ID = "k2";
    process.env.ENCRYPTION_KEY_PREVIOUS_ID = "k1";
    process.env.ENCRYPTION_KEY_CIPHERTEXT = await wrapDataKey(kms, KEY_ID, crypto.randomBytes(32).toString("base64"));
    process.env.ENCRYPTION_KEY_PREVIOUS_CIPHERTEXT = await wrapDataKey(kms, KEY_ID, oldKey);
    await loadEncryptionKeys({ kmsClient: kms });

    expect(decryptData(oldCiphertext)).toBe("before rotation");
    expect(encryptData("after").split(":")[1]).toBe("k2");
  });

  it("still uses the plaintext variable when the provider is env (local development)", async () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    await expect(loadEncryptionKeys()).resolves.toBe("env");
    expect(decryptData(encryptData("x"))).toBe("x");
  });

  it("derives the analytics pseudonym key from the data key when none is set", async () => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const a = getPseudonymKey();
    expect(a.length).toBe(32);
    expect(getPseudonymKey().equals(a)).toBe(true);
  });
});
