// ---------------------------------------------------------------------------
// Pure helpers for DocGuard PDF generation. Kept in a separate module with
// NO pdf-lib import so they're directly unit-testable without the runtime
// dependency. The main builder in utils/docGuardPdf.ts re-exports + uses
// these.
// ---------------------------------------------------------------------------

export type FindingCategory =
  | 'grammar'
  | 'gmp'
  | 'logic'
  | 'image'
  | 'numbering';
export type FindingSeverity = 'high' | 'medium' | 'low';

export interface Finding {
  page: number; // 1-indexed
  category: FindingCategory;
  severity: FindingSeverity;
  comment: string;
  quote?: string;
}

export interface AuditSummary {
  pageCount: number;
  overallVerdict: 'pass' | 'minor_issues' | 'major_issues';
  headline: string;
}

/**
 * Minimal duck-typed font interface — matches pdf-lib's PDFFont surface
 * we actually use, but keeps this module pdf-lib-free for test isolation.
 */
export interface TextSizer {
  widthOfTextAtSize(text: string, size: number): number;
}

/**
 * Wrap text into lines that fit within `maxWidth` at `fontSize`.
 * Greedy word-wrap, no hyphenation. If a single word exceeds maxWidth it's
 * hard-cut character-by-character so we never produce overflow.
 */
export function wrapText(
  text: string,
  font: TextSizer,
  fontSize: number,
  maxWidth: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
      // Word itself overflows — character-cut it.
      let buf = '';
      for (const ch of word) {
        if (font.widthOfTextAtSize(buf + ch, fontSize) <= maxWidth) {
          buf += ch;
        } else {
          if (buf) lines.push(buf);
          buf = ch;
        }
      }
      current = buf;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Group findings by 1-indexed page number. Order within a page is the input
 * order — useful for stable rendering and predictable tests.
 */
export function groupByPage(findings: Finding[]): Map<number, Finding[]> {
  const map = new Map<number, Finding[]>();
  for (const f of findings) {
    const arr = map.get(f.page) || [];
    arr.push(f);
    map.set(f.page, arr);
  }
  return map;
}

/**
 * Sort findings by severity (high > medium > low), then by page ascending.
 * Used by the summary page renderer.
 */
export function sortFindingsForSummary(findings: Finding[]): Finding[] {
  const sevOrder: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };
  return [...findings].sort((a, b) => {
    if (sevOrder[a.severity] !== sevOrder[b.severity]) {
      return sevOrder[a.severity] - sevOrder[b.severity];
    }
    return a.page - b.page;
  });
}
