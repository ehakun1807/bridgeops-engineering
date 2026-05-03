// ---------------------------------------------------------------------------
// taktMath — pure helpers for the Takt Study tool.
//
// Kept side-effect-free so the Jest suite (__tests__/taktMath.test.ts) can
// exercise them without mocking Firestore, React, or DOM. Anything that
// touches `auth`, `db`, hooks, or the network does NOT belong in this file.
//
// Vocabulary:
//   - observed time: raw stopwatch reading per cycle
//   - normalized time: observed × (rating / 100)   — Westinghouse-style rating
//   - standard time: normalized × (1 + allowance)  — adds PFD allowance
//   - takt time: net production seconds / customer demand per shift
//   - bottleneck: step with the highest standard time (the line constraint)
//   - CV: σ / μ across cycles for a step. > 0.25 ≈ unstable, more samples needed
// ---------------------------------------------------------------------------

export interface TaktInputsLite {
  shiftMin: number;
  breakMin: number;
  demand: number;
}

// Net production seconds per shift / units required → takt seconds per unit.
// Returns 0 on garbage input so callers can render '—' rather than NaN/Infinity.
export function computeTaktSec(i: TaktInputsLite): number {
  const available = (i.shiftMin - i.breakMin) * 60;
  if (!isFinite(available) || available <= 0 || i.demand <= 0) return 0;
  return available / i.demand;
}

