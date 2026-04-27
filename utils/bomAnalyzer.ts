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

    if (data.length === 0) {
      throw new Error('File must contain at least one row of data');
    }

    // Check column count (should be exactly 2)
    const headerRow = data[0];
    if (!headerRow || headerRow.length !== 2) {
      throw new Error('File must contain exactly 2 columns: Manufacturer and Part Number');
    }

    // Process data rows (skip header)
    const bomRows: BomRow[] = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      // Skip empty rows
      if (!row || row.length === 0 || (row.every(cell => !cell || String(cell).trim() === ''))) {
        continue;
      }

      const manufacturer = String(row[0] || '').trim().toLowerCase();
      const partNumber = String(row[1] || '').trim().toLowerCase();

      // Skip rows where either field is empty after trimming
      if (!manufacturer || !partNumber) {
        throw new Error(`Row ${i + 1}: Both Manufacturer and Part Number must be non-empty`);
      }

      bomRows.push({
        manufacturer,
        partNumber,
        rowIndex: i + 1 // Convert to 1-indexed (row 1 is header, so first data row is 2)
      });
    }

    if (bomRows.length === 0) {
      throw new Error('File must contain at least one row of data');
    }

    return bomRows;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to parse file');
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
