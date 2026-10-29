/**
 * sandbox/runner.ts — Isolated code execution runner with resource limits.
 * Spec §14.3: "Use isolated microVM or comparable hardened runner, non-root,
 * no host mounts, no cloud metadata, denied network by default, explicit
 * allowlist/proxy for dependency retrieval. Default 2 vCPU, 4 GB RAM,
 * 15-minute run cap, 2 GB output cap."
 *
 * Spec §0.1 invariant: Never label simulated output as real execution.
 */

import { Result, ok, err, createError } from "@quark/domain";

// ──────────────────────────────────────────────
//  Resource Limits (Spec §14.3 defaults)
// ──────────────────────────────────────────────

export interface ResourceLimits {
  /** Maximum virtual CPUs (default: 2) */
  cpuCount: number;
  /** Maximum memory in bytes (default: 4 GB) */
  memoryBytes: number;
  /** Maximum wall-clock run time in seconds (default: 900 = 15 min) */
  timeoutSeconds: number;
  /** Maximum total output bytes (default: 2 GB) */
  maxOutputBytes: number;
  /** Allow network access (default: false — denied by default) */
  allowNetwork: boolean;
  /** Network allowlist (only populated when allowNetwork is true) */
  networkAllowlist: string[];
}

export const DEFAULT_LIMITS: ResourceLimits = {
  cpuCount: 2,
  memoryBytes: 4 * 1024 * 1024 * 1024, // 4 GB
  timeoutSeconds: 900, // 15 minutes
  maxOutputBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  allowNetwork: false,
  networkAllowlist: [],
};

// ──────────────────────────────────────────────
//  Execution Request / Result
// ──────────────────────────────────────────────

export interface SandboxRunRequest {
  /** Unique run identifier */
  runId: string;
  /** Command to execute (e.g., ["npm", "test"]) */
  command: string[];
  /** Working directory inside the sandbox */
  workdir: string;
  /** Environment variables (no secrets — validated before execution) */
  env: Record<string, string>;
  /** Resource limits (merged with defaults) */
  limits?: Partial<ResourceLimits>;
  /** Category-specific limit overrides (versioned per Spec §14.3) */
  categoryOverride?: string;
}

export interface SandboxRunResult {
  runId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True if the run was terminated due to resource limits */
  wasKilled: boolean;
  /** Which limit was hit (if wasKilled is true) */
  killReason?: "timeout" | "memory" | "output_limit" | "cpu";
  /** Peak memory usage in bytes */
  peakMemoryBytes: number;
  /** Whether network was accessible during execution */
  networkWasBlocked: boolean;
}

// ──────────────────────────────────────────────
//  Sandbox Runner
// ──────────────────────────────────────────────

export class SandboxRunner {
  private readonly defaultLimits: ResourceLimits;

  constructor(defaults?: Partial<ResourceLimits>) {
    this.defaultLimits = { ...DEFAULT_LIMITS, ...defaults };
  }

  /**
   * Execute a command inside the isolated sandbox.
   *
   * Security invariants (Spec §14.3):
   * - Non-root user
   * - No host filesystem mounts
   * - No cloud metadata endpoint access
   * - Network denied by default
   * - Output capped at maxOutputBytes
   * - Hard timeout at timeoutSeconds
   */
  async run(request: SandboxRunRequest): Promise<Result<SandboxRunResult>> {
    const limits = this.resolveLimits(request.limits);

    // 1. Validate environment — no secrets in sandbox env
    const envCheck = this.validateEnvironment(request.env);
    if (!envCheck.ok) return envCheck;

    // 2. Validate command — no shell injection, no root escalation
    const cmdCheck = this.validateCommand(request.command);
    if (!cmdCheck.ok) return cmdCheck;

    // 3. Validate workdir — no path traversal outside sandbox root
    const dirCheck = this.validateWorkdir(request.workdir);
    if (!dirCheck.ok) return dirCheck;

    // 4. Execute with enforced limits
    // NOTE: In production this would use a microVM (Firecracker, gVisor).
    // In test/dev mode, this is a simulation that enforces logical limits.
    return ok(await this.executeWithLimits(request, limits));
  }

