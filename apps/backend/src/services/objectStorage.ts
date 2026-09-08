/**
 * AH-33: S3-compatible object storage for triage attachments (symptom
 * photos, lab results, follow-up files), which today are embedded as
 * base64 inside the TriageCase.imageStorageRef JSON column — a real
 * operational cost (row bloat, slower reads/backups of an unrelated
 * table) independent of request-thread CPU.
 *
 * Deliberately provider-neutral: works against AWS S3 or any S3-compatible
 * service (Cloudflare R2, Backblaze B2, DigitalOcean Spaces) via
 * S3_ENDPOINT. Configuration is optional — when it's absent,
 * isObjectStorageConfigured() returns false and callers fall back to the
 * existing embed-in-Postgres behaviour, so this doesn't force object
 * storage to be provisioned before the app runs.
 *
 * Objects are never made public and no presigned URLs are issued. Every
 * read goes through the authenticated attachment-serving route
 * (routes/triageCaseReview.ts), which fetches the bytes server-side via
 * getObjectBuffer and streams them to the client — the same access-control
 * check that already gates the embedded-dataUrl path today.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

let client: S3Client | null = null;
let clientInitAttempted = false;

function getBucket(): string | undefined {
  return process.env.S3_BUCKET;
}

function getClient(): S3Client | null {
  if (clientInitAttempted) return client;
  clientInitAttempted = true;

  const bucket = getBucket();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  client = new S3Client({
    region: process.env.S3_REGION || "auto",
    // Unset for real AWS S3; set for R2/B2/Spaces/etc.
    endpoint: process.env.S3_ENDPOINT || undefined,
    // R2 and some other S3-compatible providers need path-style addressing.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export function isObjectStorageConfigured(): boolean {
  return getClient() !== null;
}

export async function uploadObject(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const s3 = getClient();
  const bucket = getBucket();
  if (!s3 || !bucket) {
    throw new Error("Object storage is not configured");
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

export async function getObjectBuffer(
  key: string,
): Promise<{ buffer: Buffer; contentType?: string }> {
  const s3 = getClient();
  const bucket = getBucket();
  if (!s3 || !bucket) {
    throw new Error("Object storage is not configured");
  }
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!result.Body) {
    throw new Error(`Object storage returned no body for key ${key}`);
  }
  const bytes = await result.Body.transformToByteArray();
  return { buffer: Buffer.from(bytes), contentType: result.ContentType };
}

export async function deleteObject(key: string): Promise<void> {
  const s3 = getClient();
  const bucket = getBucket();
  if (!s3 || !bucket) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.warn(`[objectStorage] Failed to delete ${key}:`, (err as Error).message);
  }
}
