// ---------------------------------------------------------------------------
// bomParser.ts — Pure xlsx / csv → normalized BOM line parser.
//
// Design goals:
//   - Flexible column conventions. Different teams use different headers
//     for "internal part number" (Internal PN, House PN, Company PN, ACME PN,
//     PartNumber). We auto-detect via heuristics, then let the user confirm
//     or override the mapping. The chosen mapping is persisted on the
//     project doc (`project.bomColumnMap`) so subsequent uploads to the
//     SAME project apply it silently — the tool "learns" the convention.
//
//   - Raw row preservation. Every parsed BomLine carries a `raw` map of all
//     original columns. The AI Impact handler can look at fields we didn't
//     normalize (e.g. RoHS status, lead-time, alt-source flags) when
//     reasoning about ramp readiness implications.
//
//   - No UI deps. This file is pure TypeScript + xlsx. Importable from the
//     React tool, from the API handler, and from Jest tests.
//
// Pairs with bomDiff.ts (consumes BomLine[]) and ProductBomTool.tsx (drives
// the upload + mapping-confirmation UI).
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Normalized BOM line. Every field except `qty` is optional because real BOMs
 * are messy — some projects use only an internal PN, some only an MPN, some
 * have no refDes (mechanical assemblies), etc. The diff engine handles
 * missing values gracefully via a key-fallback hierarchy.
 *
 * Strings are normalized (trim + collapse whitespace) but not aggressively
 * (e.g. case is preserved — "10K" vs "10k" is meaningful for MPNs).
 */
export interface BomLine {
  /**
   * Indent level in a multi-level (indented) BOM. 1 = top-level assembly,
   * 2 = sub-assembly, 3 = sub-sub, etc. Optional — flat BOMs leave it
   * undefined and the tool treats every line as a peer.
   *
   * The diff engine matches lines by identifier regardless of level, so a
   * part that moved between sub-assemblies isn't lost; a `level` ChangeKind
   * surfaces the re-parenting separately.
   */
  bomLevel?: number;
  /** User's internal / house part number (e.g. ACME-1234). Preferred diff key. */
  internalPn?: string;
  /** Manufacturer part number (e.g. STM32F407VGT6). */
  mpn?: string;
  /** Manufacturer name (e.g. ST Microelectronics). */
  manufacturer?: string;
  /** Free-text description. */
  description?: string;
  /** Reference designators (e.g. "U1, U2, R4-R7"). */
  refDes?: string;
  /** Quantity per assembly. */
  qty: number;
  /** Unit cost (USD assumed; rendered raw). */
  unitCost?: number;
  /** Package / footprint (e.g. 0603, LQFP-100). */
  package?: string;
  /** Part / document revision (e.g. "B", "C  ECO2600003", "v1.2"). */
  rev?: string;
  /** Original row values keyed by header. Preserved for AI analysis. */
  raw: Record<string, string>;
}

/**
 * Maps a semantic BOM field to the source column header. Values are the
 * actual header strings from the user's spreadsheet, so they round-trip
 * cleanly when stored on the project doc and replayed on the next upload.
 *
 * All fields optional — a BOM with only MPN + Qty is valid; the diff engine
 * falls back through the key hierarchy.
 */
export interface ColumnMapping {
  /** Source column holding the indent level (1, 2, 3, ...) for multi-level BOMs. */
  bomLevel?: string;
  internalPn?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  refDes?: string;
  qty?: string;
  unitCost?: string;
  package?: string;
  rev?: string;
}

/** Output of the first parse pass. */
export interface ParseResult {
  /** Header strings as they appeared (trimmed). */
  headers: string[];
  /** Each row as a map of { header → cell value }. Empty rows already dropped. */
  rawRows: Record<string, string>[];
  /** Heuristic-detected mapping. May be partial. User can override. */
  suggestedMapping: ColumnMapping;
  /** Soft warnings ("multiple candidates for X", "no qty column found", etc.). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Header heuristics. Order matters — more specific patterns first so e.g.
// "Manufacturer Part Number" hits the MPN bucket before the Manufacturer
// bucket. Each pattern matches a normalized header (lower-cased, collapsed
// whitespace, stripped punctuation).
// ---------------------------------------------------------------------------

interface HeuristicPattern {
  field: keyof ColumnMapping;
  /** Match against the *normalized* header. */
  test: (norm: string) => boolean;
  /** Higher wins on ties. */
  priority: number;
}

