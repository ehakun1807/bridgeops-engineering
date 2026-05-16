// ---------------------------------------------------------------------------
// bomDiff.ts — Pure diff between two BOM snapshots.
//
// Identification hierarchy (per the product spec — the tool learns the
// user's internal numbering convention but works on raw MPN too):
//   1. internalPn  (preferred — user's house part number)
//   2. manufacturer + mpn  (fallback when internal PN missing)
//   3. mpn alone  (when manufacturer column not present on this line)
//   4. refDes  (last resort, mechanical / firmware BOMs without electrical IDs)
//
// A line that matches NONE of those keys can't participate in the diff and
// is silently dropped. The parser already enforces "must have at least one
// identifier", so this should be rare in practice.
//
// Change detection is field-level. We classify each survivor pair into the
// set of ChangeKinds that differ (often multiple per line — e.g. a supplier
// swap typically changes mpn, manufacturer, AND cost together). The Tool +
// the AI Impact handler consume the full kind list so they can reason about
// the *kind* of change, not just the fact one happened.
// ---------------------------------------------------------------------------

import type { BomLine } from './bomParser.ts';

export type ChangeKind =
  | 'qty'
  | 'mpn'
  | 'manufacturer'
  | 'description'
  | 'cost'
  | 'refDes'
  | 'package'
  | 'level'
  | 'rev';

export interface BomLineChange {
  /** Line as it appeared in the baseline BOM. */
  before: BomLine;
  /** Line as it appears in the current BOM. */
  after: BomLine;
  /** Set of fields that differ between before and after (≥1 by construction). */
  kinds: ChangeKind[];
  /**
   * Which key matched the two lines (audit / debug). Helps the UI tell
   * "matched by internal PN" vs "matched by MPN" vs "matched by refDes" so
   * a user can spot bad matches.
   */
  matchedBy: 'internalPn' | 'mfrMpn' | 'mpn' | 'refDes';
}

export interface BomDiffSummary {
  totalBefore: number;
  totalAfter: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  /** Sum of qty deltas for changed lines (positive = more total parts). */
  qtyDelta: number;
  /**
   * Net cost delta on changed lines, where both before & after have unit cost.
   * Skips pairs missing either side — never invent missing costs.
   */
  costDelta: number;
  /** Count of changed lines that include a `manufacturer` or `mpn` kind. */
  supplierSwapCount: number;
}

