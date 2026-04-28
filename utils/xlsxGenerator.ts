import * as XLSX from 'xlsx';
import { BomRow } from './bomAnalyzer';

export interface AnalysisResult {
  rowIndex: number;
  manufacturer: string;
  partNumber: string;
  equivalent: string | null;
  newPartNumber: string | null;
  confidence: 'exact' | 'spec-based' | null;
  // Datasheet or distributor product-page URL surfaced by Gemini's grounded
  // search. Optional — null when no live source was found, or for legacy
  // result rows from before this field was added.
  sourceUrl?: string | null;
  // Free-text 1-2 sentence context: what the part is, why this replacement
  // is appropriate, or — for not-found rows — what the engineer should
  // verify. Optional for the same legacy reason as sourceUrl.
  notes?: string | null;
  // 'searching' = request in flight (UI-only, transient).
  // 'found' / 'not-found' / 'error' = terminal states.
  status: 'searching' | 'found' | 'not-found' | 'error';
}

/**
 * Generates an XLSX file with BOM analysis results
 * @param bomRows - Original BOM rows with manufacturer and part number
 * @param results - Analysis results with equivalent components and confidence
 * @returns Promise<Blob> - XLSX file as a Blob
 */
export async function generateResultsXlsx(bomRows: BomRow[], results: AnalysisResult[]): Promise<Blob> {
  // Create header row
  const headers = [
    'Manufacturer Name',
    'Manufacturer Part Number',
    'Equivalent Component',
    'New Part Number',
    'Confidence',
    'Notes',
    'Source URL'
  ];

  // Create data rows by matching bomRows with results
  const dataRows: (string | number | undefined)[][] = [headers];

  for (const bomRow of bomRows) {
    const result = results.find(r => r.rowIndex === bomRow.rowIndex);

    if (result) {
      const confidenceText = result.confidence === null ? '' :
        result.confidence === 'exact' ? 'Exact Match' :
        result.confidence === 'spec-based' ? 'Spec-Based Match' : '';

      // Equivalent column shows a status word for not-found / error / still
      // searching so the downloaded sheet is self-explanatory even outside
      // the app's UI context.
      let equivalentComponent: string;
      if (result.equivalent) {
        equivalentComponent = result.equivalent;
      } else if (result.status === 'error') {
        equivalentComponent = 'Lookup error';
      } else if (result.status === 'searching') {
        equivalentComponent = 'In progress';
      } else {
        equivalentComponent = 'Not found';
      }

      const newPartNumber = result.newPartNumber === null ? '' : result.newPartNumber;
      const notes = result.notes || '';
      const sourceUrl = result.sourceUrl || '';

      dataRows.push([
        result.manufacturer,
        result.partNumber,
        equivalentComponent,
        newPartNumber,
        confidenceText,
        notes,
        sourceUrl
      ]);
    }
  }

  // Create workbook and worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(dataRows);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 25 }, // Manufacturer Name
    { wch: 25 }, // Manufacturer Part Number
    { wch: 35 }, // Equivalent Component
    { wch: 25 }, // New Part Number
    { wch: 18 }, // Confidence
    { wch: 60 }, // Notes
    { wch: 50 }  // Source URL
  ];

  // Append sheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');

  // Write workbook to array buffer
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

  // Convert to Blob
  const blob = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  return blob;
}

/**
 * Triggers a download of the XLSX blob in the browser
 * @param blob - The XLSX file as a Blob
 * @param filename - Optional filename (default: 'BOM_Analysis.xlsx')
 */
export function downloadXlsx(blob: Blob, filename: string = 'BOM_Analysis.xlsx'): void {
  // Create object URL from blob
  const url = URL.createObjectURL(blob);

  // Create anchor element
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;

  // Append to body, click, and remove
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the object URL
  URL.revokeObjectURL(url);
}
