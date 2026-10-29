/**
 * sandbox/artifact-validator.ts — Validates uploaded artifacts before execution.
 * Spec §12: "Archive upload fallback: reject path traversal, symlinks escaping
 * root, decompression bombs and executable upload abuse. Default compressed
 * upload limit 100 MB, expanded 500 MB."
 *
 * Spec §7.1 step 2: "Detect secrets/malware, validate artifact integrity and size limits."
 */

import { Result, ok, err, createError } from "@quark/domain";

// ──────────────────────────────────────────────
//  Size Limits (Spec §12)
// ──────────────────────────────────────────────

export const MAX_COMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_EXPANDED_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_COMPRESSION_RATIO = 100; // Decompression bomb threshold

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

export interface ArchiveEntry {
  path: string;
  sizeBytes: number;
  isSymlink: boolean;
  symlinkTarget?: string;
  isExecutable: boolean;
  mode?: number;
}

export interface ArtifactManifest {
  archiveSizeBytes: number;
  expandedSizeBytes: number;
  entries: ArchiveEntry[];
  fileCount: number;
}

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  warnings: string[];
}

// ──────────────────────────────────────────────
//  Artifact Validator
// ──────────────────────────────────────────────

export class ArtifactValidator {
  /**
   * Validate a full artifact manifest against all security rules.
   *
   * Checks (Spec §12, §7.1):
   * 1. Compressed size <= 100 MB
   * 2. Expanded size <= 500 MB
   * 3. Compression ratio <= 100:1 (decompression bomb)
   * 4. No path traversal (../, absolute paths)
   * 5. No symlinks escaping the archive root
   * 6. No executable files (unless explicitly allowed)
   * 7. No hidden system files (.git/hooks, .env, etc.)
   */
  validate(manifest: ArtifactManifest): Result<ValidationResult> {
    const violations: string[] = [];
    const warnings: string[] = [];

    // 1. Compressed size check
    if (manifest.archiveSizeBytes > MAX_COMPRESSED_BYTES) {
      violations.push(
        `Compressed archive size ${this.formatBytes(manifest.archiveSizeBytes)} exceeds limit ${this.formatBytes(MAX_COMPRESSED_BYTES)}`
      );
    }

    // 2. Expanded size check
    if (manifest.expandedSizeBytes > MAX_EXPANDED_BYTES) {
      violations.push(
        `Expanded size ${this.formatBytes(manifest.expandedSizeBytes)} exceeds limit ${this.formatBytes(MAX_EXPANDED_BYTES)}`
      );
    }

    // 3. Decompression bomb detection
    if (manifest.archiveSizeBytes > 0) {
      const ratio = manifest.expandedSizeBytes / manifest.archiveSizeBytes;
      if (ratio > MAX_COMPRESSION_RATIO) {
        violations.push(
          `Decompression bomb detected: compression ratio ${ratio.toFixed(1)}:1 exceeds ${MAX_COMPRESSION_RATIO}:1 threshold`
        );
      }
    }

    // 4-7. Per-entry checks
    for (const entry of manifest.entries) {
      // Path traversal
      if (entry.path.includes("..")) {
        violations.push(`Path traversal detected: '${entry.path}' contains '..'`);
      }
      if (entry.path.startsWith("/")) {
        violations.push(`Absolute path not allowed: '${entry.path}'`);
      }
      if (entry.path.includes("\0")) {
        violations.push(`Null byte in path: '${entry.path}'`);
      }

      // Symlink escaping root
      if (entry.isSymlink && entry.symlinkTarget) {
        if (entry.symlinkTarget.startsWith("/") || entry.symlinkTarget.includes("..")) {
          violations.push(
            `Symlink escapes archive root: '${entry.path}' -> '${entry.symlinkTarget}'`
          );
        }
      }

      // Executable files
      if (entry.isExecutable) {
        violations.push(`Executable file not allowed in submission: '${entry.path}'`);
      }

      // Sensitive hidden files
      const SENSITIVE_PATTERNS = [
        /\.env/i,
        /\.git\/hooks\//i,
        /\.ssh\//i,
        /\.aws\//i,
        /\.npmrc/i,
        /\.netrc/i,
        /id_rsa/i,
        /id_ed25519/i,
      ];
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(entry.path)) {
          violations.push(`Sensitive file detected: '${entry.path}'`);
        }
      }
    }

    return ok({
      isValid: violations.length === 0,
      violations,
      warnings,
    });
  }

  /**
   * Scan file content for secrets before allowing into the review pipeline.
   * Spec §7.1 step 2: "Detect secrets/malware."
   */
  scanForSecrets(content: string, filePath: string): Result<string[]> {
    const findings: string[] = [];

    const SECRET_DETECTORS: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /(?:^|[^0-9a-fA-F])0x[0-9a-fA-F]{64}(?:[^0-9a-fA-F]|$)/, label: "EVM private key" },
      { pattern: /AKIA[0-9A-Z]{16}/, label: "AWS Access Key ID" },
      { pattern: /ghp_[A-Za-z0-9]{36}/, label: "GitHub Personal Access Token" },
      { pattern: /github_pat_[A-Za-z0-9_]{22,}/, label: "GitHub Fine-grained PAT" },
      { pattern: /sk-[A-Za-z0-9]{20,}/, label: "OpenAI API Key" },
      { pattern: /-----BEGIN\s+(RSA|EC|OPENSSH|PGP)?\s*PRIVATE KEY-----/, label: "PEM Private Key" },
      { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: "Slack Token" },
      { pattern: /AIza[0-9A-Za-z_-]{35}/, label: "Google API Key" },
      { pattern: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"']{8,}["']/i, label: "Hardcoded password" },
    ];

    for (const detector of SECRET_DETECTORS) {
      if (detector.pattern.test(content)) {
        findings.push(`${detector.label} found in ${filePath}`);
      }
    }

    return ok(findings);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}