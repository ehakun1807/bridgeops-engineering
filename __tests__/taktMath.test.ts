import {
  computeTaktSec,
  mean,
  stdDev,
  cv,
  normalizedTime,
  standardTime,
  stepMeanSec,
  stepStdDevSec,
  stepCv,
  stepStandardSec,
  bottleneckSec,
  totalCycleSec,
  lineBalanceLoss,
  capacityVerdict,
  validateStudyForCompletion,
  blockingGaps,
  StepLike
} from '../taktMath';

// Helper — expect numeric results within a small epsilon. Float math.
const close = (a: number, b: number, eps = 1e-6) =>
  Math.abs(a - b) <= eps;

const step = (
  observations: number[],
  rating = 100,
  allowance = 0
): StepLike => ({ observations, rating, allowance });

describe('taktMath', () => {
  // -------------------------------------------------------------------------
  describe('computeTaktSec', () => {
    it('returns net production seconds / demand', () => {
      // 480 min shift − 30 min breaks = 450 min = 27 000 s. /100 demand = 270 s.
      expect(computeTaktSec({ shiftMin: 480, breakMin: 30, demand: 100 })).toBe(
        270
      );
    });

    it('returns 0 on zero or negative demand', () => {
      expect(computeTaktSec({ shiftMin: 480, breakMin: 30, demand: 0 })).toBe(0);
      expect(computeTaktSec({ shiftMin: 480, breakMin: 30, demand: -5 })).toBe(0);
    });

    it('returns 0 when breaks ≥ shift (no available time)', () => {
      expect(
        computeTaktSec({ shiftMin: 480, breakMin: 480, demand: 100 })
      ).toBe(0);
      expect(
        computeTaktSec({ shiftMin: 60, breakMin: 90, demand: 100 })
      ).toBe(0);
    });

    it('handles fractional results', () => {
      // 480 − 30 = 450 min = 27 000 s. /333 demand ≈ 81.0810…
      const t = computeTaktSec({ shiftMin: 480, breakMin: 30, demand: 333 });
      expect(close(t, 27000 / 333)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('mean / stdDev / cv', () => {
    it('mean of empty array is 0, not NaN', () => {
      expect(mean([])).toBe(0);
    });

    it('mean computes the arithmetic average', () => {
      expect(mean([10, 20, 30])).toBe(20);
      expect(mean([5])).toBe(5);
    });

    it('stdDev returns 0 for n < 2', () => {
      expect(stdDev([])).toBe(0);
      expect(stdDev([42])).toBe(0);
    });

    it('stdDev uses sample (n − 1) denominator', () => {
      // [10, 20, 30] → mean 20; deviations 100,0,100; sum 200; /(n-1)=2 → 100; sqrt 10
      expect(close(stdDev([10, 20, 30]), 10)).toBe(true);
    });

    it('cv = σ / μ', () => {
      expect(close(cv([10, 20, 30]), 10 / 20)).toBe(true);
    });

    it('cv returns 0 when mean is 0 (avoids div/0)', () => {
      expect(cv([])).toBe(0);
      expect(cv([0, 0, 0])).toBe(0);
    });

    it('cv flags an unstable step at the classic 0.25 threshold', () => {
      // Highly variable cycle times → CV well above 0.25.
      const wild = cv([5, 30, 8, 22, 6]);
      expect(wild).toBeGreaterThan(0.25);
    });

    it('cv is small for a tight, stable step', () => {
      const tight = cv([12.0, 12.1, 11.9, 12.0, 12.2]);
      expect(tight).toBeLessThan(0.05);
    });
  });

  // -------------------------------------------------------------------------
  describe('normalizedTime / standardTime', () => {
    it('rating = 100 leaves observed time unchanged', () => {
      expect(normalizedTime(20, 100)).toBe(20);
    });

    it('rating > 100 increases normalized time (faster operator pads time up)', () => {
      // Westinghouse: a 110-rated worker is 10% faster than standard, so
      // their observed time is "shortened" — normalized time = observed × rating/100,
      // which gives a SMALLER number when rating < 100 and LARGER when > 100. We
      // follow the convention used by major IE textbooks.
      expect(normalizedTime(20, 110)).toBe(22);
    });

    it('allowance bumps time by the percentage', () => {
      expect(close(standardTime(20, 12), 22.4)).toBe(true);
      expect(standardTime(20, 0)).toBe(20);
    });

    it('handles non-finite inputs without producing NaN', () => {
      expect(normalizedTime(NaN, 100)).toBe(0);
      expect(standardTime(NaN, 12)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('step convenience wrappers', () => {
    const s = step([10, 11, 12], 100, 12);

    it('stepMeanSec wraps mean(observations)', () => {
      expect(stepMeanSec(s)).toBe(11);
    });

    it('stepStdDevSec wraps stdDev(observations)', () => {
      expect(close(stepStdDevSec(s), 1)).toBe(true);
    });

    it('stepCv wraps cv(observations)', () => {
      expect(close(stepCv(s), 1 / 11)).toBe(true);
    });

    it('stepStandardSec runs the full IE pipeline', () => {
      // mean=11, normalized=11×1.0=11, standard=11×1.12=12.32
      expect(close(stepStandardSec(s), 12.32)).toBe(true);
    });

    it('stepStandardSec with rating=120 and allowance=10', () => {
      const fast = step([10], 120, 10);
      // mean=10, normalized=12, standard=13.2
      expect(close(stepStandardSec(fast), 13.2)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('bottleneckSec / totalCycleSec', () => {
    it('returns 0 on empty step list', () => {
      expect(bottleneckSec([])).toBe(0);
      expect(totalCycleSec([])).toBe(0);
    });

    it('bottleneck = max standard time across steps', () => {
      const steps: StepLike[] = [
        step([10], 100, 0), // standard 10
        step([20], 100, 0), // standard 20
        step([15], 100, 0)  // standard 15
      ];
      expect(bottleneckSec(steps)).toBe(20);
    });

    it('totalCycleSec sums standard times', () => {
      const steps: StepLike[] = [
        step([10], 100, 0),
        step([20], 100, 0),
        step([15], 100, 0)
      ];
      expect(totalCycleSec(steps)).toBe(45);
    });

    it('respects allowance when picking the bottleneck', () => {
      // Step A has lower observed mean but a much bigger allowance, which
      // can push it past step B's standard time.
      const steps: StepLike[] = [
        step([18], 100, 30), // standard 18 × 1.30 = 23.4
        step([20], 100, 0)   // standard 20
      ];
      expect(bottleneckSec(steps)).toBeCloseTo(23.4, 5);
    });
  });

  // -------------------------------------------------------------------------
  describe('lineBalanceLoss', () => {
    it('returns 0 for an empty step list', () => {
      expect(lineBalanceLoss([])).toBe(0);
    });

    it('returns 0 for a perfectly balanced line', () => {
      const steps: StepLike[] = [
        step([10], 100, 0),
        step([10], 100, 0),
        step([10], 100, 0)
      ];
      expect(lineBalanceLoss(steps)).toBe(0);
    });

    it('rises with imbalance', () => {
      // Avg = (10+10+30)/3 = 16.67; bottleneck = 30; loss = 1 − 16.67/30 ≈ 0.444
      const steps: StepLike[] = [
        step([10], 100, 0),
        step([10], 100, 0),
        step([30], 100, 0)
      ];
      expect(lineBalanceLoss(steps)).toBeCloseTo(1 - 50 / 90, 5);
    });
  });

  // -------------------------------------------------------------------------
  describe('capacityVerdict', () => {
    it('green when bottleneck has ≥ 10% headroom under takt', () => {
      expect(capacityVerdict(80, 100)).toBe('green');
      expect(capacityVerdict(90, 100)).toBe('green');
    });

    it('yellow when within 10% of takt', () => {
      expect(capacityVerdict(95, 100)).toBe('yellow');
      expect(capacityVerdict(100, 100)).toBe('yellow');
    });

    it('red when bottleneck exceeds takt', () => {
      expect(capacityVerdict(101, 100)).toBe('red');
      expect(capacityVerdict(150, 100)).toBe('red');
    });

    it('yellow on missing data (avoids throwing)', () => {
      expect(capacityVerdict(0, 100)).toBe('yellow');
      expect(capacityVerdict(50, 0)).toBe('yellow');
    });
  });

  // -------------------------------------------------------------------------
  describe('validateStudyForCompletion', () => {
    const tightStep = (n: number) => ({
      name: 'Stable step',
      observations: Array.from({ length: n }, () => 10) // CV = 0
    });

    it('blocks when takt is 0', () => {
      const gaps = validateStudyForCompletion([tightStep(10)], 0);
      expect(gaps.some((g) => g.level === 'block' && /takt/i.test(g.message))).toBe(true);
    });

    it('blocks when there are no steps', () => {
      const gaps = validateStudyForCompletion([], 100);
      expect(gaps.some((g) => g.level === 'block' && /step/i.test(g.message))).toBe(true);
    });

    it('blocks when a step has < min observations', () => {
      const gaps = validateStudyForCompletion(
        [{ name: 'Pick part', observations: [10, 10] }],
        100
      );
      expect(blockingGaps(gaps).length).toBeGreaterThan(0);
    });

    it('warns (does not block) when between min and warn thresholds', () => {
      const gaps = validateStudyForCompletion([tightStep(7)], 100);
      // 7 ≥ 5 (min) but < 10 (warn) → only a warn-level gap
      expect(blockingGaps(gaps).length).toBe(0);
      expect(gaps.some((g) => g.level === 'warn')).toBe(true);
    });

    it('warns on high CV', () => {
      const gaps = validateStudyForCompletion(
        [{ name: 'Wild step', observations: [5, 30, 8, 22, 6, 28, 7, 25, 9, 20] }],
        100
      );
      expect(gaps.some((g) => g.level === 'warn' && /variability/i.test(g.message))).toBe(true);
    });

    it('passes cleanly with 10+ stable observations and a takt set', () => {
      const gaps = validateStudyForCompletion([tightStep(12)], 100);
      expect(blockingGaps(gaps).length).toBe(0);
      expect(gaps.length).toBe(0);
    });

    it('respects custom thresholds', () => {
      const gaps = validateStudyForCompletion([tightStep(3)], 100, {
        minObservations: 3,
        warnObservations: 5,
        cvThreshold: 0.5
      });
      expect(blockingGaps(gaps).length).toBe(0);
    });
  });
});
