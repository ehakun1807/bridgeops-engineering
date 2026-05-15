import { diffBoms, changeKindLabel, type ChangeKind } from '../bomDiff';
import type { BomLine } from '../bomParser';

const line = (overrides: Partial<BomLine> = {}): BomLine => ({
  qty: 1,
  raw: {},
  ...overrides
});

describe('bomDiff - empty / pure cases', () => {
  it('returns empty diff for two empty BOMs', () => {
    const d = diffBoms([], []);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });

  it('all baseline lines = removed when current is empty', () => {
    const baseline = [
      line({ internalPn: 'A-1', mpn: 'X', qty: 1 }),
      line({ internalPn: 'A-2', mpn: 'Y', qty: 2 })
    ];
    const d = diffBoms(baseline, []);
    expect(d.removed).toHaveLength(2);
    expect(d.added).toHaveLength(0);
    expect(d.summary.removedCount).toBe(2);
  });

  it('all current lines = added when baseline is empty', () => {
    const current = [line({ internalPn: 'A-1' }), line({ internalPn: 'A-2' })];
    const d = diffBoms([], current);
    expect(d.added).toHaveLength(2);
    expect(d.removed).toHaveLength(0);
    expect(d.summary.addedCount).toBe(2);
  });
});

describe('bomDiff - matching by internal PN (preferred key)', () => {
  it('matches by internalPn even when MPN changes', () => {
    const baseline = [line({ internalPn: 'ACME-1', mpn: 'OLD-MPN', qty: 5 })];
    const current = [line({ internalPn: 'ACME-1', mpn: 'NEW-MPN', qty: 5 })];
    const d = diffBoms(baseline, current);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].kinds).toContain('mpn');
    expect(d.changed[0].matchedBy).toBe('internalPn');
    expect(d.summary.supplierSwapCount).toBe(1);
  });

  it('case-insensitive internalPn match', () => {
    const d = diffBoms(
      [line({ internalPn: 'acme-1', qty: 1 })],
      [line({ internalPn: 'ACME-1', qty: 2 })]
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].kinds).toEqual(['qty']);
  });
});

describe('bomDiff - matching fallbacks', () => {
  it('falls through to manufacturer+mpn when internalPn missing', () => {
    const baseline = [line({ manufacturer: 'ST', mpn: 'STM32F407', qty: 1 })];
    const current = [line({ manufacturer: 'ST', mpn: 'STM32F407', qty: 2 })];
    const d = diffBoms(baseline, current);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].matchedBy).toBe('mfrMpn');
    expect(d.changed[0].kinds).toEqual(['qty']);
  });

  it('falls through to mpn alone when manufacturer missing', () => {
    const d = diffBoms(
      [line({ mpn: 'STM32F407', qty: 1 })],
      [line({ mpn: 'STM32F407', qty: 3 })]
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].matchedBy).toBe('mpn');
  });

  it('falls through to refDes as last resort', () => {
    const d = diffBoms(
      [line({ refDes: 'U1', description: 'old', qty: 1 })],
      [line({ refDes: 'U1', description: 'new', qty: 1 })]
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].matchedBy).toBe('refDes');
    expect(d.changed[0].kinds).toEqual(['description']);
  });

  it('refDes matching is order-invariant', () => {
    const d = diffBoms(
      [line({ refDes: 'U1, U2', qty: 1 })],
      [line({ refDes: 'U2, U1', qty: 1 })]
    );
    expect(d.changed).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.added).toHaveLength(0);
  });
});

