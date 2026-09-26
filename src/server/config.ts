import { isAddress, type Address, type Hex } from 'viem';
export function settings() {
  const auth = authSettings();
  const escrow = process.env.ESCROW_ADDRESS;
  const badge = process.env.BADGE_ADDRESS;
  if (!escrow || !badge || !isAddress(escrow) || !isAddress(badge)) throw new Error('Contract addresses are not configured.');
  return { ...auth, escrow: escrow as Address, badge: badge as Address, oracleKey: process.env.ORACLE_PRIVATE_KEY as Hex | undefined };
}
export function authSettings() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set JWT_SECRET to at least 32 random characters.');
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error('APP_ORIGIN is required.');
  return { secret: new TextEncoder().encode(secret), origin, domain: new URL(origin).host };
}
