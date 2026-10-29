/**
 * budget-heatmap.ts — Market guidance and budget heatmap analysis.
 * Spec §4.2: Budget heatmap with suggested ranges; estimates distinguished from observed data.
 * Spec §15.1 Scenario 20: Heatmap with insufficient data labelled estimate; no fabricated market averages.
 */

import { Result, ok } from "../shared/result.js";

export interface CompletedJobRecord {
  jobId: string;
  categoryId: string;
  riskTier: "low" | "standard" | "high";
  scopeSize: "small" | "standard" | "complex";
  developerAmount: bigint;
  completedAt: Date;
  matchDurationHours?: number;
  isSelfDealingOrAbnormal: boolean;
}

export interface BudgetHeatmapRequest {
  categoryId: string;
  riskTier: "low" | "standard" | "high";
  scopeSize: "small" | "standard" | "complex";
  referenceDate?: Date;
}

export interface HeatmapPercentiles {
  p25: bigint;
  medianP50: bigint;
  p75: bigint;
}

export interface BudgetHeatmapResult {
  isReliableObservedData: boolean;
  sampleCount: number;
  label: string;
  currency: string;
  ranges: {
    belowTypical: { max: bigint };
    suggested: { min: bigint; max: bigint };
    competitive: { min: bigint };
  };
  percentiles: HeatmapPercentiles;
  dateRangeDays: number;
  estimatedTimeToMatchHours?: number;
  disclaimer: string;
}

export const MIN_OBSERVED_SAMPLE_THRESHOLD = 30;
export const LOOKBACK_WINDOW_DAYS = 180;

/**
 * Calculates 25th, 50th, and 75th percentiles from an array of BigInt values.
 */
export const calculatePercentiles = (values: bigint[]): HeatmapPercentiles => {
  if (values.length === 0) {
    return { p25: 0n, medianP50: 0n, p75: 0n };
  }

  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const count = sorted.length;

  const getIdx = (percentile: number) =>
    Math.min(count - 1, Math.max(0, Math.floor(count * percentile)));

  return {
    p25: sorted[getIdx(0.25)] ?? 0n,
    medianP50: sorted[getIdx(0.50)] ?? 0n,
    p75: sorted[getIdx(0.75)] ?? 0n,
  };
};

/**
 * Fallback heuristic estimate when observed data is under 30 jobs.
 * Uses category & risk priors without fabricating completed jobs.
 */
export const getHeuristicEstimate = (
  scopeSize: "small" | "standard" | "complex",
  riskTier: "low" | "standard" | "high"
): HeatmapPercentiles => {
  // Base atomic USDC amounts (6 decimals)
  let baseDeveloperAmount = 150_000_000n; // 150 USDC default
  if (scopeSize === "small") baseDeveloperAmount = 50_000_000n;
  if (scopeSize === "complex") baseDeveloperAmount = 800_000_000n;

  // Risk multiplier
  if (riskTier === "high") {
    baseDeveloperAmount = (baseDeveloperAmount * 15n) / 10n; // +50% for high risk
  } else if (riskTier === "low") {
    baseDeveloperAmount = (baseDeveloperAmount * 85n) / 100n; // -15% for bounded low risk
  }

  return {
    p25: (baseDeveloperAmount * 80n) / 100n,
    medianP50: baseDeveloperAmount,
    p75: (baseDeveloperAmount * 125n) / 100n,
  };
};

/**
 * Evaluates budget guidance according to Spec §4.2 invariants.
 */
export const calculateBudgetHeatmap = (
  historicalJobs: CompletedJobRecord[],
  request: BudgetHeatmapRequest
): Result<BudgetHeatmapResult> => {
  const referenceDate = request.referenceDate ?? new Date();
  const windowStart = new Date(
    referenceDate.getTime() - LOOKBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  // Filter comparable, verified, non-self-dealing completed jobs in trailing 180 days
  const comparableJobs = historicalJobs.filter(
    (job) =>
      job.categoryId === request.categoryId &&
      job.riskTier === request.riskTier &&
      job.scopeSize === request.scopeSize &&
      !job.isSelfDealingOrAbnormal &&
      job.completedAt >= windowStart &&
      job.completedAt <= referenceDate
  );

  const sampleCount = comparableJobs.length;
  const isReliable = sampleCount >= MIN_OBSERVED_SAMPLE_THRESHOLD;

  let percentiles: HeatmapPercentiles;
  let estimatedTimeToMatchHours: number | undefined;

  if (isReliable) {
    // 1. Observed real data
    const amounts = comparableJobs.map((j) => j.developerAmount);
    percentiles = calculatePercentiles(amounts);

    // Calculate median match time if available
    const matchTimes = comparableJobs
      .map((j) => j.matchDurationHours)
      .filter((t): t is number => typeof t === "number")
      .sort((a, b) => a - b);

    if (matchTimes.length >= MIN_OBSERVED_SAMPLE_THRESHOLD) {
      estimatedTimeToMatchHours =
        matchTimes[Math.floor(matchTimes.length / 2)];
    }
  } else {
    // 2. Insufficient data: use heuristic range and clearly label
    percentiles = getHeuristicEstimate(request.scopeSize, request.riskTier);
  }

  const result: BudgetHeatmapResult = {
    isReliableObservedData: isReliable,
    sampleCount,
    label: isReliable
      ? "Observed market data (trailing 180 days)"
      : "Estimated range — limited Quark data",
    currency: "USDC",
    ranges: {
      belowTypical: { max: percentiles.p25 },
      suggested: { min: percentiles.p25, max: percentiles.p75 },
      competitive: { min: percentiles.p75 },
    },
    percentiles,
    dateRangeDays: LOOKBACK_WINDOW_DAYS,
    estimatedTimeToMatchHours,
    disclaimer: isReliable
      ? `Based on ${sampleCount} completed paid deliveries. Higher budget does not guarantee delivery.`
      : "Model assumptions shown due to limited completed volume. Posting below or above suggested range is always permitted.",
  };

  return ok(result);
};