describe('bomDiff - change classification', () => {
  it('flags supplier swap as multiple kinds (mpn + manufacturer + cost)', () => {
    const d = diffBoms(
      [
        line({
          internalPn: 'ACME-1',
          mpn: 'OLD',
          manufacturer: 'OldCo',
          unitCost: 1.0,
          qty: 1
        })
      ],
      [
        line({
          internalPn: 'ACME-1',
          mpn: 'NEW',
          manufacturer: 'NewCo',
          unitCost: 1.5,
          qty: 1
        })
      ]
    );
    expect(d.changed).toHaveLength(1);
    const kinds = d.changed[0].kinds.sort();
    expect(kinds).toEqual<ChangeKind[]>(['cost', 'manufacturer', 'mpn']);
    expect(d.summary.supplierSwapCount).toBe(1);
  });

  it('detects package and description changes', () => {
    const d = diffBoms(
      [line({ internalPn: 'A', description: 'old desc', package: '0603' })],
      [line({ internalPn: 'A', description: 'new desc', package: '0402' })]
    );
    expect(d.changed[0].kinds.sort()).toEqual<ChangeKind[]>(['description', 'package']);
  });

  it('does not flag whitespace-only differences', () => {
    const d = diffBoms(
      [line({ internalPn: 'A', mpn: 'X1' })],
      [line({ internalPn: 'A', mpn: '  X1  ' })]
    );
    expect(d.changed).toHaveLength(0);
  });

  it('tolerates floating-point cost noise (< 0.001)', () => {
    const d = diffBoms(
      [line({ internalPn: 'A', unitCost: 1.0 })],
      [line({ internalPn: 'A', unitCost: 1.0001 })]
    );
    expect(d.changed).toHaveLength(0);
  });

  it('treats missing-vs-present cost as a change', () => {
    const d = diffBoms(
      [line({ internalPn: 'A' })],
      [line({ internalPn: 'A', unitCost: 1.0 })]
    );
    expect(d.changed[0].kinds).toEqual(['cost']);
  });
});

describe('bomDiff - summary stats', () => {
  it('computes qty delta on changed lines', () => {
    const d = diffBoms(
      [line({ internalPn: 'A', qty: 5 }), line({ internalPn: 'B', qty: 3 })],
      [line({ internalPn: 'A', qty: 10 }), line({ internalPn: 'B', qty: 1 })]
    );
    expect(d.summary.qtyDelta).toBe(5 + -2);
  });

  it('cost delta includes added lines + subtracts removed lines', () => {
    const d = diffBoms(
      [line({ internalPn: 'X', qty: 2, unitCost: 5.0 })],
      [line({ internalPn: 'Y', qty: 3, unitCost: 2.0 })]
    );
    // Removed: -10.00, Added: +6.00 → net -4.00
    expect(d.summary.costDelta).toBe(-4.0);
  });

  it('totals reflect input lengths', () => {
    const d = diffBoms(
      [line({ internalPn: 'A' }), line({ internalPn: 'B' })],
      [line({ internalPn: 'A' }), line({ internalPn: 'C' }), line({ internalPn: 'D' })]
    );
    expect(d.summary.totalBefore).toBe(2);
    expect(d.summary.totalAfter).toBe(3);
    expect(d.summary.addedCount).toBe(2);
    expect(d.summary.removedCount).toBe(1);
  });
});

describe('bomDiff - changeKindLabel', () => {
  it('produces human labels', () => {
    expect(changeKindLabel('qty')).toBe('Qty');
    expect(changeKindLabel('mpn')).toBe('MPN');
    expect(changeKindLabel('cost')).toBe('Unit Cost');
    expect(changeKindLabel('refDes')).toBe('Ref Des');
    expect(changeKindLabel('level')).toBe('BOM Level');
  });
});

describe('bomDiff - multi-level (bomLevel) handling', () => {
  it('detects level changes (re-parenting) as a kind', () => {
    const d = diffBoms(
      [line({ internalPn: 'ACME-1', bomLevel: 2 })],
      [line({ internalPn: 'ACME-1', bomLevel: 3 })]
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].kinds).toContain('level');
  });

  it('does NOT flag level when both sides are undefined (flat BOM)', () => {
    const d = diffBoms(
      [line({ internalPn: 'ACME-1' })],
      [line({ internalPn: 'ACME-1' })]
    );
    expect(d.changed).toHaveLength(0);
  });

  it('flags level when one side has it and the other does not', () => {
    const d = diffBoms(
      [line({ internalPn: 'A' })],
      [line({ internalPn: 'A', bomLevel: 2 })]
    );
    expect(d.changed[0].kinds).toEqual<ChangeKind[]>(['level']);
  });

  it('matches by internalPn even when part moved between assemblies', () => {
    // Same part, moved from L3 under sub-assembly A to L3 under sub-assembly B.
    // Should match — not show as added + removed.
    const d = diffBoms(
      [line({ internalPn: 'SCREW-001', bomLevel: 3, qty: 4 })],
      [line({ internalPn: 'SCREW-001', bomLevel: 3, qty: 4 })]
    );
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });
});
