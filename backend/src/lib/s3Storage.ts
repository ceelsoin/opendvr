import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { getNotificationSettings } from "../notifications/notificationSettings.js";
import { logger } from "../lib/logger.js";

/**
 * Optional S3-compatible object storage for event snapshots, so
 * Discord/Telegram/generic-webhook notifications can reference a public
 * image URL instead of (or in addition to) a raw multipart file upload -
 * some webhook setups only reliably display an image when it's a URL. See
 * events/cameraEvents.ts for how this is used, and jobs/retentionCleanup.ts
 * for how uploaded snapshots get cleaned up per-camera.
 *
 * Works with AWS S3 itself or any S3-compatible provider (Linode Object
 * Storage, DigitalOcean Spaces, MinIO, ...) via a custom `endpoint` +
 * path-style addressing.
 */
const PREFIX = "camsnapshots";

interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function getS3Config(): S3Config | null {
  const settings = getNotificationSettings();
  if (!settings.s3Endpoint || !settings.s3AccessKey || !settings.s3SecretKey || !settings.s3BucketName) {
    return null;
  }
  return {
    endpoint: settings.s3Endpoint,
    region: settings.s3Region ?? "us-east-1",
    accessKeyId: settings.s3AccessKey,
    secretAccessKey: settings.s3SecretKey,
    bucket: settings.s3BucketName,
  };
}

export function isS3Configured(): boolean {
  return getS3Config() !== null;
}

let cachedClient: { client: S3Client; endpoint: string } | null = null;

function getClient(config: S3Config): S3Client {
  // Recreate the client if the endpoint/credentials changed since the last
  // call (e.g. the user just updated them from the Settings page) - cheap
  // to recreate, and avoids holding on to stale credentials indefinitely.
  if (cachedClient && cachedClient.endpoint === config.endpoint) {
    return cachedClient.client;
  }
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  cachedClient = { client, endpoint: config.endpoint };
  return client;
}

function publicUrl(config: S3Config, key: string): string {
  const endpoint = config.endpoint.replace(/\/+$/, "");
  return `${endpoint}/${config.bucket}/${key}`;
}

/**
 * Compresses a JPEG snapshot (resize down a bit + re-encode as WebP,
 * quality 80 - same approach as most snapshot/thumbnail pipelines) and
 * uploads it to `camsnapshots/<cameraId>/<timestamp>-<random>.webp`, ACL
 * public-read. Returns the public URL, or null (never throws) if S3 isn't
 * configured or the upload fails - callers should treat this exactly like
 * a failed snapshot capture (best-effort, non-blocking).
 */
export async function uploadSnapshotToS3(cameraId: string, buffer: Buffer): Promise<string | null> {
  const config = getS3Config();
  if (!config) return null;

  try {
    const metadata = await sharp(buffer).metadata();
    const compressed = await sharp(buffer)
      .resize({
        width: metadata.width ? Math.round(metadata.width * 0.75) : undefined,
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    const key = `${PREFIX}/${cameraId}/${Date.now()}-${randomUUID()}.webp`;
    await getClient(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: compressed,
        ContentType: "image/webp",
        ACL: "public-read",
      })
    );
    return publicUrl(config, key);
  } catch (err) {
    logger.warn({ err, cameraId }, "Failed to upload event snapshot to S3");
    return null;
  }
}

/**
 * Deletes snapshots older than `retentionDays` for a camera - mirrors the
 * local-disk snapshot retention in jobs/retentionCleanup.ts, since S3
 * lifecycle rules aren't something this app can configure on arbitrary
 * S3-compatible providers (they all differ, some don't support them at
 * all), so cleanup is done directly instead.
 */
export async function deleteExpiredS3Snapshots(cameraId: string, retentionDays: number): Promise<void> {
  const config = getS3Config();
  if (!config) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const client = getClient(config);
  const prefix = `${PREFIX}/${cameraId}/`;

  try {
    let continuationToken: string | undefined;
    const staleKeys: string[] = [];
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: continuationToken })
      );
      for (const obj of page.Contents ?? []) {
        if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) {
          staleKeys.push(obj.Key);
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    if (staleKeys.length === 0) return;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: staleKeys.map((Key) => ({ Key })) },
      })
    );
    logger.info({ cameraId, deleted: staleKeys.length }, "Deleted expired S3 snapshots (retention policy)");
  } catch (err) {
    logger.warn({ err, cameraId }, "Failed to clean up expired S3 snapshots");
  }
}
