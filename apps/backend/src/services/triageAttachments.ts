import { randomUUID } from "crypto";
import { sanitizeDataUrlImage } from "../utils/imageUtils";
import {
  isObjectStorageConfigured,
  uploadObject,
  getObjectBuffer,
} from "./objectStorage";

export type TriageAttachmentKind =
  | "symptom_image"
  | "lab_result"
  | "follow_up_file";

export interface StoredTriageAttachment {
  id: string;
  kind: TriageAttachmentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  // AH-33: exactly one of these is set. storageKey when object storage is
  // configured — the bytes live in S3/R2/etc, this just names the object.
  // dataUrl is the pre-AH-33 format (bytes embedded in this JSON manifest)
  // and remains the fallback when object storage isn't configured, and the
  // format existing rows were already written in.
  storageKey?: string;
  dataUrl?: string;
}

interface ParsedDataUrl {
  mimeType: string;
  buffer: Buffer;
}

export interface TriageAttachmentManifest {
  version: 1;
  attachments: StoredTriageAttachment[];
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_LAB_ATTACHMENTS = 3;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_LAB_TYPES = new Set([
  ...ALLOWED_IMAGE_TYPES,
  "application/pdf",
]);

function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Invalid attachment format");
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

function sanitizeFileName(fileName: string, fallbackBase: string, ext: string) {
  const cleaned = fileName
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return `${fallbackBase}.${ext}`;
  }

  if (cleaned.toLowerCase().endsWith(`.${ext}`)) {
    return cleaned;
  }

  return `${cleaned}.${ext}`;
}

function normalizeManifestAttachment(
  attachment: any,
): StoredTriageAttachment | null {
  const hasStorageKey = typeof attachment?.storageKey === "string" && attachment.storageKey.length > 0;
  const hasDataUrl = typeof attachment?.dataUrl === "string" && attachment.dataUrl.length > 0;

  if (
    !attachment ||
    typeof attachment.id !== "string" ||
    typeof attachment.kind !== "string" ||
    typeof attachment.fileName !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.byteSize !== "number" ||
    typeof attachment.createdAt !== "string" ||
    !(hasStorageKey || hasDataUrl)
  ) {
    return null;
  }

  if (
    attachment.kind !== "symptom_image" &&
    attachment.kind !== "lab_result" &&
    attachment.kind !== "follow_up_file"
  ) {
    return null;
  }

  return attachment as StoredTriageAttachment;
}

export function parseTriageAttachmentManifest(
  rawValue?: string | null,
): TriageAttachmentManifest {
  if (!rawValue) {
    return { version: 1, attachments: [] };
  }

  try {
    const parsed = JSON.parse(rawValue);
    const attachments = Array.isArray(parsed?.attachments)
      ? parsed.attachments
          .map(normalizeManifestAttachment)
          .filter(
            (item: StoredTriageAttachment | null): item is StoredTriageAttachment =>
              Boolean(item),
          )
      : [];

    return { version: 1, attachments };
  } catch {
    return { version: 1, attachments: [] };
  }
}

export function serializeTriageAttachmentManifest(
  manifest: TriageAttachmentManifest,
) {
  return JSON.stringify(manifest);
}

export function assertLabAttachmentCount(count: number) {
  if (count > MAX_LAB_ATTACHMENTS) {
    throw new Error(`You can upload up to ${MAX_LAB_ATTACHMENTS} lab results per submission`);
  }
}

export async function persistTriageAttachment(params: {
  kind: TriageAttachmentKind;
  dataUrl: string;
  fileName: string;
}): Promise<StoredTriageAttachment> {
  const allowedTypes =
    params.kind === "symptom_image" ? ALLOWED_IMAGE_TYPES : ALLOWED_LAB_TYPES;

  let dataUrlToStore = params.dataUrl;
  if (params.kind === "symptom_image" || params.dataUrl.startsWith("data:image/")) {
    const cleaned = await sanitizeDataUrlImage(params.dataUrl);
    if (!cleaned) {
      throw new Error("Attachment could not be processed safely");
    }
    dataUrlToStore = cleaned;
  }

  const { mimeType, buffer } = parseDataUrl(dataUrlToStore);
  if (!allowedTypes.has(mimeType)) {
    throw new Error("Unsupported attachment type");
  }
  if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 5MB size limit");
  }

  const ext = extensionForMimeType(mimeType);
  const id = randomUUID();
  const base = {
    id,
    kind: params.kind,
    fileName: sanitizeFileName(params.fileName, params.kind, ext),
    mimeType,
    byteSize: buffer.length,
    createdAt: new Date().toISOString(),
  };

  // AH-33: once sanitized (EXIF/GPS already stripped above for images), the
  // final bytes go to object storage when configured, rather than being
  // embedded in the TriageCase row — every existing consumer of this
  // manifest goes through materializeTriageAttachment, so nothing else
  // needs to know which backend a given attachment used.
  if (isObjectStorageConfigured()) {
    const storageKey = `triage-attachments/${id}.${ext}`;
    await uploadObject(storageKey, buffer, mimeType);
    return { ...base, storageKey };
  }

  return { ...base, dataUrl: dataUrlToStore };
}

export function buildTriageAttachmentUrl(caseId: string, attachmentId: string) {
  return `/api/triage-review/${caseId}/attachments/${attachmentId}`;
}

/**
 * Resolves an attachment's actual bytes, regardless of which backend it
 * was stored with (see StoredTriageAttachment). Async because the object
 * storage path fetches from S3; the legacy embedded-dataUrl path resolves
 * synchronously but still returns a Promise for a single call-site shape.
 */
export async function materializeTriageAttachment(
  attachment: StoredTriageAttachment,
): Promise<ParsedDataUrl> {
  if (attachment.storageKey) {
    const { buffer, contentType } = await getObjectBuffer(attachment.storageKey);
    return { mimeType: contentType || attachment.mimeType, buffer };
  }
  if (attachment.dataUrl) {
    return parseDataUrl(attachment.dataUrl);
  }
  throw new Error(`Attachment ${attachment.id} has neither storageKey nor dataUrl`);
}
