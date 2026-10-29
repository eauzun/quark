/**
 * crypto.ts — Cryptographic utilities powered by BLAKE3.
 *
 * Used for:
 * - Off-chain authentication tokens & session hashes
 * - Scope version immutable content hashing
 * - Submission artifacts & evidence manifest hashing
 * - Deterministic idempotency & authorization keys
 */

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Computes standard 256-bit BLAKE3 hash as lowercase hex string.
 */
export const blake3Hex = (input: string | Uint8Array): string => {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  const digest = blake3(bytes);
  return bytesToHex(digest);
};

/**
 * Computes raw 32-byte BLAKE3 hash.
 */
export const blake3Bytes = (input: string | Uint8Array): Uint8Array => {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  return blake3(bytes);
};

/**
 * Keyed BLAKE3 hash (high-performance, secure MAC / keyed PRF).
 * Key must be exactly 32 bytes.
 */
export const blake3Keyed = (
  key: Uint8Array,
  input: string | Uint8Array
): string => {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  const digest = blake3(bytes, { key });
  return bytesToHex(digest);
};

/**
 * Derives a cryptographic key using BLAKE3 Key Derivation Function (KDF).
 * Context string ensures key separation across different domains.
 */
export const blake3DeriveKey = (
  context: string,
  keyMaterial: string | Uint8Array
): string => {
  const materialBytes =
    typeof keyMaterial === "string" ? utf8ToBytes(keyMaterial) : keyMaterial;
  const digest = blake3(materialBytes, { context });
  return bytesToHex(digest);
};

/**
 * Hashes off-chain authentication tokens or API keys before database storage.
 * Invariant: Plaintext tokens are never stored in the database.
 */
export const hashOffChainAuthToken = (plainToken: string): string => {
  return blake3Hex(`quark_auth_v1:${plainToken}`);
};

/**
 * Canonical JSON serializer for deterministic hashing of scopes and metadata.
 * Ensures consistent key sorting across different environments.
 */
export const canonicalJsonStringify = (data: unknown): string => {
  if (data === null || typeof data !== "object") {
    return JSON.stringify(data);
  }

  if (Array.isArray(data)) {
    return `[${data.map(canonicalJsonStringify).join(",")}]`;
  }

  const sortedKeys = Object.keys(data as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalJsonStringify(
        (data as Record<string, unknown>)[k]
      )}`
  );
  return `{${pairs.join(",")}}`;
};

/**
 * Computes immutable BLAKE3 content hash for scope versions.
 */
export const hashScopeContent = (content: Record<string, unknown>): string => {
  const canonical = canonicalJsonStringify(content);
  return blake3Hex(`quark_scope_v1:${canonical}`);
};
