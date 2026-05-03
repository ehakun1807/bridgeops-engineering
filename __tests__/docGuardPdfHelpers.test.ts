import {
  wrapText,
  groupByPage,
  sortFindingsForSummary,
  type Finding,
  type TextSizer
} from '@/utils/docGuardPdfHelpers';

/**
 * Mock font: each character is exactly `size` pixels wide. Lets us reason
 * about wrapping without depending on real Helvetica metrics.
 */
const monoFont: TextSizer = {
  widthOfTextAtSize: (text: string, size: number) => text.length * size
};

describe('wrapText', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(wrapText('', monoFont, 10, 100)).toEqual([]);
    expect(wrapText('   ', monoFont, 10, 100)).toEqual([]);
  });

  it('returns single line when text fits', () => {
    // "hello world" = 11 chars * 10 = 110 px. Width 200 fits.
    expect(wrapText('hello world', monoFont, 10, 200)).toEqual(['hello world']);
  });

  it('wraps on word boundaries', () => {
    // Each word "abcd" = 40px at size 10. Width 50 fits one word per line.
    const out = wrapText('abcd abcd abcd', monoFont, 10, 50);
    expect(out).toEqual(['abcd', 'abcd', 'abcd']);
  });

  it('packs multiple words when they fit', () => {
    // "ab cd" = 5 chars * 10 = 50px. Width 60 fits both.
    expect(wrapText('ab cd', monoFont, 10, 60)).toEqual(['ab cd']);
  });

  it('hard-cuts a single word that exceeds maxWidth', () => {
    // "abcdef" at size 10 = 60px. maxWidth 30 fits 3 chars.
    expect(wrapText('abcdef', monoFont, 10, 30)).toEqual(['abc', 'def']);
  });

  it('handles mixed long-word + short-word input', () => {
    // "ab" (20px), "longwordthatistoobig" (200px), "cd" (20px). Width 30.
    const out = wrapText('ab longwordthatistoobig cd', monoFont, 10, 30);
    // First "ab" fits alone; long word hard-cuts to chunks of 3; trailing
    // partial chunk continues, then "cd" appended where possible.
    expect(out[0]).toBe('ab');
    expect(out.slice(1).join('')).toContain('longwordthatistoobig');
  });
});

describe('groupByPage', () => {
  it('returns empty map for empty input', () => {
    expect(groupByPage([]).size).toBe(0);
  });

  it('groups by page and preserves input order within a page', () => {
    const findings: Finding[] = [
      { page: 1, category: 'grammar', severity: 'low', comment: 'a' },
      { page: 2, category: 'gmp', severity: 'high', comment: 'b' },
      { page: 1, category: 'logic', severity: 'medium', comment: 'c' },
      { page: 3, category: 'image', severity: 'low', comment: 'd' },
      { page: 1, category: 'numbering', severity: 'high', comment: 'e' }
    ];
    const grouped = groupByPage(findings);
    expect(grouped.size).toBe(3);
    expect(grouped.get(1)?.map((f) => f.comment)).toEqual(['a', 'c', 'e']);
    expect(grouped.get(2)?.map((f) => f.comment)).toEqual(['b']);
    expect(grouped.get(3)?.map((f) => f.comment)).toEqual(['d']);
  });
});

describe('sortFindingsForSummary', () => {
  it('sorts by severity (high > medium > low), then page asc', () => {
    const findings: Finding[] = [
      { page: 5, category: 'gmp', severity: 'low',    comment: 'A' },
      { page: 1, category: 'gmp', severity: 'medium', comment: 'B' },
      { page: 3, category: 'gmp', severity: 'high',   comment: 'C' },
      { page: 2, category: 'gmp', severity: 'high',   comment: 'D' },
      { page: 4, category: 'gmp', severity: 'low',    comment: 'E' }
    ];
    const out = sortFindingsForSummary(findings).map((f) => f.comment);
    // Highs first, sorted by page (2, 3); then medium (1); then lows (4, 5).
    expect(out).toEqual(['D', 'C', 'B', 'E', 'A']);
  });

  it('does not mutate input', () => {
    const findings: Finding[] = [
      { page: 2, category: 'gmp', severity: 'low',  comment: 'A' },
      { page: 1, category: 'gmp', severity: 'high', comment: 'B' }
    ];
    const before = JSON.stringify(findings);
    sortFindingsForSummary(findings);
    expect(JSON.stringify(findings)).toBe(before);
  });
});
