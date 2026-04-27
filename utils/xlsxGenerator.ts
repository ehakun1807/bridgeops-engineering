import * as XLSX from 'xlsx';
import { BomRow } from './bomAnalyzer';

export interface AnalysisResult {
  rowIndex: number;
  manufacturer: string;
  partNumber: string;
  equivalent: string | null;
  newPartNumber: string | null;
  confidence: 'exact' | 'spec-based' | null;
  status: 'found' | 'not-found' | 'error';
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
    'Confidence'
  ];

  // Create data rows by matching bomRows with results
  const dataRows: (string | number | undefined)[][] = [headers];

  for (const bomRow of bomRows) {
    const result = results.find(r => r.rowIndex === bomRow.rowIndex);

    if (result) {
      const confidenceText = result.confidence === null ? '' :
        result.confidence === 'exact' ? 'Exact Match' :
        result.confidence === 'spec-based' ? 'Spec-Based Match' : '';

      const equivalentComponent = result.equivalent === null ? 'Not found' : result.equivalent;
      const newPartNumber = result.newPartNumber === null ? '' : result.newPartNumber;

      dataRows.push([
        result.manufacturer,
        result.partNumber,
        equivalentComponent,
        newPartNumber,
        confidenceText
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
    { wch: 30 }, // Equivalent Component
    { wch: 25 }, // New Part Number
    { wch: 20 }  // Confidence
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
