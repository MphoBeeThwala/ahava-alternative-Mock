/**
 * AH-33: no S3_* env vars are set in this test environment, so
 * persistTriageAttachment always takes its real fallback path (embed as
 * dataUrl) here — the same path every deployment without object storage
 * configured takes. The S3-backed path is exercised by objectStorage.test.ts
 * for its own contract, not re-mocked here.
 */
import {
  persistTriageAttachment,
  materializeTriageAttachment,
  parseTriageAttachmentManifest,
  serializeTriageAttachmentManifest,
  assertLabAttachmentCount,
  type StoredTriageAttachment,
} from "./triageAttachments";

// A 1x1 red pixel PNG.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("triageAttachments", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("persistTriageAttachment (object storage not configured)", () => {
    it("embeds the sanitized image as a dataUrl, not a storageKey", async () => {
      const attachment = await persistTriageAttachment({
        kind: "symptom_image",
        dataUrl: TINY_PNG_DATA_URL,
        fileName: "rash.png",
      });

      expect(attachment.dataUrl).toBeDefined();
      expect(attachment.storageKey).toBeUndefined();
      expect(attachment.mimeType).toBe("image/png");
      expect(attachment.byteSize).toBeGreaterThan(0);
    });

    it("round-trips through materializeTriageAttachment", async () => {
      const attachment = await persistTriageAttachment({
        kind: "symptom_image",
        dataUrl: TINY_PNG_DATA_URL,
        fileName: "rash.png",
      });

      const { buffer, mimeType } = await materializeTriageAttachment(attachment);

      expect(mimeType).toBe("image/png");
      expect(buffer.length).toBe(attachment.byteSize);
    });

    it("rejects a lab-result attachment type outside the allowed set", async () => {
      // kind: "lab_result" and a non-image data URL both skip the
      // image-sanitization branch, so this actually reaches the allowed-type
      // check rather than failing sanitization first.
      await expect(
        persistTriageAttachment({
          kind: "lab_result",
          dataUrl: "data:text/plain;base64,aGVsbG8=",
          fileName: "notes.txt",
        }),
      ).rejects.toThrow(/unsupported/i);
    });
  });

  describe("manifest parsing — backward compatibility", () => {
    it("accepts a legacy attachment with only a dataUrl (pre-AH-33 shape)", () => {
      const legacy = {
        version: 1,
        attachments: [
          {
            id: "att-1",
            kind: "symptom_image",
            fileName: "rash.jpg",
            mimeType: "image/jpeg",
            byteSize: 123,
            createdAt: new Date().toISOString(),
            dataUrl: TINY_PNG_DATA_URL,
          },
        ],
      };

      const parsed = parseTriageAttachmentManifest(JSON.stringify(legacy));

      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].dataUrl).toBeDefined();
    });

    it("accepts an attachment with only a storageKey (AH-33 shape)", () => {
      const modern: { version: 1; attachments: StoredTriageAttachment[] } = {
        version: 1,
        attachments: [
          {
            id: "att-2",
            kind: "symptom_image",
            fileName: "rash.jpg",
            mimeType: "image/jpeg",
            byteSize: 456,
            createdAt: new Date().toISOString(),
            storageKey: "triage-attachments/att-2.jpg",
          },
        ],
      };

      const parsed = parseTriageAttachmentManifest(
        serializeTriageAttachmentManifest(modern),
      );

      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].storageKey).toBe("triage-attachments/att-2.jpg");
    });

    it("drops an attachment with neither storageKey nor dataUrl", () => {
      const broken = {
        version: 1,
        attachments: [
          {
            id: "att-3",
            kind: "symptom_image",
            fileName: "rash.jpg",
            mimeType: "image/jpeg",
            byteSize: 1,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const parsed = parseTriageAttachmentManifest(JSON.stringify(broken));

      expect(parsed.attachments).toHaveLength(0);
    });
  });

  describe("assertLabAttachmentCount", () => {
    it("allows up to the limit", () => {
      expect(() => assertLabAttachmentCount(3)).not.toThrow();
    });

    it("rejects over the limit", () => {
      expect(() => assertLabAttachmentCount(4)).toThrow();
    });
  });
});