// Sample mean of observed cycle times.
export function mean(values: number[]): number {
  if (!values || values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Sample standard deviation (n − 1 denominator). With n ≤ 1 there's no
// spread to measure, so return 0.
export function stdDev(values: number[]): number {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  const v =
    values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

// Coefficient of variation = σ / μ. Unitless dispersion measure used to
// flag unstable steps. 0 when mean is non-positive or fewer than 2 samples.
export function cv(values: number[]): number {
  const m = mean(values);
  if (m <= 0) return 0;
  return stdDev(values) / m;
}

// Performance-rated time. rating is a percentage; 100 = standard pace.
export function normalizedTime(observedSec: number, ratingPct: number): number {
  if (!isFinite(observedSec) || !isFinite(ratingPct)) return 0;
  return observedSec * (ratingPct / 100);
}

// Adds the PFD (Personal / Fatigue / Delay) allowance, in percent.
export function standardTime(
  normalizedSec: number,
  allowancePct: number
): number {
  if (!isFinite(normalizedSec) || !isFinite(allowancePct)) return 0;
  return normalizedSec * (1 + allowancePct / 100);
}

// ---------------------------------------------------------------------------
// Step-level convenience wrappers
// ---------------------------------------------------------------------------

export interface StepLike {
  observations: number[];
  rating: number;     // %, 100 = standard pace
  allowance: number;  // %, e.g. 12
}

export function stepMeanSec(s: StepLike): number {
  return mean(s.observations);
}

export function stepStdDevSec(s: StepLike): number {
  return stdDev(s.observations);
}

export function stepCv(s: StepLike): number {
  return cv(s.observations);
}

// Full IE pipeline for a single step.
export function stepStandardSec(s: StepLike): number {
  return standardTime(
    normalizedTime(stepMeanSec(s), s.rating),
    s.allowance
  );
}

// Bottleneck = step with highest standard time. Drives the verdict
// "your line constraint is X seconds" and the capacity sub-score.
export function bottleneckSec(steps: StepLike[]): number {
  if (!steps || steps.length === 0) return 0;
  return steps.reduce((m, s) => {
    const t = stepStandardSec(s);
    return t > m ? t : m;
  }, 0);
}

// Sum of all steps' standard times. Used for line-balance / staffing math.
export function totalCycleSec(steps: StepLike[]): number {
  if (!steps) return 0;
  return steps.reduce((sum, s) => sum + stepStandardSec(s), 0);
}

// ---------------------------------------------------------------------------
// Verdict math (Phase 3)
// ---------------------------------------------------------------------------

// Balance loss: how much capacity is wasted because the slowest step gates
// everyone else. 0 = perfectly balanced line; 1 = catastrophic imbalance.
// Formula: 1 − (average step standard time / bottleneck step standard time).
// Lean / IE textbooks call this "line balance loss" or "balance delay".
export function lineBalanceLoss(steps: StepLike[]): number {
  if (!steps || steps.length === 0) return 0;
  const total = totalCycleSec(steps);
  const bottleneck = bottleneckSec(steps);
  if (bottleneck <= 0) return 0;
  const avg = total / steps.length;
  return Math.max(0, 1 - avg / bottleneck);
}

export type CapacityStatus = 'green' | 'yellow' | 'red';

// Three-state verdict from bottleneck vs. takt:
//   - red:    bottleneck > takt → capacity short, ramp will not hit demand
//   - yellow: bottleneck within 10% of takt → tight, no headroom
//   - green:  ≥ 10% headroom (bottleneck ≤ 0.9 × takt)
// Yellow is also returned for "not enough info to tell" (zero takt or zero
// bottleneck) so the UI can render a neutral indicator without throwing.
export function capacityVerdict(
  bottleneckStandardSec: number,
  taktSec: number
): CapacityStatus {
  if (taktSec <= 0 || bottleneckStandardSec <= 0) return 'yellow';
  if (bottleneckStandardSec > taktSec) return 'red';
  if (bottleneckStandardSec <= taktSec * 0.9) return 'green';
  return 'yellow';
}

// ---------------------------------------------------------------------------
// Validation gates (Phase 3)
// ---------------------------------------------------------------------------

export interface ValidationGap {
  level: 'block' | 'warn';
  message: string;
}

export interface ValidationStep {
  name: string;
  observations: number[];
}

export interface ValidationOpts {
  minObservations?: number;   // hard gate (block) — default 5
  warnObservations?: number;  // soft gate (warn)  — default 10
  cvThreshold?: number;       // CV above this is a warning — default 0.25
}

// Returns the list of validation gaps that prevent (or merely warn against)
// marking the study completed. Empty list (or list with only warnings) =
// pass. Caller decides whether to block on warns; current UI only blocks
// on level === 'block'.
export function validateStudyForCompletion(
  steps: ValidationStep[],
  taktSec: number,
  opts: ValidationOpts = {}
): ValidationGap[] {
  const minObs = opts.minObservations ?? 5;
  const warnObs = opts.warnObservations ?? 10;
  const cvThreshold = opts.cvThreshold ?? 0.25;
  const gaps: ValidationGap[] = [];

  if (taktSec <= 0) {
    gaps.push({
      level: 'block',
      message: 'Set shift, breaks, and demand so a takt time can be calculated.'
    });
  }

  if (!steps || steps.length === 0) {
    gaps.push({
      level: 'block',
      message: 'Add at least one assembly step before completing.'
    });
    return gaps;
  }

  steps.forEach((s, i) => {
    const label = (s.name && s.name.trim()) || `Step ${i + 1}`;
    if (s.observations.length < minObs) {
      gaps.push({
        level: 'block',
        message: `${label}: needs ≥ ${minObs} cycle observations (currently ${s.observations.length}).`
      });
    } else if (s.observations.length < warnObs) {
      gaps.push({
        level: 'warn',
        message: `${label}: ${s.observations.length} cycles — ${warnObs}+ recommended for tighter confidence.`
      });
    }
    if (s.observations.length >= 2) {
      const c = cv(s.observations);
      if (c > cvThreshold) {
        gaps.push({
          level: 'warn',
          message: `${label}: high variability (CV ${(c * 100).toFixed(1)}%). Consider more cycles or splitting the step.`
        });
      }
    }
  });

  return gaps;
}

// Convenience: only block-level gaps. UI uses this to decide whether
// Complete should be allowed to proceed.
export function blockingGaps(gaps: ValidationGap[]): ValidationGap[] {
  return gaps.filter((g) => g.level === 'block');
}
