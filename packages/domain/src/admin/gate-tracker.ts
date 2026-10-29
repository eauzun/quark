/**
 * admin/gate-tracker.ts — Production gate tracking (Spec §19).
 *
 * Spec §0: "G: production gate requiring external evidence, credentials,
 * testing or an accountable operator. Build interfaces and test implementations
 * now; do not fake production completion."
 *
 * Spec §19: "These are genuine external launch dependencies, not missing
 * product decisions. Development continues using documented defaults and test
 * adapters."
 */

import { Result, ok, err, createError } from "../shared/result.js";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

export type GateStatus = "not_started" | "in_progress" | "evidence_submitted" | "cleared" | "blocked";

export interface ProductionGate {
  id: string;
  name: string;
  description: string;
  /** What external evidence is required */
  requiredEvidence: string;
  /** What the gate blocks if not cleared */
  blocks: string;
  /** Current status */
  status: GateStatus;
  /** Accountable operator/person responsible */
  owner: string;
  /** When evidence was submitted */
  evidenceSubmittedAt?: Date;
  /** When gate was cleared */
  clearedAt?: Date;
  /** Notes and audit trail */
  notes: string[];
  /** Whether this is a hard block (cannot ship without it) */
  isHardBlock: boolean;
}

export interface GateReport {
  totalGates: number;
  clearedGates: number;
  hardBlockGates: number;
  clearedHardBlocks: number;
  /** Can the platform launch with real money? */
  canLaunchRealMoney: boolean;
  /** Can the platform operate in testnet/demo mode? */
  canOperateTestnet: boolean;
  gates: ProductionGate[];
  blockingGates: string[];
}

// ──────────────────────────────────────────────
//  Gate Definitions (Spec §19)
// ──────────────────────────────────────────────

export const PRODUCTION_GATES: ProductionGate[] = [
  {
    id: "entity-jurisdictions",
    name: "Legal Entity & Operating Jurisdictions",
    description: "Responsible operator, applicable terms and operating assessment",
    requiredEvidence: "Registered legal entity, terms of service, jurisdiction analysis",
    blocks: "Real-money launch",
    status: "not_started",
    owner: "founder",
    notes: [],
    isHardBlock: true,
  },
  {
    id: "custody-provider",
    name: "Custody / Fund-Holding Provider",
    description: "Provider approval or reviewed alternative design",
    requiredEvidence: "Provider agreement or independent audit of custom custody design",
    blocks: "Real-money funding",
    status: "not_started",
    owner: "founder",
    notes: [],
    isHardBlock: true,
  },
  {
    id: "usdc-network",
    name: "USDC / Network Configuration",
    description: "Current issuer address/decimals, finality and monitoring policy",
    requiredEvidence: "Verified official token config from Circle/Coinbase, finality policy document",
    blocks: "Mainnet settlement adapter",
    status: "not_started",
    owner: "engineering",
    notes: [],
    isHardBlock: true,
  },
  {
    id: "ai-vendor",
    name: "AI Vendor Access & Terms",
    description: "Model access, current prices, data/retention terms",
    requiredEvidence: "API access confirmed, pricing verified, data processing agreement",
    blocks: "Private production reviews",
    status: "not_started",
    owner: "engineering",
    notes: ["Using free-tier providers (ADR-001) — privacy constraints documented"],
    isHardBlock: true,
  },
  {
    id: "category-qualification",
    name: "Category AI Qualification",
    description: "Labelled benchmark, metrics, signoff per category",
    requiredEvidence: "≥200 labelled cases (≥60 must-reject), zero critical false accepts, signoff",
    blocks: "That category's autonomous paid acceptance",
    status: "not_started",
    owner: "engineering",
    notes: [],
    isHardBlock: true,
  },
  {
    id: "exception-handling",
    name: "Exception Handling Capacity",
    description: "Qualified reviewer capacity and external dispute process",
    requiredEvidence: "At least 2 qualified reviewers, documented external dispute venue",
    blocks: "Paid jobs requiring human recourse",
    status: "not_started",
    owner: "operations",
    notes: [],
    isHardBlock: true,
  },
  {
    id: "training-rights",
    name: "Training Data Rights",
    description: "Executed grants, ownership/license filters, withdrawal policy",
    requiredEvidence: "Legal review of training terms, consent mechanism tested",
    blocks: "Model-training dataset inclusion",
    status: "not_started",
    owner: "legal",
    notes: [],
    isHardBlock: false,
  },
  {
    id: "security-review",
    name: "Independent Security Review",
    description: "Runner, signer, ledger and access review",
    requiredEvidence: "Third-party security audit report with no critical findings",
    blocks: "Production activation",
    status: "not_started",
    owner: "engineering",
    notes: [],
    isHardBlock: true,
  },
];

