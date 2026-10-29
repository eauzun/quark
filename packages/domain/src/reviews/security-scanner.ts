/**
 * security-scanner.ts — Secrets detection, malware heuristics, and prompt injection defense.
 * Spec §7.1: "Detect secrets/malware, validate artifact integrity and size limits."
 * Spec §15.1 Scenario 7:
 * "Repo prompt injection attempts to change wallet, price and system policy are ineffective."
 */

export interface SecurityFinding {
  type: "secret_leak" | "prompt_injection_attempt" | "malicious_script";
  severity: "critical" | "high" | "medium";
  filePath?: string;
  matchedPattern: string;
  description: string;
}

export interface SecurityScanResult {
  isClean: boolean;
  findings: SecurityFinding[];
  secretsDetectedCount: number;
  injectionAttemptsCount: number;
}

// Patterns for credential and secret leakage
const SECRET_PATTERNS = [
  { name: "EVM Private Key (Hex 64)", regex: /(?:0x)?[0-9a-fA-F]{64}/g },
  { name: "Generic API Key / Token", regex: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub Personal Access Token", regex: /ghp_[a-zA-Z0-9]{36}/g },
];

// Patterns for untrusted repository prompt injection (Spec §7.1 & §15.1 Scenario 7)
const INJECTION_PATTERNS = [
  { name: "System Override Attempt", regex: /(?:ignore\s+previous\s+instructions|system\s+prompt\s+override|disregard\s+all\s+rules)/gi },
  { name: "Payment Destination Alteration", regex: /(?:transfer\s+to\s+address|change\s+payout\s+wallet|send\s+funds\s+to)/gi },
  { name: "Fee Policy Manipulation", regex: /(?:set\s+platform\s+fee\s+to\s+0|bypass\s+20%\s+fee|platform\s+fee\s*=\s*0)/gi },
  { name: "Forced Pass Command", regex: /(?:mark\s+all\s+criteria\s+as\s+pass|output\s+only\s*["']?accept["']?|always\s+return\s+pass)/gi },
];

/**
 * Scans repository files and README text for sensitive credentials and malicious prompt injections.
 * Invariant: All repository comments, READMEs and docstrings are treated as UNTRUSTED task data.
 */
export const scanSubmissionSecurity = (
  files: Array<{ path: string; content: string }>
): SecurityScanResult => {
  const findings: SecurityFinding[] = [];
  let secretsDetectedCount = 0;
  let injectionAttemptsCount = 0;

  for (const file of files) {
    // 1. Scan for credentials / secrets
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(file.content)) {
        secretsDetectedCount++;
        findings.push({
          type: "secret_leak",
          severity: "critical",
          filePath: file.path,
          matchedPattern: pattern.name,
          description: `Potential hardcoded secret detected matching pattern: ${pattern.name}`,
        });
      }
    }

    // 2. Scan for prompt injection payload attempts (Spec §15.1 Scenario 7)
    for (const injection of INJECTION_PATTERNS) {
      if (injection.regex.test(file.content)) {
        injectionAttemptsCount++;
        findings.push({
          type: "prompt_injection_attempt",
          severity: "high",
          filePath: file.path,
          matchedPattern: injection.name,
          description: `Untrusted task text contains prompt injection directive: ${injection.name}. System policy and wallet destinations remain immutable.`,
        });
      }
    }
  }

  const isClean = findings.filter((f) => f.severity === "critical").length === 0;

  return {
    isClean,
    findings,
    secretsDetectedCount,
    injectionAttemptsCount,
  };
};
