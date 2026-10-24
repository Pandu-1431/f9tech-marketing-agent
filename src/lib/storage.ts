import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/*
 * File storage for logos, posters, videos and audio.
 * STORAGE_DRIVER=local (default): files in ./.data/uploads, served at /media/<key>.
 * STORAGE_DRIVER=s3: any S3-compatible bucket — Cloudflare R2 (10 GB free) in production.
 * Keys are random and unguessable, because social platforms must be able to fetch
 * a published image by URL.
 */

const localRoot = () => process.env.STORAGE_LOCAL_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "uploads");

let s3: S3Client | null = null;
function s3Client() {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT, // R2: https://<account-id>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return s3;
}

const isS3 = () => process.env.STORAGE_DRIVER === "s3";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export function newKey(workspaceId: number, kind: string, mime: string): string {
  const ext = EXT[mime] ?? "bin";
  return `ws${workspaceId}/${kind}/${crypto.randomUUID()}.${ext}`;
}

function safeLocalPath(key: string): string {
  if (!/^[\w./-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return path.join(/*turbopackIgnore: true*/ localRoot(), key);
}

export async function putFile(key: string, body: Buffer, mime: string): Promise<void> {
  if (isS3()) {
    await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: mime }));
    return;
  }
  const file = safeLocalPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function getFile(key: string): Promise<Buffer | null> {
  try {
    if (isS3()) {
      const res = await s3Client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    }
    return await fs.readFile(safeLocalPath(key));
  } catch {
    return null;
  }
}

/** Public URL for a stored file. */
export function publicUrl(key: string): string {
  if (isS3() && process.env.S3_PUBLIC_URL) return `${process.env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  return `/media/${key}`;
}

export function mimeFromKey(key: string): string {
  const ext = key.split(".").pop() ?? "";
  return Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
}
