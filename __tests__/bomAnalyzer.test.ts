import { parseBomsFromXlsx, validateBomRows, BomRow } from '@/utils/bomAnalyzer';
import * as XLSX from 'xlsx';

// Helper function to create an XLSX file for testing
function createXlsxFile(data: (string | number | undefined)[][], fileName: string = 'test.xlsx'): File {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([new Uint8Array(buffer)], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('BOM Analyzer', () => {
  describe('parseBomsFromXlsx', () => {
    it('should parse a valid XLSX file with 2 columns', async () => {
      const file = createXlsxFile([
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358'],
        ['NXP Semiconductors', 'BC847']
      ]);

      const result = await parseBomsFromXlsx(file);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        manufacturer: 'texas instruments',
        partNumber: 'lm358',
        rowIndex: 2
      });
      expect(result[1]).toEqual({
        manufacturer: 'nxp semiconductors',
        partNumber: 'bc847',
        rowIndex: 3
      });
    });

    it('should throw error if file has fewer than 2 columns', async () => {
      const file = createXlsxFile([
        ['Manufacturer'],
        ['Texas Instruments']
      ]);

      await expect(parseBomsFromXlsx(file)).rejects.toThrow('File must contain exactly 2 columns: Manufacturer and Part Number');
    });

    it('should throw error if file has more than 2 columns', async () => {
      const file = createXlsxFile([
        ['Manufacturer', 'Part Number', 'Extra Column'],
        ['Texas Instruments', 'LM358', 'Extra']
      ]);

      await expect(parseBomsFromXlsx(file)).rejects.toThrow('File must contain exactly 2 columns: Manufacturer and Part Number');
    });

    it('should throw error if file has no data rows (only header)', async () => {
      const file = createXlsxFile([
        ['Manufacturer', 'Part Number']
      ]);

      await expect(parseBomsFromXlsx(file)).rejects.toThrow('File must contain at least one row of data');
    });

    it('should skip empty rows', async () => {
      const file = createXlsxFile([
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358'],
        [undefined, undefined],
        ['NXP Semiconductors', 'BC847']
      ]);

      const result = await parseBomsFromXlsx(file);

      expect(result).toHaveLength(2);
      expect(result[0].partNumber).toBe('lm358');
      expect(result[1].partNumber).toBe('bc847');
    });

    it('should normalize whitespace (trim) in manufacturer and part number', async () => {
      const file = createXlsxFile([
        ['Manufacturer', 'Part Number'],
        ['  Texas Instruments  ', '  LM358  ']
      ]);

      const result = await parseBomsFromXlsx(file);

      expect(result[0].manufacturer).toBe('texas instruments');
      expect(result[0].partNumber).toBe('lm358');
    });

    it('should throw error if manufacturer or part number is empty after trimming', async () => {
      const file = createXlsxFile([
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', '']
      ]);

      await expect(parseBomsFromXlsx(file)).rejects.toThrow();
    });

    it('should handle CSV files', async () => {
      const csvContent = 'Manufacturer,Part Number\nTexas Instruments,LM358\nNXP Semiconductors,BC847';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await parseBomsFromXlsx(file);

      expect(result).toHaveLength(2);
      expect(result[0].manufacturer).toBe('texas instruments');
    });
  });

  describe('validateBomRows', () => {
    it('should mark valid rows as valid', () => {
      const rows: BomRow[] = [
        { manufacturer: 'Texas Instruments', partNumber: 'LM358', rowIndex: 2 },
        { manufacturer: 'NXP Semiconductors', partNumber: 'BC847', rowIndex: 3 }
      ];

      const result = validateBomRows(rows);

      expect(result.valid).toEqual(rows);
      expect(result.errors).toHaveLength(0);
    });

    it('should flag rows with control characters in manufacturer', () => {
      const rows: BomRow[] = [
        { manufacturer: 'Texas\x00Instruments', partNumber: 'LM358', rowIndex: 2 }
      ];

      const result = validateBomRows(rows);

      expect(result.valid).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rowIndex).toBe(2);
      expect(result.errors[0].reason).toContain('control character');
    });

    it('should flag rows with control characters in part number', () => {
      const rows: BomRow[] = [
        { manufacturer: 'Texas Instruments', partNumber: 'LM\x1F358', rowIndex: 2 }
      ];

      const result = validateBomRows(rows);

      expect(result.valid).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rowIndex).toBe(2);
      expect(result.errors[0].reason).toContain('control character');
    });

    it('should flag rows with DEL character (0x7F)', () => {
      const rows: BomRow[] = [
        { manufacturer: 'Texas\x7FInstruments', partNumber: 'LM358', rowIndex: 2 }
      ];

      const result = validateBomRows(rows);

      expect(result.valid).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    });

    it('should handle mixed valid and invalid rows', () => {
      const rows: BomRow[] = [
        { manufacturer: 'Texas Instruments', partNumber: 'LM358', rowIndex: 2 },
        { manufacturer: 'NXP\x00Semiconductors', partNumber: 'BC847', rowIndex: 3 },
        { manufacturer: 'STMicroelectronics', partNumber: 'STM32F103', rowIndex: 4 }
      ];

      const result = validateBomRows(rows);

      expect(result.valid).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].rowIndex).toBe(3);
    });
  });
});
