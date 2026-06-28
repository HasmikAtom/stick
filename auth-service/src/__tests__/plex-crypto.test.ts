// auth-service/src/__tests__/plex-crypto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PLEX_TOKEN_ENC_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars

const { encrypt, decrypt } = await import("../plex/crypto.js");

test("encrypt/decrypt round-trips", () => {
  const secret = "plex-token-xyz";
  const blob = encrypt(secret);
  assert.notEqual(blob, secret);
  assert.equal(decrypt(blob), secret);
});

test("decrypt rejects tampered ciphertext", () => {
  const blob = encrypt("abc");
  const parts = blob.split(".");
  parts[2] = Buffer.from("zzzz").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
