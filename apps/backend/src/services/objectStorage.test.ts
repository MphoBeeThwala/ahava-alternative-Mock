/**
 * AH-33: no S3_* env vars are set in this test environment, so these
 * exercise the real "not configured" path rather than a mock standing in
 * for one — consistent with how this codebase tests every other
 * optional-external-service integration (see rateLimiter.test.ts,
 * websocket.test.ts). The actual S3/R2 upload-download round trip needs a
 * real bucket to verify and isn't covered here.
 */
import { isObjectStorageConfigured, uploadObject, getObjectBuffer } from "./objectStorage";

describe("objectStorage", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports not configured when no S3 env vars are set", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    expect(isObjectStorageConfigured()).toBe(false);
  });

  it("throws a clear error rather than a raw SDK failure when uploading unconfigured", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    await expect(uploadObject("some-key", Buffer.from("x"), "image/jpeg")).rejects.toThrow(
      /not configured/i,
    );
  });

  it("throws a clear error rather than a raw SDK failure when reading unconfigured", async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    await expect(getObjectBuffer("some-key")).rejects.toThrow(/not configured/i);
  });
});
