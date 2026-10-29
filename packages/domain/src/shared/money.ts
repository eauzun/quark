/**
 * @module shared/money
 * @description Safe integer-only money operations for Quark.
 *
 * **CRITICAL**: Every token amount in Quark is represented as a `bigint`
 * denominated in the token's smallest atomic unit (e.g. wei for ETH,
 * lamports for SOL, or the token's own `decimals` value for ERC-20s).
 *
 * Floating-point arithmetic is **never** used for money. All division
 * rounds toward zero (bigint default) which is equivalent to floor for
 * positive operands — the platform never over-pays.
 *
 * Fee model (spec §4.3):
 *   Total = DeveloperAmount + PlatformFee + Surcharge
 *   PlatformFee = DeveloperAmount × PLATFORM_FEE_RATE / FEE_DENOMINATOR
 *
 * @see Spec §4.3 — Fee structure & settlement arithmetic
 */

import { type Result, ok, domainErr } from './result.js';

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────

/**
 * Platform fee numerator.  20n / 100n = 20 %.
 * @see Spec §4.3
 */
export const PLATFORM_FEE_RATE = 20n;

/**
 * Fee denominator — together with `PLATFORM_FEE_RATE` defines the
 * fractional fee as an integer ratio.
 */
export const FEE_DENOMINATOR = 100n;

// ──────────────────────────────────────────────
//  Fee arithmetic
// ──────────────────────────────────────────────

/**
 * Calculate the platform fee for a given developer payout amount.
 *
 * ```
 * F = D × 20 / 100
 * ```
 *
 * @param developerAmount - The amount the developer will receive (atomic units).
 * @returns The platform fee in the same atomic unit.
 * @throws Never — pure bigint arithmetic.
 *
 * @see Spec §4.3 — "The platform charges a flat 20 % service fee on
 *   every milestone, computed on the developer amount."
 */
export function calculatePlatformFee(developerAmount: bigint): bigint {
  if (developerAmount < 0n) {
    // Defensive: callers should validate earlier, but never return negative fees.
    return 0n;
  }
  return (developerAmount * PLATFORM_FEE_RATE) / FEE_DENOMINATOR;
}

/**
 * Calculate the total amount the employer must fund.
 *
 * ```
 * T = D + F + E
 * ```
 *
 * where D = developer amount, F = platform fee, E = optional surcharge
 * (e.g. urgent-delivery premium, insurance, etc.).
 *
 * @param developerAmount - Developer payout (atomic units).
 * @param surcharge       - Optional additional surcharge (atomic units, default 0).
 * @returns Total funding amount.
 *
 * @see Spec §4.3
 */
export function calculateTotal(
  developerAmount: bigint,
  surcharge: bigint = 0n,
): bigint {
  const fee = calculatePlatformFee(developerAmount);
  return developerAmount + fee + surcharge;
}

/**
 * Reverse-solve the developer amount from a known total.
 *
 * Given T (total) and optional E (surcharge):
 * ```
 * D = (T − E) × 100 / 120   (integer division, rounded down)
 * ```
 *
 * This is the inverse of `calculateTotal`. Because integer division
 * truncates, `calculateTotal(solveDeveloperFromTotal(T)) <= T` always
 * holds (no over-commitment).
 *
 * @param total     - The total amount the employer wants to spend (atomic units).
 * @param surcharge - Optional surcharge already included in `total` (atomic units).
 * @returns Developer amount rounded down to the nearest atomic unit.
 *
 * @see Spec §4.3 — Inverse fee resolution
 */
export function solveDeveloperFromTotal(
  total: bigint,
  surcharge: bigint = 0n,
): bigint {
  const afterSurcharge = total - surcharge;
  if (afterSurcharge <= 0n) return 0n;
  // D = (T - E) * 100 / (100 + 20)
  return (afterSurcharge * FEE_DENOMINATOR) / (FEE_DENOMINATOR + PLATFORM_FEE_RATE);
}

/**
 * Validate that a set of amounts satisfies the invariant T = D + F + E exactly.
 *
 * This is used as a post-condition check after any fee computation and
 * before persisting financial records. A mismatch indicates a bug.
 *
 * @param developer  - Developer payout amount.
 * @param fee        - Platform fee amount.
 * @param total      - Total funded amount.
 * @param surcharge  - Optional surcharge.
 * @returns `ok(undefined)` when balanced, or an error describing the mismatch.
 *
 * @see Spec §4.3 — Settlement invariant
 */
