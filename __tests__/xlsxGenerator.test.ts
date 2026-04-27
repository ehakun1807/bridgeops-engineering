import { generateResultsXlsx, downloadXlsx, AnalysisResult } from '@/utils/xlsxGenerator';
import { BomRow } from '@/utils/bomAnalyzer';
import * as XLSX from 'xlsx';

// Helper to convert Blob to ArrayBuffer in Node/jsdom environment
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

describe('XLSX Generator', () => {
  describe('generateResultsXlsx', () => {
    it('should generate XLSX with all required columns', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 },
        { manufacturer: 'nxp semiconductors', partNumber: 'bc847', rowIndex: 3 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358N',
          newPartNumber: 'LM358N-BRT',
          confidence: 'exact',
          status: 'found'
        },
        {
          rowIndex: 3,
          manufacturer: 'NXP Semiconductors',
          partNumber: 'BC847',
          equivalent: 'BC847C',
          newPartNumber: 'BC847C-MR',
          confidence: 'spec-based',
          status: 'found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(blob.size).toBeGreaterThan(0);
    });

    it('should display "Not found" for missing components', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'unknown manufacturer', partNumber: 'xyz123', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'unknown manufacturer',
          partNumber: 'xyz123',
          equivalent: null,
          newPartNumber: null,
          confidence: null,
          status: 'not-found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Check that "Not found" is in the equivalent component column (index 2)
      expect(String(data[1][2])).toBe('Not found');
    });

    it('should display empty string for missing new part number', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358N',
          newPartNumber: null,
          confidence: 'exact',
          status: 'found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Check that new part number column (index 3) is empty
      expect(String(data[1][3])).toBe('');
    });

    it('should format confidence as "Exact Match" for exact matches', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358N',
          newPartNumber: 'LM358N-BRT',
          confidence: 'exact',
          status: 'found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Check confidence column (index 4)
      expect(String(data[1][4])).toBe('Exact Match');
    });

    it('should format confidence as "Spec-Based Match" for spec-based matches', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358A',
          newPartNumber: 'LM358A-BRT',
          confidence: 'spec-based',
          status: 'found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Check confidence column (index 4)
      expect(String(data[1][4])).toBe('Spec-Based Match');
    });

    it('should display empty string for missing confidence', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'unknown manufacturer', partNumber: 'xyz123', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'unknown manufacturer',
          partNumber: 'xyz123',
          equivalent: null,
          newPartNumber: null,
          confidence: null,
          status: 'not-found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Check confidence column (index 4)
      expect(String(data[1][4])).toBe('');
    });

    it('should have correct column order', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358N',
          newPartNumber: 'LM358N-BRT',
          confidence: 'exact',
          status: 'found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Verify header row
      expect(String(data[0][0])).toBe('Manufacturer Name');
      expect(String(data[0][1])).toBe('Manufacturer Part Number');
      expect(String(data[0][2])).toBe('Equivalent Component');
      expect(String(data[0][3])).toBe('New Part Number');
      expect(String(data[0][4])).toBe('Confidence');
    });

    it('should generate valid XLSX file with 5 data columns', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358N',
          newPartNumber: 'LM358N-BRT',
          confidence: 'exact',
          status: 'found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      // Verify we have the correct number of columns (5) in the output
      expect(data[0]).toHaveLength(5);
      expect(data[1]).toHaveLength(5);
    });

    it('should handle multiple results in order', async () => {
      const bomRows: BomRow[] = [
        { manufacturer: 'texas instruments', partNumber: 'lm358', rowIndex: 2 },
        { manufacturer: 'nxp semiconductors', partNumber: 'bc847', rowIndex: 3 },
        { manufacturer: 'unknown mfg', partNumber: 'unknown', rowIndex: 4 }
      ];

      const results: AnalysisResult[] = [
        {
          rowIndex: 2,
          manufacturer: 'Texas Instruments',
          partNumber: 'LM358',
          equivalent: 'LM358N',
          newPartNumber: 'LM358N-BRT',
          confidence: 'exact',
          status: 'found'
        },
        {
          rowIndex: 3,
          manufacturer: 'NXP Semiconductors',
          partNumber: 'BC847',
          equivalent: 'BC847C',
          newPartNumber: 'BC847C-MR',
          confidence: 'spec-based',
          status: 'found'
        },
        {
          rowIndex: 4,
          manufacturer: 'unknown mfg',
          partNumber: 'unknown',
          equivalent: null,
          newPartNumber: null,
          confidence: null,
          status: 'not-found'
        }
      ];

      const blob = await generateResultsXlsx(bomRows, results);
      const arrayBuffer = await blobToArrayBuffer(blob);
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

      expect(data).toHaveLength(4); // Header + 3 data rows
      expect(String(data[1][0])).toBe('Texas Instruments');
      expect(String(data[2][0])).toBe('NXP Semiconductors');
      expect(String(data[3][0])).toBe('unknown mfg');
    });
  });

  describe('downloadXlsx', () => {
    it('should create a download link and trigger download', () => {
      // Mock URL methods
      const mockUrl = 'blob:http://localhost/test-url';
      const originalCreateObjectURL = global.URL.createObjectURL;
      const originalRevokeObjectURL = global.URL.revokeObjectURL;

      (global.URL.createObjectURL as any) = jest.fn().mockReturnValue(mockUrl);
      (global.URL.revokeObjectURL as any) = jest.fn();

      const createElementSpy = jest.spyOn(document, 'createElement');
      const appendChildSpy = jest.spyOn(document.body, 'appendChild');
      const removeChildSpy = jest.spyOn(document.body, 'removeChild');

      const blob = new Blob(['test'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const filename = 'test_output.xlsx';

      downloadXlsx(blob, filename);

      // Verify URL.createObjectURL was called
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(blob);

      // Verify createElement was called with 'a'
      expect(createElementSpy).toHaveBeenCalledWith('a');

      // Verify appendChild was called
      expect(appendChildSpy).toHaveBeenCalled();

      // Verify removeChild was called
      expect(removeChildSpy).toHaveBeenCalled();

      // Verify URL.revokeObjectURL was called
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();

      // Restore
      (global.URL.createObjectURL as any) = originalCreateObjectURL;
      (global.URL.revokeObjectURL as any) = originalRevokeObjectURL;
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it('should use default filename if not provided', () => {
      const mockUrl = 'blob:http://localhost/test-url';
      const originalCreateObjectURL = global.URL.createObjectURL;
      const originalRevokeObjectURL = global.URL.revokeObjectURL;

      (global.URL.createObjectURL as any) = jest.fn().mockReturnValue(mockUrl);
      (global.URL.revokeObjectURL as any) = jest.fn();

      const createElementSpy = jest.spyOn(document, 'createElement');

      const blob = new Blob(['test'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      downloadXlsx(blob);

      const linkElement = createElementSpy.mock.results.find(r => r.value?.tagName === 'A')?.value;
      expect(linkElement?.download).toBe('BOM_Analysis.xlsx');

      // Restore
      (global.URL.createObjectURL as any) = originalCreateObjectURL;
      (global.URL.revokeObjectURL as any) = originalRevokeObjectURL;
      createElementSpy.mockRestore();
    });

    it('should set correct href attribute on anchor element', () => {
      const blob = new Blob(['test'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      // Mock URL.createObjectURL to return a predictable value
      const mockUrl = 'blob:http://localhost/test-url';
      const originalCreateObjectURL = global.URL.createObjectURL;
      const originalRevokeObjectURL = global.URL.revokeObjectURL;

      (global.URL.createObjectURL as any) = jest.fn().mockReturnValue(mockUrl);
      (global.URL.revokeObjectURL as any) = jest.fn();

      // Track the anchor element that gets created
      let createdAnchor: HTMLAnchorElement | null = null;
      const originalCreateElement = document.createElement;
      const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation(function(this: Document, tagName: string) {
        const element = originalCreateElement.call(this, tagName);
        if (tagName === 'a') {
          createdAnchor = element as HTMLAnchorElement;
        }
        return element;
      });

      downloadXlsx(blob, 'output.xlsx');

      // Verify the anchor element has href set
      expect(createdAnchor).not.toBeNull();
      expect(createdAnchor?.href).toBe(mockUrl);

      // Restore
      (global.URL.createObjectURL as any) = originalCreateObjectURL;
      (global.URL.revokeObjectURL as any) = originalRevokeObjectURL;
      createElementSpy.mockRestore();
    });
  });
});
