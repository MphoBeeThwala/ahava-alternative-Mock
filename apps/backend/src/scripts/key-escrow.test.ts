import crypto from "crypto";
import { combineShares, keyFingerprint, splitKey } from "./key-escrow";

describe("split-custody key escrow", () => {
  const key = crypto.randomBytes(32);
  const keyB64 = key.toString("base64");

  it("rebuilds the exact key from both shares, with a matching fingerprint", () => {
    const { share1, share2, fingerprint } = splitKey(keyB64);
    const rebuilt = combineShares(share1, share2);
    expect(rebuilt.keyB64).toBe(keyB64);
    expect(rebuilt.fingerprint).toBe(fingerprint);
    expect(fingerprint).toBe(keyFingerprint(key));
  });

  it("gives different, key-free shares every time", () => {
    const first = splitKey(keyB64);
    const second = splitKey(keyB64);
    expect(first.share1).not.toBe(second.share1);
    for (const share of [first.share1, first.share2]) expect(share).not.toContain(keyB64);
  });

  it("rejects swapped, foreign or damaged shares", () => {
    const { share1, share2 } = splitKey(keyB64);
    expect(() => combineShares(share2, share1)).toThrow(/Expected share 1/);
    expect(() => combineShares("not-a-share", share2)).toThrow(/not an Ahava key share/);
    expect(() => combineShares(share1.slice(0, -8), share2)).toThrow(/damaged/);
  });

  it("refuses a key that isn't 32 bytes", () => {
    expect(() => splitKey(Buffer.alloc(16).toString("base64"))).toThrow(/32-byte/);
  });
});
