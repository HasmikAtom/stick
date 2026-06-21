// auth-service/src/plex/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.PLEX_TOKEN_ENC_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("PLEX_TOKEN_ENC_KEY must be 64 hex chars (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

// Format: base64(iv).base64(authTag).base64(ciphertext)
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(blob: string): string {
  const [ivB, tagB, ctB] = blob.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