export function validateAmounts(
  developer: bigint,
  fee: bigint,
  total: bigint,
  surcharge: bigint = 0n,
): Result<void> {
  if (developer < 0n) {
    return domainErr(
      'negative-developer-amount',
      'Developer amount must be non-negative',
      { developer: developer.toString() },
    );
  }
  if (fee < 0n) {
    return domainErr(
      'negative-fee',
      'Platform fee must be non-negative',
      { fee: fee.toString() },
    );
  }
  if (total < 0n) {
    return domainErr(
      'negative-total',
      'Total must be non-negative',
      { total: total.toString() },
    );
  }

  const expectedFee = calculatePlatformFee(developer);
  if (fee !== expectedFee) {
    return domainErr(
      'fee-mismatch',
      `Fee ${fee} does not match expected ${expectedFee} for developer amount ${developer}`,
      {
        fee: fee.toString(),
        expectedFee: expectedFee.toString(),
        developer: developer.toString(),
      },
    );
  }

  const expectedTotal = developer + fee + surcharge;
  if (total !== expectedTotal) {
    return domainErr(
      'total-mismatch',
      `Total ${total} does not equal D(${developer}) + F(${fee}) + E(${surcharge}) = ${expectedTotal}`,
      {
        total: total.toString(),
        expectedTotal: expectedTotal.toString(),
        developer: developer.toString(),
        fee: fee.toString(),
        surcharge: surcharge.toString(),
      },
    );
  }

  return ok(undefined);
}

// ──────────────────────────────────────────────
//  Parsing & formatting
// ──────────────────────────────────────────────

/**
 * Parse a human-readable decimal string into atomic token units.
 *
 * This function performs **pure string manipulation** — at no point is a
 * JavaScript `number` (IEEE 754 binary float) created or used for the
 * conversion. This is essential because `Number("1.23")` can produce
 * rounding artefacts that would cause fund misallocation.
 *
 * Examples (decimals = 18):
 *   "1"      → 1000000000000000000n
 *   "0.5"    → 500000000000000000n
 *   "1.005"  → 1005000000000000000n  (exact — no float involved)
 *
 * @param input    - Decimal string (e.g. "1.005"). Must match `/^\d+(\.\d+)?$/`.
 * @param decimals - Number of decimal places for the token (e.g. 18 for ETH).
 * @returns Atomic bigint amount, or an error if the input is malformed.
 *
 * @see Spec §4.1 — Token amount representation
 */
export function parseTokenAmount(
  input: string,
  decimals: number,
): Result<bigint> {
  // Trim whitespace
  const trimmed = input.trim();

  // Validate format: optional leading digits, optional decimal part
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return domainErr(
      'invalid-token-amount',
      `"${input}" is not a valid decimal number`,
      { input },
    );
  }

  if (decimals < 0 || !Number.isInteger(decimals)) {
    return domainErr(
      'invalid-decimals',
      `decimals must be a non-negative integer, got ${decimals}`,
      { decimals },
    );
  }

  const parts = trimmed.split('.');
  const wholePart = parts[0] ?? '0';
  let fracPart = parts[1] ?? '';

  // If fractional part has more digits than allowed decimals → too precise
  if (fracPart.length > decimals) {
    return domainErr(
      'too-many-decimals',
      `"${input}" has ${fracPart.length} decimal places but token only supports ${decimals}`,
      { input, decimals, actualDecimals: fracPart.length },
    );
  }

  // Pad fractional part with trailing zeros to reach `decimals` width
  fracPart = fracPart.padEnd(decimals, '0');

  // Concatenate whole + padded fraction and parse as bigint
  // e.g. "1" + "005000000000000000" → "1005000000000000000"
  const raw = wholePart + fracPart;
  // Remove leading zeros (but keep at least one digit)
  const normalized = raw.replace(/^0+/, '') || '0';

  return ok(BigInt(normalized));
}

/**
 * Format an atomic bigint amount into a human-readable decimal string.
 *
 * Like `parseTokenAmount`, this uses **pure string manipulation** with
 * no intermediate float conversion.
 *
 * @param amount   - Atomic token units (must be non-negative).
 * @param decimals - Number of decimal places for the token.
 * @returns Human-readable string such as "1.005" (trailing zeros trimmed).
 *
 * @see Spec §4.1 — Token amount display
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (amount < 0n) {
    return '-' + formatTokenAmount(-amount, decimals);
  }

  const str = amount.toString().padStart(decimals + 1, '0');
  const wholeEnd = str.length - decimals;
  const whole = str.slice(0, wholeEnd);

  if (decimals === 0) return whole;

  const frac = str.slice(wholeEnd);
  // Trim trailing zeros but keep at least one if there's a decimal part
  const trimmed = frac.replace(/0+$/, '');

  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}