export interface BomDiff {
  added: BomLine[];
  removed: BomLine[];
  changed: BomLineChange[];
  summary: BomDiffSummary;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function norm(v: string | undefined): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function keyInternalPn(l: BomLine): string | undefined {
  const v = norm(l.internalPn);
  return v ? `ipn:${v}` : undefined;
}

function keyMfrMpn(l: BomLine): string | undefined {
  const m = norm(l.manufacturer);
  const p = norm(l.mpn);
  if (m && p) return `mfrmpn:${m}|${p}`;
  return undefined;
}

function keyMpn(l: BomLine): string | undefined {
  const p = norm(l.mpn);
  return p ? `mpn:${p}` : undefined;
}

function keyRefDes(l: BomLine): string | undefined {
  // Normalize: split on commas / semicolons / spaces, sort, rejoin — so
  // "U1, U2" matches "U2, U1". This is a heuristic; if a refDes-only line
  // changes from {U1} → {U1, U2}, that's a "qty" change which a user might
  // also encode as a separate row. The diff is best-effort either way.
  const raw = norm(l.refDes);
  if (!raw) return undefined;
  const tokens = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return tokens.length > 0 ? `rd:${tokens.join(',')}` : undefined;
}

interface KeyedLine {
  line: BomLine;
  internalPn?: string;
  mfrMpn?: string;
  mpn?: string;
  refDes?: string;
}

function indexLines(lines: BomLine[]): KeyedLine[] {
  return lines.map((line) => ({
    line,
    internalPn: keyInternalPn(line),
    mfrMpn: keyMfrMpn(line),
    mpn: keyMpn(line),
    refDes: keyRefDes(line)
  }));
}

// Build a map keyed by the first non-empty key in priority order. On
// collision we keep the first occurrence and silently skip duplicates —
// the assumption is "one row per part" in a BOM. Returns both the index
// AND a parallel matched-flag array so the diff can mark consumed lines.
interface IndexMaps {
  byInternalPn: Map<string, number>;
  byMfrMpn: Map<string, number>;
  byMpn: Map<string, number>;
  byRefDes: Map<string, number>;
  matched: boolean[];
}

function buildIndex(keyed: KeyedLine[]): IndexMaps {
  const byInternalPn = new Map<string, number>();
  const byMfrMpn = new Map<string, number>();
  const byMpn = new Map<string, number>();
  const byRefDes = new Map<string, number>();
  keyed.forEach((k, i) => {
    if (k.internalPn && !byInternalPn.has(k.internalPn)) byInternalPn.set(k.internalPn, i);
    if (k.mfrMpn && !byMfrMpn.has(k.mfrMpn)) byMfrMpn.set(k.mfrMpn, i);
    if (k.mpn && !byMpn.has(k.mpn)) byMpn.set(k.mpn, i);
    if (k.refDes && !byRefDes.has(k.refDes)) byRefDes.set(k.refDes, i);
  });
  return {
    byInternalPn,
    byMfrMpn,
    byMpn,
    byRefDes,
    matched: new Array(keyed.length).fill(false)
  };
}

/**
 * Try to find a baseline match for a current line. Walks keys in priority
 * order; first hit wins. Returns the matched baseline index and which key
 * type produced the match.
 */
function findMatch(
  current: KeyedLine,
  idx: IndexMaps
): { baselineIdx: number; matchedBy: BomLineChange['matchedBy'] } | null {
  if (current.internalPn) {
    const h = idx.byInternalPn.get(current.internalPn);
    if (h !== undefined && !idx.matched[h]) return { baselineIdx: h, matchedBy: 'internalPn' };
  }
  if (current.mfrMpn) {
    const h = idx.byMfrMpn.get(current.mfrMpn);
    if (h !== undefined && !idx.matched[h]) return { baselineIdx: h, matchedBy: 'mfrMpn' };
  }
  if (current.mpn) {
    const h = idx.byMpn.get(current.mpn);
    if (h !== undefined && !idx.matched[h]) return { baselineIdx: h, matchedBy: 'mpn' };
  }
  if (current.refDes) {
    const h = idx.byRefDes.get(current.refDes);
    if (h !== undefined && !idx.matched[h]) return { baselineIdx: h, matchedBy: 'refDes' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field-level change detection
// ---------------------------------------------------------------------------

function strEq(a: string | undefined, b: string | undefined): boolean {
  return norm(a) === norm(b);
}

function refDesEq(a: string | undefined, b: string | undefined): boolean {
  // Tokenized sort compare (same as the key) so we don't false-positive on
  // re-ordered designator lists.
  const tokA = norm(a).split(/[,;\s]+/).filter(Boolean).sort();
  const tokB = norm(b).split(/[,;\s]+/).filter(Boolean).sort();
  if (tokA.length !== tokB.length) return false;
  return tokA.every((t, i) => t === tokB[i]);
}

function costEq(a: number | undefined, b: number | undefined): boolean {
  // Treat both-missing as equal (no cost data to compare). Mismatched
  // presence = changed (so user sees the gap).
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  // 0.001 tolerance — floating-point noise from currency rounding.
  return Math.abs(a - b) < 0.001;
}

function classifyChanges(before: BomLine, after: BomLine): ChangeKind[] {
  const kinds: ChangeKind[] = [];
  if (before.qty !== after.qty) kinds.push('qty');
  if (!strEq(before.mpn, after.mpn)) kinds.push('mpn');
  if (!strEq(before.manufacturer, after.manufacturer)) kinds.push('manufacturer');
  if (!strEq(before.description, after.description)) kinds.push('description');
  if (!costEq(before.unitCost, after.unitCost)) kinds.push('cost');
  if (!refDesEq(before.refDes, after.refDes)) kinds.push('refDes');
  if (!strEq(before.package, after.package)) kinds.push('package');
  // Multi-level BOM: surface re-parenting. Treat both-missing as equal so
  // flat BOMs (no level column) don't generate spurious change-kinds.
  if ((before.bomLevel ?? null) !== (after.bomLevel ?? null)) kinds.push('level');
  // Revision — a rev bump on a part or document is a design/process change
  // even if no other normalized field changed (e.g. mechanical drawing update,
  // work instruction re-release). Treat both-missing as equal so BOMs without
  // a rev column don't generate spurious changes.
  if (before.rev !== undefined || after.rev !== undefined) {
    if (!strEq(before.rev, after.rev)) kinds.push('rev');
  }
  return kinds;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function diffBoms(baseline: BomLine[], current: BomLine[]): BomDiff {
  const baselineKeyed = indexLines(baseline);
  const currentKeyed = indexLines(current);
  const idx = buildIndex(baselineKeyed);

  const added: BomLine[] = [];
  const changed: BomLineChange[] = [];

  for (const c of currentKeyed) {
    const match = findMatch(c, idx);
    if (!match) {
      added.push(c.line);
      continue;
    }
    idx.matched[match.baselineIdx] = true;
    const before = baseline[match.baselineIdx];
    const after = c.line;
    const kinds = classifyChanges(before, after);
    if (kinds.length > 0) {
      changed.push({ before, after, kinds, matchedBy: match.matchedBy });
    }
    // Lines that matched cleanly with no kind changes are silent — they're
    // the same line, no need to surface them.
  }

  const removed: BomLine[] = [];
  baselineKeyed.forEach((b, i) => {
    if (!idx.matched[i]) removed.push(b.line);
  });

  // Summary stats
  let qtyDelta = 0;
  let costDelta = 0;
  let supplierSwapCount = 0;
  for (const ch of changed) {
    qtyDelta += (ch.after.qty || 0) - (ch.before.qty || 0);
    if (ch.before.unitCost !== undefined && ch.after.unitCost !== undefined) {
      costDelta +=
        (ch.after.unitCost - ch.before.unitCost) * Math.max(1, ch.after.qty || 1);
    }
    if (ch.kinds.includes('manufacturer') || ch.kinds.includes('mpn')) supplierSwapCount++;
  }
  // Add cost of added / removed lines too — those are real cost movements.
  for (const a of added) {
    if (a.unitCost !== undefined) costDelta += a.unitCost * Math.max(1, a.qty || 1);
  }
  for (const r of removed) {
    if (r.unitCost !== undefined) costDelta -= r.unitCost * Math.max(1, r.qty || 1);
  }

  return {
    added,
    removed,
    changed,
    summary: {
      totalBefore: baseline.length,
      totalAfter: current.length,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      qtyDelta,
      costDelta: Math.round(costDelta * 100) / 100,
      supplierSwapCount
    }
  };
}

/**
 * Short human label for a ChangeKind — used in lists and AI prompts.
 */
export function changeKindLabel(k: ChangeKind): string {
  switch (k) {
    case 'qty': return 'Qty';
    case 'mpn': return 'MPN';
    case 'manufacturer': return 'Manufacturer';
    case 'description': return 'Description';
    case 'cost': return 'Unit Cost';
    case 'refDes': return 'Ref Des';
    case 'package': return 'Package';
    case 'level': return 'BOM Level';
    case 'rev': return 'Revision';
  }
}
