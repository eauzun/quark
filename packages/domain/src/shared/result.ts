/**
 * @module shared/result
 * @description Algebraic Result type for all Quark domain operations.
 *
 * Every domain function returns `Result<T, E>` instead of throwing.
 * This forces callers to handle both success and failure paths explicitly,
 * which is critical for a financial platform where silent errors can
 * cause fund misallocation.
 *
 * @see Spec §2.1 — Error handling philosophy
 */

// ──────────────────────────────────────────────
//  Core types
// ──────────────────────────────────────────────

/**
 * Canonical domain error carried inside every failed `Result`.
 *
 * `code`    — machine-readable, kebab-case identifier (e.g. "insufficient-funds")
 * `message` — human-readable explanation (never shown raw to end-users)
 * `details` — optional bag of structured context for logging / telemetry
 */
export interface DomainError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Discriminated union representing either a successful value or a domain error.
 *
 * Usage:
 * ```ts
 * const result = doSomething();
 * if (result.ok) {
 *   // result.value is T
 * } else {
 *   // result.error is E (defaults to DomainError)
 * }
 * ```
 */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ──────────────────────────────────────────────
//  Constructors
// ──────────────────────────────────────────────

/**
 * Wrap a successful value in a `Result`.
 *
 * @param value - The success payload.
 * @returns A success-variant `Result` carrying `value`.
 */
export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

/**
 * Wrap an error in a `Result`.
 *
 * @param error - The error payload (defaults to `DomainError` at the type level).
 * @returns A failure-variant `Result` carrying `error`.
 */
export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

// ──────────────────────────────────────────────
//  Convenience helpers
// ──────────────────────────────────────────────

export const createError = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): DomainError => ({
  code,
  message,
  details,
});

/**
 * Create a `DomainError` and immediately wrap it in a failed `Result`.
 *
 * @param code    - Machine-readable error code.
 * @param message - Human-readable explanation.
 * @param details - Optional structured context.
 */
export const domainErr = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Result<never, DomainError> =>
  err({ code, message, details });

/**
 * Unwrap a `Result`, returning the value or throwing.
 * **Only use in tests or top-level orchestration** — domain code must
 * propagate `Result` without throwing.
 */
export const unwrap = <T>(result: Result<T>): T => {
  if (result.ok) return result.value;
  throw new Error(
    `Unwrap failed: [${result.error.code}] ${result.error.message}`,
  );
};
