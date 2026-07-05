import "server-only";
import crypto from "crypto";

// AES-256-GCM for platform_credentials.credentials (see SCHEMA.md — that
// column must only ever hold encrypted data). Server-only: this touches
// CREDENTIALS_ENCRYPTION_KEY and must never reach a client bundle.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set.");
  }
  // Accept either a 64-char hex string or a base64 string — either way it
  // must decode to exactly 32 bytes for AES-256.
  const buf = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (AES-256).");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((buf) => buf.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