  /**
   * Merge caller limits with defaults. Per-category overrides are versioned.
   */
  private resolveLimits(overrides?: Partial<ResourceLimits>): ResourceLimits {
    return { ...this.defaultLimits, ...overrides };
  }

  /**
   * Reject environment variables containing known secret patterns.
   * Spec §7.1: "No secrets in model context." Same for sandbox execution.
   */
  private validateEnvironment(
    env: Record<string, string>
  ): Result<void> {
    const SECRET_PATTERNS = [
      /PRIVATE_KEY/i,
      /SECRET/i,
      /API_KEY/i,
      /TOKEN/i,
      /PASSWORD/i,
      /CREDENTIAL/i,
      /MNEMONIC/i,
    ];

    for (const [key, value] of Object.entries(env)) {
      // Block secret-looking keys
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(key)) {
          return err(
            createError(
              "VALIDATION_ERROR",
              `Environment variable '${key}' matches secret pattern — blocked from sandbox`
            )
          );
        }
      }
      // Block values that look like private keys
      if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
        return err(
          createError(
            "VALIDATION_ERROR",
            `Environment variable '${key}' contains what appears to be a private key`
          )
        );
      }
    }

    return ok(undefined);
  }

  /**
   * Validate command array. Reject shell metacharacters and privilege escalation.
   */
  private validateCommand(command: string[]): Result<void> {
    if (command.length === 0) {
      return err(createError("VALIDATION_ERROR", "Empty command"));
    }

    const DANGEROUS = ["sudo", "su", "chmod", "chown", "rm -rf /", "mkfs", "dd"];
    for (const arg of command) {
      for (const dangerous of DANGEROUS) {
        if (arg === dangerous || arg.startsWith(dangerous + " ")) {
          return err(
            createError(
              "VALIDATION_ERROR",
              `Command contains dangerous operation: '${dangerous}'`
            )
          );
        }
      }
      // Reject shell metacharacters that could enable injection
      if (/[;&|`$(){}[\]!]/.test(arg)) {
        return err(
          createError(
            "VALIDATION_ERROR",
            `Command argument contains shell metacharacters: '${arg}'`
          )
        );
      }
    }

    return ok(undefined);
  }

  /**
   * Validate workdir stays within the sandbox root.
   */
  private validateWorkdir(workdir: string): Result<void> {
    if (workdir.includes("..")) {
      return err(
        createError(
          "VALIDATION_ERROR",
          "Working directory contains path traversal (..)"
        )
      );
    }
    if (workdir.startsWith("/etc") || workdir.startsWith("/proc") || workdir.startsWith("/sys")) {
      return err(
        createError(
          "VALIDATION_ERROR",
          `Working directory '${workdir}' accesses restricted system path`
        )
      );
    }
    return ok(undefined);
  }

  /**
   * Simulate execution with enforced resource limits.
   * In production, this delegates to a microVM runner.
   */
  private async executeWithLimits(
    request: SandboxRunRequest,
    limits: ResourceLimits
  ): Promise<SandboxRunResult> {
    const startTime = Date.now();

    // Simulated execution — logs clearly marked as simulation
    const simulatedOutput = [
      `[SANDBOX-SIMULATED] Run ${request.runId}`,
      `[SANDBOX-SIMULATED] Command: ${request.command.join(" ")}`,
      `[SANDBOX-SIMULATED] Limits: ${limits.cpuCount} CPU, ${Math.round(limits.memoryBytes / 1024 / 1024)}MB RAM, ${limits.timeoutSeconds}s timeout`,
      `[SANDBOX-SIMULATED] Network: ${limits.allowNetwork ? "allowlist" : "BLOCKED"}`,
      `[SANDBOX-SIMULATED] This is a simulated execution — NOT a real code run`,
    ].join("\n");

    return {
      runId: request.runId,
      exitCode: 0,
      stdout: simulatedOutput,
      stderr: "",
      durationMs: Date.now() - startTime,
      wasKilled: false,
      peakMemoryBytes: 0,
      networkWasBlocked: !limits.allowNetwork,
    };
  }
}