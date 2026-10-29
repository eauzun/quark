/**
 * wallet-verification.ts — Web3 wallet ownership verification and security holds.
 * Spec §2 & §9.3 & §15.1 Scenario 11:
 * "New wallet requires proof and 24-hour hold; session theft cannot bypass it."
 */

import { verifyMessage } from "viem";
import { Result, ok, err, createError } from "../shared/result.js";

export interface Wallet {
  id: string;
  userId: string;
  network: string;
  address: string;
  isPrimary: boolean;
  createdAt: Date;
  activeAfter: Date; // 24-hour hold enforcement
  ownershipProof?: {
    message: string;
    signature: string;
    verifiedAt: string;
  };
}

export const WALLET_SECURITY_HOLD_HOURS = 24;

/**
 * Generates an EIP-191 verification challenge message with timestamp & nonce.
 */
export const createWalletChallenge = (params: {
  address: string;
  userId: string;
  nonce: string;
  issuedAt?: Date;
}): string => {
  const time = (params.issuedAt ?? new Date()).toISOString();
  return (
    `Quark Authentication & Wallet Verification\n` +
    `User ID: ${params.userId}\n` +
    `Address: ${params.address.toLowerCase()}\n` +
    `Nonce: ${params.nonce}\n` +
    `Issued At: ${time}\n\n` +
    `Sign this message to prove wallet ownership. This will not trigger a blockchain transaction or incur gas fees.`
  );
};

/**
 * Verifies an Ethereum/EVM personal_sign signature against the challenge message.
 */
export const verifyWalletOwnership = async (params: {
  address: string;
  message: string;
  signature: `0x${string}`;
}): Promise<Result<boolean>> => {
  try {
    const isValid = await verifyMessage({
      address: params.address as `0x${string}`,
      message: params.message,
      signature: params.signature,
    });

    if (!isValid) {
      return err(
        createError(
          "INVALID_SIGNATURE",
          "Wallet ownership signature is invalid or signer mismatch."
        )
      );
    }

    return ok(true);
  } catch (error) {
    return err(
      createError(
        "SIGNATURE_VERIFICATION_FAILED",
        error instanceof Error ? error.message : "Unknown verification error"
      )
    );
  }
};

/**
 * Creates a new wallet record with mandatory 24-hour security hold.
 */
export const registerVerifiedWallet = (params: {
  userId: string;
  network: string;
  address: string;
  message: string;
  signature: string;
  isPrimary?: boolean;
  now?: Date;
}): Wallet => {
  const currentTime = params.now ?? new Date();
  const activeAfterTime = new Date(
    currentTime.getTime() + WALLET_SECURITY_HOLD_HOURS * 60 * 60 * 1000
  );

  return {
    id: crypto.randomUUID(),
    userId: params.userId,
    network: params.network,
    address: params.address.toLowerCase(),
    isPrimary: params.isPrimary ?? false,
    createdAt: currentTime,
    activeAfter: activeAfterTime,
    ownershipProof: {
      message: params.message,
      signature: params.signature,
      verifiedAt: currentTime.toISOString(),
    },
  };
};

/**
 * Checks whether a wallet has completed its 24-hour security hold.
 */
export const isWalletEligibleForPayout = (
  wallet: Wallet,
  currentTime: Date = new Date()
): Result<boolean> => {
  if (currentTime < wallet.activeAfter) {
    const remainingMs = wallet.activeAfter.getTime() - currentTime.getTime();
    const remainingHours = (remainingMs / (1000 * 60 * 60)).toFixed(1);
    return err(
      createError(
        "PAYOUT_LOCKED",
        `Wallet is in 24-hour security hold. Payout unlocked in ${remainingHours} hours.`,
        { activeAfter: wallet.activeAfter.toISOString() }
      )
    );
  }

  return ok(true);
};
