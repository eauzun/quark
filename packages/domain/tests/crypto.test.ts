import { describe, it, expect } from "vitest";
import {
  blake3Hex,
  blake3Bytes,
  blake3Keyed,
  blake3DeriveKey,
  hashOffChainAuthToken,
  canonicalJsonStringify,
  hashScopeContent,
} from "../src/shared/crypto.js";

describe("BLAKE3 Cryptography (ADR-005)", () => {
  it("produces standard 64-character (256-bit) lowercase hex digests", () => {
    const hash = blake3Hex("Hello Quark with BLAKE3");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces 32-byte raw Uint8Array digest", () => {
    const bytes = blake3Bytes("Hello Quark");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  it("guarantees deterministic canonical JSON hashing regardless of object key order", () => {
    const objA = {
      title: "Fix re-entrancy bug",
      budget: 150,
      skills: ["solidity", "foundry"],
      nested: { zebra: 1, alpha: 2 },
    };

    const objB = {
      nested: { alpha: 2, zebra: 1 },
      skills: ["solidity", "foundry"],
      budget: 150,
      title: "Fix re-entrancy bug",
    };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);
    expect(strA).toBe(strB);

    const hashA = hashScopeContent(objA);
    const hashB = hashScopeContent(objB);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("safely hashes off-chain auth tokens with domain separation", () => {
    const token = "quark_pat_secret_123456789";
    const hashed = hashOffChainAuthToken(token);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    // Invariant: hash is not equal to raw token
    expect(hashed).not.toContain(token);
    // Invariant: deterministic
    expect(hashOffChainAuthToken(token)).toBe(hashed);
  });

  it("supports keyed hashing with 32-byte secret key", () => {
    const key = new Uint8Array(32).fill(7);
    const mac1 = blake3Keyed(key, "sensitive payload");
    const mac2 = blake3Keyed(key, "sensitive payload");
    expect(mac1).toBe(mac2);

    const differentKey = new Uint8Array(32).fill(8);
    const mac3 = blake3Keyed(differentKey, "sensitive payload");
    expect(mac1).not.toBe(mac3);
  });

  it("supports key derivation function (KDF)", () => {
    const derivedKey = blake3DeriveKey(
      "Quark Session Token v1",
      "user_master_seed_99"
    );
    expect(derivedKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
