import * as XLSX from 'xlsx';

export interface BomRow {
  manufacturer: string;
  partNumber: string;
  rowIndex: number; // 1-indexed for display
}

export interface ValidationResult {
  valid: BomRow[];
  errors: Array<{
    rowIndex: number;
    reason: string;
  }>;
}

/**
 * Parses a BOM file (XLSX/XLS/CSV) and extracts manufacturer and part number columns
 * @param file - The File object to parse
 * @returns Promise<BomRow[]> - Array of parsed BOM rows
 * @throws Error if file is invalid or has wrong number of columns
 */
export async function parseBomsFromXlsx(file: File): Promise<BomRow[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });

    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('No sheets found in file');
    }

    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false }) as (string | number | undefined)[][];

    if (!Array.isArray(data) || !data.every(row => Array.isArray(row))) {
      throw new Error('Invalid file structure: expected array of rows');
    }

    if (data.length === 0) {
      throw new Error('File must contain at least one row of data');
    }

    // Check column count (should be exactly 2)
    const firstRow = data[0];
    if (!firstRow || firstRow.length < 2) {
      throw new Error('File must contain exactly 2 columns: Manufacturer and Part Number');
    }

    // -----------------------------------------------------------------------
    // Header detection.
    //
    // The original parser unconditionally skipped row 0 as a header. That
    // silently dropped the first data row when users upload headerless files
    // (just two columns of PN + manufacturer data, no label row).
    //
    // Now we check whether row 0 looks like a real header row:
    //   - A header row contains recognisable label keywords in at least one
    //     cell (e.g. "manufacturer", "part number", "mpn", "vendor").
    //   - A data row does NOT contain those keywords.
    // If row 0 is not a header we start processing from row 0 instead of 1.
    // -----------------------------------------------------------------------
    const HEADER_KEYWORDS = /manufacturer|part.?number|part.?no|mpn|vendor|mfr|mfg|supplier/i;
    const row0Cells = firstRow.map(c => String(c ?? '').trim());
    const hasHeaderRow = row0Cells.some(c => HEADER_KEYWORDS.test(c));
    const dataStartIndex = hasHeaderRow ? 1 : 0;

    // -----------------------------------------------------------------------
    // Column mapping.
    //
    // The parser previously assumed col-0 = manufacturer, col-1 = part
    // number. Users sometimes provide the file in the opposite order
    // (part number first, manufacturer second). We detect the intended
    // mapping by inspecting the header labels when present, or by heuristic
    // when there is no header.
    //
    // Heuristic for headerless files: manufacturer names are typically
    // alphabetic words (letters and spaces), while part numbers usually
    // contain digits or hyphens. We check both columns on the first data row
    // and swap if col-0 looks more like a part number than a manufacturer.
    // -----------------------------------------------------------------------
    let mfrCol = 0;
    let pnCol  = 1;

    if (hasHeaderRow) {
      // Use header labels to determine column order.
      const MFR_LABEL  = /manufacturer|mfr|mfg|vendor|supplier/i;
      const PN_LABEL   = /part.?number|part.?no|mpn/i;
      const col0Label  = row0Cells[0];
      const col1Label  = row0Cells[1];
      if (PN_LABEL.test(col0Label) && MFR_LABEL.test(col1Label)) {
        // e.g. "Part Number" | "Manufacturer" — swap
        mfrCol = 1;
        pnCol  = 0;
      }
      // In all other cases keep col-0 = mfr, col-1 = pn (the original
      // assumption). This covers: mfr|pn (correct), ambiguous labels,
      // and single-label rows.
    } else {
      // Headerless: inspect the first data row for clues.
      // A value that is purely alphabetic with spaces is more likely a
      // manufacturer name. A value with embedded digits / hyphens is more
      // likely a part number.
      const LOOKS_LIKE_PN = /\d|[-\/_.]/;
      const col0Val = String(data[dataStartIndex]?.[0] ?? '');
      const col1Val = String(data[dataStartIndex]?.[1] ?? '');
      if (LOOKS_LIKE_PN.test(col0Val) && !LOOKS_LIKE_PN.test(col1Val)) {
        // col-0 looks like a PN, col-1 looks like a manufacturer name
        mfrCol = 1;
        pnCol  = 0;
      }
    }

    // Process data rows
    const bomRows: BomRow[] = [];
    for (let i = dataStartIndex; i < data.length; i++) {
      const row = data[i];

      // Skip empty rows
      if (!row || row.length === 0 || (row.every(cell => !cell || String(cell).trim() === ''))) {
        continue;
      }

      const manufacturer = String(row[mfrCol] || '').trim().toLowerCase();
      const partNumber   = String(row[pnCol]  || '').trim().toLowerCase();

      // Skip rows where either field is empty after trimming
      if (!manufacturer || !partNumber) {
        throw new Error(`Row ${i + 1}: Both Manufacturer and Part Number must be non-empty`);
      }

      bomRows.push({
        manufacturer,
        partNumber,
        rowIndex: i + 1 // 1-indexed for display
      });
    }

    if (bomRows.length === 0) {
      throw new Error('File must contain at least one row of data');
    }

    return bomRows;
  } catch (error) {
    if (error instanceof Error) {
      throw error; // Re-throw with original context
    }
    throw new Error(`Failed to parse file: ${String(error)}`);
  }
}

/**
 * Validates BOM rows for invalid characters (control characters)
 * @param rows - Array of BomRow objects to validate
 * @returns ValidationResult with valid rows and errors
 */
export function validateBomRows(rows: BomRow[]): ValidationResult {
  const valid: BomRow[] = [];
  const errors: Array<{ rowIndex: number; reason: string }> = [];

  for (const row of rows) {
    const hasInvalidCharacters =
      hasControlCharacters(row.manufacturer) ||
      hasControlCharacters(row.partNumber);

    if (hasInvalidCharacters) {
      errors.push({
        rowIndex: row.rowIndex,
        reason: 'Contains invalid control character'
      });
    } else {
      valid.push(row);
    }
  }

  return { valid, errors };
}

/**
 * Checks if a string contains control characters (0x00-0x1F or 0x7F)
 * @param text - The text to check
 * @returns boolean - True if control characters are found
 */
function hasControlCharacters(text: string): boolean {
  // Check for control characters: 0x00-0x1F and 0x7F (DEL)
  const controlCharRegex = /[\x00-\x1F\x7F]/g;
  return controlCharRegex.test(text);
}
