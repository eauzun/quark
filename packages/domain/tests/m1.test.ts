import { describe, it, expect } from "vitest";
import {
  createWalletChallenge,
  registerVerifiedWallet,
  isWalletEligibleForPayout,
  WALLET_SECURITY_HOLD_HOURS,
} from "../src/identity/wallet-verification.js";
import {
  evaluateEmployerApproval,
  suspendRole,
  appealRoleDecision,
} from "../src/identity/role-approval.js";
import {
  transferOwnership,
  removeMember,
  detectConflictOfInterest,
  Organization,
  OrganizationMembership,
} from "../src/organization/organization-permissions.js";

describe("M1: Wallet Security & 24h Hold (Spec §2, §9.3 & §15.1 Scenario 11)", () => {
  it("enforces mandatory 24-hour security hold before wallet can receive payouts", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const wallet = registerVerifiedWallet({
      userId: "u-1",
      network: "base",
      address: "0x1234567890123456789012345678901234567890",
      message: "Quark Auth",
      signature: "0xsignature",
      now,
    });

    // Immediate check (0 hours elapsed) -> Must be locked
    const immediateCheck = isWalletEligibleForPayout(wallet, now);
    expect(immediateCheck.ok).toBe(false);
    if (!immediateCheck.ok) {
      expect(immediateCheck.error.code).toBe("PAYOUT_LOCKED");
    }

    // 12 hours later -> Still locked
    const halfDayLater = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const halfDayCheck = isWalletEligibleForPayout(wallet, halfDayLater);
    expect(halfDayCheck.ok).toBe(false);

    // 24.1 hours later -> Unlocked and eligible
    const fullDayLater = new Date(
      now.getTime() + (WALLET_SECURITY_HOLD_HOURS + 0.1) * 60 * 60 * 1000
    );
    const fullDayCheck = isWalletEligibleForPayout(wallet, fullDayLater);
    expect(fullDayCheck.ok).toBe(true);
  });

  it("generates structured challenge message", () => {
    const challenge = createWalletChallenge({
      address: "0x1234567890123456789012345678901234567890",
      userId: "u-123",
      nonce: "random-nonce-xyz",
      issuedAt: new Date("2026-10-28T12:00:00Z"),
    });

    expect(challenge).toContain("Quark Authentication");
    expect(challenge).toContain("User ID: u-123");
    expect(challenge).toContain("Nonce: random-nonce-xyz");
  });
});

describe("M1: Role Approvals & Age Attestation (Spec §2)", () => {
  it("rejects approval if email is not verified", () => {
    const result = evaluateEmployerApproval({
      userId: "u-1",
      emailVerified: false,
      ageAttested: true,
      intendedUse: "I want to hire Web3 frontend developers for my DEX.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EMAIL_NOT_VERIFIED");
    }
  });

  it("rejects approval if age is not attested (adults only)", () => {
    const result = evaluateEmployerApproval({
      userId: "u-1",
      emailVerified: true,
      ageAttested: false,
      intendedUse: "I want to hire Web3 frontend developers for my DEX.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGE_ATTESTATION_REQUIRED");
    }
  });

  it("auto-approves valid employer applications", () => {
    const result = evaluateEmployerApproval({
      userId: "u-1",
      emailVerified: true,
      ageAttested: true,
      intendedUse: "Building a decentralised escrow protocol and need unit tests.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("approved");
      expect(result.value.reviewedBy).toBe("system_rules");
    }
  });

  it("routes spammy/suspicious applications to manual review", () => {
    const result = evaluateEmployerApproval({
      userId: "u-1",
      emailVerified: true,
      ageAttested: true,
      intendedUse: "Join our telegram bot pump group for free crypto!",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
      expect(result.value.reviewedBy).toBeUndefined();
    }
  });

  it("supports appeal on suspended roles", () => {
    const initial = evaluateEmployerApproval({
      userId: "u-1",
      emailVerified: true,
      ageAttested: true,
      intendedUse: "Legitimate development team.",
    });
    if (!initial.ok) return;

    const suspended = suspendRole(initial.value, "Suspected policy breach");
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) return;
    expect(suspended.value.status).toBe("suspended");

    const appealed = appealRoleDecision(suspended.value, "Here is our registered business evidence.");
    expect(appealed.ok).toBe(true);
    if (!appealed.ok) return;
    expect(appealed.value.status).toBe("pending");
    expect(appealed.value.appealNotes).toContain("registered business");
  });
});

describe("M1: Organization Permissions & Conflicts (Spec §2 & §15.1)", () => {
  const sampleOrg: Organization = {
    id: "org-1",
    name: "Acme Web3",
    ownerId: "u-alice",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sampleMemberships: OrganizationMembership[] = [
    {
      id: "mem-1",
      organizationId: "org-1",
      userId: "u-alice",
      role: "owner",
      capabilities: ["manage_members", "spend_funds"],
      createdAt: new Date(),
    },
    {
      id: "mem-2",
      organizationId: "org-1",
      userId: "u-bob",
      role: "member",
      capabilities: ["view_assigned_jobs"],
      createdAt: new Date(),
    },
  ];

  it("forbids removing the last owner of an organization", () => {
    const aliceMembership = sampleMemberships[0];
    const check = removeMember(sampleOrg, aliceMembership);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error.code).toBe("LAST_OWNER_REMOVAL_FORBIDDEN");
    }
  });

  it("transfers ownership cleanly and updates roles", () => {
    const result = transferOwnership(sampleOrg, sampleMemberships, "u-bob");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.org.ownerId).toBe("u-bob");
      const newBobMem = result.value.updatedMemberships.find((m) => m.userId === "u-bob");
      const newAliceMem = result.value.updatedMemberships.find((m) => m.userId === "u-alice");
      expect(newBobMem?.role).toBe("owner");
      expect(newAliceMem?.role).toBe("member");
    }
  });

  it("strictly detects self-dealing and org conflicts (Spec §2)", () => {
    // 1. Worker is employer -> forbidden
    const selfDealing = detectConflictOfInterest({
      candidateUserId: "u-alice",
      employerUserId: "u-alice",
      role: "worker_candidate",
    });
    expect(selfDealing.ok).toBe(false);
    if (!selfDealing.ok) {
      expect(selfDealing.error.code).toBe("CONFLICT_DETECTED");
    }

    // 2. Worker belongs to employer org -> forbidden
    const orgMemberConflict = detectConflictOfInterest({
      candidateUserId: "u-bob",
      employerUserId: "u-alice",
      employerOrgMemberIds: ["u-alice", "u-bob"],
      role: "worker_candidate",
    });
    expect(orgMemberConflict.ok).toBe(false);
    if (!orgMemberConflict.ok) {
      expect(orgMemberConflict.error.code).toBe("CONFLICT_DETECTED");
    }

    // 3. Independent candidate -> allowed
    const cleanAssignment = detectConflictOfInterest({
      candidateUserId: "u-charlie",
      employerUserId: "u-alice",
      employerOrgMemberIds: ["u-alice", "u-bob"],
      role: "worker_candidate",
    });
    expect(cleanAssignment.ok).toBe(true);
  });
});
