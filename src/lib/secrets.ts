import crypto from "node:crypto";

/*
 * Encrypts channel tokens (Telegram bot token, Facebook page token...) before they are stored.
 * Key: CHANNEL_SECRET, else SESSION_SECRET (each must be 32+ characters in production).
 */
/** The encryption key for a secret string (the dev key when it is shorter than 32 characters). */
export function keyFrom(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret.length < 32 ? "dev-only-channel-secret-change-me" : secret).digest();
}

function key(): Buffer {
  const secret = process.env.CHANNEL_SECRET || process.env.SESSION_SECRET || "";
  if (secret.length < 32 && process.env.NODE_ENV === "production") throw new Error("Set CHANNEL_SECRET (32+ characters) to store channel tokens");
  return keyFrom(secret);
}

export function encryptSecret(plain: string, k: Buffer = key()): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string, k: Buffer = key()): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** "123456:ABC...xyz" -> "1234…xyz" for display. */
export function maskSecret(s: string): string {
  return s.length <= 8 ? "••••" : `${s.slice(0, 4)}…${s.slice(-3)}`;
}