function normHeader(h: string): string {
  return String(h || '')
    .toLowerCase()
    .replace(/[._\-/]/g, ' ')
    .replace(/[#$()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Each pattern's priority lets us disambiguate when multiple regexes match.
// Internal PN > MPN > generic "part number" so a BOM with both "Internal PN"
// AND "Part Number" maps Internal PN to internalPn and Part Number to mpn.
const HEURISTICS: HeuristicPattern[] = [
  // BOM Level (multi-level / indented BOMs). High priority on the exact
  // phrases since "Level" alone could collide with other domain headers.
  {
    field: 'bomLevel',
    priority: 95,
    test: (n) => /^(bom level|indent level|level number|lvl)$/.test(n)
  },
  { field: 'bomLevel', priority: 80, test: (n) => /^(level|indent)$/.test(n) },
  { field: 'bomLevel', priority: 70, test: (n) => /\b(bom level|indent level)\b/.test(n) },

  // Internal / House PN — high priority because users explicitly want this.
  {
    field: 'internalPn',
    priority: 100,
    test: (n) =>
      /\b(internal|house|company|in house)\b/.test(n) &&
      /\b(p ?n|part|number|num|no|item|id)\b/.test(n)
  },
  // Generic "internal PN" / "house PN" without spaces (e.g. "InternalPN").
  {
    field: 'internalPn',
    priority: 95,
    test: (n) => /\b(internal pn|house pn|company pn|inhouse pn)\b/.test(n)
  },
  // Site-specific abbreviations like "ACME PN" / "FOO PN" — any 3-6 letter
  // prefix followed by PN/part-number suggests an internal numbering system.
  {
    field: 'internalPn',
    priority: 60,
    test: (n) => /^[a-z]{2,8} (pn|part number|part no|part num)$/.test(n)
  },
  // Bare "Number" / "Item Number" / "Doc Number" — the standard export column
  // name from Agile PLM, Arena, Windchill, and similar systems. Intentionally
  // low priority (40) so more specific patterns always win, but high enough to
  // catch PLM exports where "Number" IS the internal part number.
  {
    field: 'internalPn',
    priority: 40,
    test: (n) => /^(number|item number|item no|item num|doc number|part no\.|item id)$/.test(n)
  },

  // MPN — most specific first.
  {
    field: 'mpn',
    priority: 90,
    test: (n) =>
      /\b(manufacturer|mfr|mfg|vendor|supplier)\b/.test(n) &&
      /\b(p ?n|part|number|num|no)\b/.test(n)
  },
  // Bare "MPN" / "MPN#" / "M P N".
  { field: 'mpn', priority: 85, test: (n) => /\bmpn\b/.test(n) || /^m p n$/.test(n) },
  // Bare "Part Number" / "Part No" — falls into MPN as the universal fallback
  // (the internalPn heuristics above grab the user-internal ones first).
  {
    field: 'mpn',
    priority: 50,
    test: (n) => /^(part number|part num|part no|part)$/.test(n)
  },

  // Manufacturer name.
  {
    field: 'manufacturer',
    priority: 90,
    test: (n) => /^(manufacturer|mfr|mfg|vendor|supplier|brand|maker)$/.test(n)
  },
  {
    field: 'manufacturer',
    priority: 70,
    test: (n) =>
      /\b(manufacturer|mfr|mfg|vendor|supplier|brand|maker)\b/.test(n) &&
      !/\b(p ?n|part|number|num|no)\b/.test(n)
  },

  // Description.
  {
    field: 'description',
    priority: 80,
    test: (n) => /^(description|desc|part description|item description)$/.test(n)
  },
  { field: 'description', priority: 50, test: (n) => /\bdescription\b/.test(n) },

  // RefDes.
  {
    field: 'refDes',
    priority: 90,
    test: (n) =>
      /\b(ref des|refdes|reference designator|reference designators|designator|designators|location)\b/.test(
        n
      )
  },
  { field: 'refDes', priority: 70, test: (n) => /^(ref|reference)$/.test(n) },

  // Quantity.
  { field: 'qty', priority: 90, test: (n) => /^(qty|quantity|qnty|q t y|qua)$/.test(n) },
  { field: 'qty', priority: 60, test: (n) => /\b(qty|quantity)\b/.test(n) },

  // Unit cost.
  {
    field: 'unitCost',
    priority: 85,
    test: (n) => /^(unit cost|unit price|unit \$|cost ea|price ea|usd ea|cost each)$/.test(n)
  },
  { field: 'unitCost', priority: 60, test: (n) => /^(cost|price|unit)$/.test(n) },

  // Package / footprint.
  {
    field: 'package',
    priority: 80,
    test: (n) => /^(package|footprint|case|pkg|pkg type|smd case)$/.test(n)
  },
  { field: 'package', priority: 50, test: (n) => /\b(package|footprint)\b/.test(n) },

  // Revision — part / document revision letter or version string.
  // Exact matches are high priority; "Rev" alone is very common in PLM exports
  // (Agile, Arena, Windchill all use "Rev"). "Version" / "Ver" at lower priority
  // since they can collide with software version fields.
  {
    field: 'rev',
    priority: 88,
    test: (n) => /^(rev|revision|rev number|revision number|rev letter|rev level)$/.test(n)
  },
  {
    field: 'rev',
    priority: 70,
    test: (n) => /^(ver|version|release|rel)$/.test(n)
  },
  {
    field: 'rev',
    priority: 55,
    test: (n) => /\b(revision|rev)\b/.test(n) && !/\b(release date|date)\b/.test(n)
  }
];

// ---------------------------------------------------------------------------
// Detect a column mapping from a list of headers. Pure — no side effects.
// Returns the best-priority match per semantic field.
// ---------------------------------------------------------------------------

interface DetectResult {
  mapping: ColumnMapping;
  warnings: string[];
}

export function detectColumnMapping(headers: string[]): DetectResult {
  const warnings: string[] = [];
  // For each field, track the best (priority, header) match seen.
  const best: Partial<Record<keyof ColumnMapping, { priority: number; header: string }>> = {};
  // Also track conflicts (multiple matches at same priority) so we can warn.
  const seenHeaders = new Set<string>();

  for (const header of headers) {
    const norm = normHeader(header);
    if (!norm) continue;
    // Walk patterns; allow each header to claim at most ONE field (its highest
    // priority match) so a header doesn't get double-mapped.
    let bestForHeader: { field: keyof ColumnMapping; priority: number } | null = null;
    for (const p of HEURISTICS) {
      if (!p.test(norm)) continue;
      if (!bestForHeader || p.priority > bestForHeader.priority) {
        bestForHeader = { field: p.field, priority: p.priority };
      }
    }
    if (!bestForHeader) continue;
    if (seenHeaders.has(header)) continue;
    seenHeaders.add(header);
    const cur = best[bestForHeader.field];
    if (!cur || bestForHeader.priority > cur.priority) {
      if (cur) {
        warnings.push(
          `Multiple columns matched "${bestForHeader.field}" — using "${header}" over "${cur.header}".`
        );
      }
      best[bestForHeader.field] = { priority: bestForHeader.priority, header };
    } else if (bestForHeader.priority === cur.priority) {
      warnings.push(
        `Two columns matched "${bestForHeader.field}" equally well: "${cur.header}" vs "${header}" — keeping the first.`
      );
    }
  }

  const mapping: ColumnMapping = {};
  for (const k of Object.keys(best) as (keyof ColumnMapping)[]) {
    const v = best[k];
    if (v) mapping[k] = v.header;
  }

  // Soft sanity: we always need *something* to identify a line. Internal PN
  // or MPN is enough; if both missing, surface a warning so the UI prompts
  // the user.
  if (!mapping.internalPn && !mapping.mpn) {
    warnings.push(
      'No internal part-number or MPN column detected. Pick one in the mapping panel before saving.'
    );
  }
  if (!mapping.qty) {
    warnings.push(
      'No quantity column detected. Quantity will default to 1 for every line — verify in the mapping panel.'
    );
  }

  return { mapping, warnings };
}

// ---------------------------------------------------------------------------
// File → ParseResult. Handles xlsx, xls, and csv (csv is parsed via xlsx's
// own csv reader so it goes through the same code path as the spreadsheets).
// Throws on unrecoverable errors (no sheets, all rows empty). Soft issues
// surface in ParseResult.warnings.
// ---------------------------------------------------------------------------

export async function parseBomFile(file: File): Promise<ParseResult> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', raw: false });

  // Pick the first non-empty sheet.
  let sheetName: string | undefined;
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (ws && Object.keys(ws).some((k) => !k.startsWith('!'))) {
      sheetName = name;
      break;
    }
  }
  if (!sheetName) throw new Error('No data sheets found in file.');

  const worksheet = workbook.Sheets[sheetName];

  // sheet_to_json with header:1 returns array-of-arrays preserving order;
  // we find the header row ourselves (first row with ≥2 non-empty cells).
  const aoa = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: ''
  });

  if (!Array.isArray(aoa) || aoa.length === 0) {
    throw new Error('File appears to be empty.');
  }

  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const row = aoa[i] || [];
    const nonEmpty = row.filter((c) => c !== undefined && String(c).trim() !== '').length;
    if (nonEmpty >= 2) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('Could not find a header row (need at least 2 non-empty columns).');
  }

  const headerRow = aoa[headerIdx];
  const headers: string[] = headerRow.map((c, i) => {
    const s = String(c ?? '').trim();
    return s || `Column ${i + 1}`;
  });

  // Build raw row maps.
  const rawRows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    // Skip rows that are completely empty.
    const allEmpty = row.every((c) => c === undefined || String(c).trim() === '');
    if (allEmpty) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => {
      const v = row[j];
      rec[h] = v === undefined || v === null ? '' : String(v).trim();
    });
    rawRows.push(rec);
  }

  if (rawRows.length === 0) {
    throw new Error('No data rows found below the header.');
  }

  const { mapping, warnings } = detectColumnMapping(headers);
  return { headers, rawRows, suggestedMapping: mapping, warnings };
}