// ──────────────────────────────────────────────
//  Gate Tracker
// ──────────────────────────────────────────────

export class GateTracker {
  private gates: Map<string, ProductionGate>;

  constructor(initialGates: ProductionGate[] = PRODUCTION_GATES) {
    this.gates = new Map(initialGates.map((g) => [g.id, { ...g, notes: [...g.notes] }]));
  }

  /**
   * Get current status of all gates.
   */
  getReport(): GateReport {
    const gates = Array.from(this.gates.values());
    const clearedGates = gates.filter((g) => g.status === "cleared");
    const hardBlocks = gates.filter((g) => g.isHardBlock);
    const clearedHardBlocks = hardBlocks.filter((g) => g.status === "cleared");

    return {
      totalGates: gates.length,
      clearedGates: clearedGates.length,
      hardBlockGates: hardBlocks.length,
      clearedHardBlocks: clearedHardBlocks.length,
      canLaunchRealMoney: hardBlocks.every((g) => g.status === "cleared"),
      canOperateTestnet: true, // Always true — testnet/dev mode is unrestricted
      gates,
      blockingGates: hardBlocks
        .filter((g) => g.status !== "cleared")
        .map((g) => g.id),
    };
  }

  /**
   * Update a gate's status with audit trail.
   */
  updateGate(
    gateId: string,
    status: GateStatus,
    note?: string
  ): Result<ProductionGate> {
    const gate = this.gates.get(gateId);
    if (!gate) {
      return err(createError("NOT_FOUND", `Gate '${gateId}' not found`));
    }

    const now = new Date();

    // Validate transitions
    if (status === "cleared" && gate.status === "not_started") {
      return err(
        createError(
          "VALIDATION_ERROR",
          `Cannot clear gate '${gateId}' from 'not_started' — evidence must be submitted first`
        )
      );
    }

    gate.status = status;
    if (status === "evidence_submitted") {
      gate.evidenceSubmittedAt = now;
    }
    if (status === "cleared") {
      gate.clearedAt = now;
    }
    if (note) {
      gate.notes.push(`[${now.toISOString()}] ${note}`);
    }

    return ok({ ...gate, notes: [...gate.notes] });
  }

  /**
   * Check if a specific action is allowed given current gate status.
   */
  isActionAllowed(action: "real_money_funding" | "testnet_funding" | "mainnet_adapter" | "autonomous_acceptance"): boolean {
    const report = this.getReport();

    switch (action) {
      case "testnet_funding":
        return true; // Always allowed in testnet
      case "real_money_funding":
        return report.canLaunchRealMoney;
      case "mainnet_adapter": {
        const usdcGate = this.gates.get("usdc-network");
        return usdcGate?.status === "cleared";
      }
      case "autonomous_acceptance": {
        const catGate = this.gates.get("category-qualification");
        return catGate?.status === "cleared";
      }
      default:
        return false;
    }
  }

  /**
   * Get a specific gate by ID.
   */
  getGate(gateId: string): ProductionGate | undefined {
    return this.gates.get(gateId);
  }
}