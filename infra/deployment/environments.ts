/**
 * infra/deployment/environments.ts — Environment separation and secrets management.
 * Spec §14: "Local development via reproducible containers; mock email/AI/payments
 * with prominent environment markers. Staging uses sandbox/testnet accounts.
 * Production infra as code; secrets managed outside repository."
 * Spec §0.1: "Never label simulated balances, synthetic market data, mock reviews
 * or testnet transactions as real."
 */

export type Environment = "local" | "test" | "staging" | "production";

export interface EnvironmentConfig {
  name: Environment;
  /** Whether this is a non-production environment (requires visible markers) */
  isNonProduction: boolean;
  /** Settlement mode */
  settlementMode: "mock" | "testnet" | "mainnet";
  /** AI provider mode */
  aiMode: "mock" | "free_tier" | "production";
  /** Email delivery mode */
  emailMode: "mock" | "sandbox" | "production";
  /** Required environment variables (secrets reference names, not values) */
  requiredSecrets: string[];
  /** Feature flags */
  features: {
    realMoney: boolean;
    autonomousAcceptance: boolean;
    trainingDataCollection: boolean;
    mainnetSettlement: boolean;
  };
  /** UI banner to show in non-production */
  environmentBanner?: string;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  local: {
    name: "local",
    isNonProduction: true,
    settlementMode: "mock",
    aiMode: "mock",
    emailMode: "mock",
    requiredSecrets: [],
    features: {
      realMoney: false,
      autonomousAcceptance: false,
      trainingDataCollection: false,
      mainnetSettlement: false,
    },
    environmentBanner: "🔧 LOCAL DEVELOPMENT — All data is simulated. No real transactions.",
  },
  test: {
    name: "test",
    isNonProduction: true,
    settlementMode: "mock",
    aiMode: "mock",
    emailMode: "mock",
    requiredSecrets: [],
    features: {
      realMoney: false,
      autonomousAcceptance: false,
      trainingDataCollection: false,
      mainnetSettlement: false,
    },
    environmentBanner: "🧪 TEST ENVIRONMENT — Automated tests only. All data is simulated.",
  },
  staging: {
    name: "staging",
    isNonProduction: true,
    settlementMode: "testnet",
    aiMode: "free_tier",
    emailMode: "sandbox",
    requiredSecrets: [
      "DATABASE_URL",
      "AI_PROVIDER_API_KEY",
      "EMAIL_API_KEY",
      "SETTLEMENT_RPC_URL",
    ],
    features: {
      realMoney: false,
      autonomousAcceptance: false,
      trainingDataCollection: false,
      mainnetSettlement: false,
    },
    environmentBanner: "⚠️ STAGING — Base Sepolia TESTNET only. Transactions are NOT real funds.",
  },
  production: {
    name: "production",
    isNonProduction: false,
    settlementMode: "testnet", // Gated — stays testnet until gates cleared
    aiMode: "production",
    emailMode: "production",
    requiredSecrets: [
      "DATABASE_URL",
      "AI_PROVIDER_API_KEY",
      "EMAIL_API_KEY",
      "SETTLEMENT_RPC_URL",
      "JWT_SECRET",
      "SIGNING_KEY_REF",
    ],
    features: {
      realMoney: false, // Gated by production gates — enable only after GateTracker confirms
      autonomousAcceptance: false, // Gated by category benchmarks
      trainingDataCollection: false, // Gated by training rights
      mainnetSettlement: false, // Gated by USDC/network gate
    },
  },
};

// ──────────────────────────────────────────────
//  Secrets Manager Interface
// ──────────────────────────────────────────────

/**
 * Spec §14: "secrets managed outside repository."
 * Spec §9.2: "Signing secrets stored in managed signer/KMS or provider,
 * never app DB or prompt."
 *
 * This is an interface — actual implementation uses cloud KMS/Secrets Manager.
 */
export interface SecretsProvider {
  /** Retrieve a secret by reference name */
  getSecret(name: string): Promise<string | null>;
  /** Check if a secret exists (without revealing value) */
  hasSecret(name: string): Promise<boolean>;
}

/**
 * Mock secrets provider for local development and testing.
 * ⚠️ NEVER use in production.
 */
export class MockSecretsProvider implements SecretsProvider {
  private secrets: Map<string, string> = new Map();

  async getSecret(name: string): Promise<string | null> {
    return this.secrets.get(name) || null;
  }

  async hasSecret(name: string): Promise<boolean> {
    return this.secrets.has(name);
  }

  /** Test helper: set a secret */
  setSecret(name: string, value: string): void {
    this.secrets.set(name, value);
  }
}

// ──────────────────────────────────────────────
//  Environment Validator
// ──────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  missingSecrets: string[];
  warnings: string[];
}

export class EnvironmentValidator {
  /**
   * Validate that the environment is properly configured.
   * Prevents accidental production usage of mock/test configs.
   */
  async validate(
    env: Environment,
    secrets: SecretsProvider
  ): Promise<ValidationResult> {
    const config = ENVIRONMENTS[env];
    const missingSecrets: string[] = [];
    const warnings: string[] = [];

    // Check required secrets
    for (const secret of config.requiredSecrets) {
      const exists = await secrets.hasSecret(secret);
      if (!exists) {
        missingSecrets.push(secret);
      }
    }

    // Production-specific checks
    if (env === "production") {
      if (config.settlementMode === "mock") {
        warnings.push(
          "⚠️ CRITICAL: Production must never use mock settlement (Spec §0.1)"
        );
      }
      if (!config.features.realMoney) {
        warnings.push(
          "Real-money features are disabled — production gates not yet cleared"
        );
      }
    }

    // Non-production banner check
    if (config.isNonProduction && !config.environmentBanner) {
      warnings.push("Non-production environment missing visible banner");
    }

    return {
      isValid: missingSecrets.length === 0,
      missingSecrets,
      warnings,
    };
  }
}