// ---------------------------------------------------------------------------
// Apply a (user-confirmed) column mapping to raw rows → typed BomLine[].
// Pure helper; takes the output of parseBomFile + a mapping (possibly edited
// by the user in the confirm panel) and produces the normalized lines that
// downstream code (diff, storage, AI) consumes.
// ---------------------------------------------------------------------------

export function applyMapping(
  rawRows: Record<string, string>[],
  mapping: ColumnMapping
): BomLine[] {
  return rawRows
    .map((row) => buildLine(row, mapping))
    .filter((line): line is BomLine => line !== null);
}

function buildLine(
  row: Record<string, string>,
  mapping: ColumnMapping
): BomLine | null {
  const bomLevel = mapping.bomLevel ? parseLevel(row[mapping.bomLevel]) : undefined;
  const internalPn = mapping.internalPn ? cleanStr(row[mapping.internalPn]) : undefined;
  const mpn = mapping.mpn ? cleanStr(row[mapping.mpn]) : undefined;
  const manufacturer = mapping.manufacturer ? cleanStr(row[mapping.manufacturer]) : undefined;
  const description = mapping.description ? cleanStr(row[mapping.description]) : undefined;
  const refDes = mapping.refDes ? cleanStr(row[mapping.refDes]) : undefined;
  const qtyRaw = mapping.qty ? row[mapping.qty] : undefined;
  const qty = parseQty(qtyRaw);
  const unitCost = mapping.unitCost ? parseCost(row[mapping.unitCost]) : undefined;
  const pkg = mapping.package ? cleanStr(row[mapping.package]) : undefined;
  const rev = mapping.rev ? cleanStr(row[mapping.rev]) : undefined;

  // Skip lines with no identifier at all — they're not meaningful as a BOM
  // line. (We still don't throw — partial / messy BOMs should parse what they
  // can.)
  if (!internalPn && !mpn && !refDes && !description) return null;

  // Preserve raw values for AI / re-export.
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      raw[k] = String(v);
    }
  }

  return {
    bomLevel,
    internalPn,
    mpn,
    manufacturer,
    description,
    refDes,
    qty,
    unitCost,
    package: pkg,
    rev,
    raw
  };
}

function cleanStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : undefined;
}

/**
 * Parse a bom-level cell. Multi-level BOMs typically encode level as
 * 1/2/3/... or as a dotted path ("1.1", "1.2.3" — we take the deepest token
 * length as the level for those). Returns undefined when unparseable so
 * a missing column doesn't synthesize a fake level.
 */
export function parseLevel(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  // Dotted path like "1.2.3" → level 3 (depth of dotted notation).
  if (/^\d+(\.\d+)+$/.test(s)) return s.split('.').length;
  const m = s.match(/-?\d+/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse a qty cell. Accepts plain numbers, "10 pcs", "10x", "1,000", etc.
 * Returns 1 on unparseable (so a missing/garbage qty cell doesn't kill the
 * line — better to under-count than drop a part entirely).
 */
export function parseQty(v: unknown): number {
  if (v === undefined || v === null || v === '') return 1;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 1;
  const s = String(v).replace(/,/g, '').trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return 1;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Parse a cost cell. Strips currency symbols + thousands separators.
 * Returns undefined on unparseable.
 */
export function parseCost(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).replace(/[\$€£¥,\s]/g, '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
