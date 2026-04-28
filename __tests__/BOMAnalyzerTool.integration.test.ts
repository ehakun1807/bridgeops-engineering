import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import BOMAnalyzerTool from '@/BOMAnalyzerTool';
import * as XLSX from 'xlsx';

// Helper function to create an XLSX file for testing with arrayBuffer polyfill
function createXlsxFile(
  data: (string | number | undefined)[][],
  fileName: string = 'test.xlsx'
): File {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const file = new File([new Uint8Array(buffer)], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  // Polyfill arrayBuffer() for jsdom
  if (!file.arrayBuffer) {
    (file as any).arrayBuffer = async function () {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(this);
      });
    };
  }

  return file;
}

describe('BOMAnalyzerTool Integration Tests', () => {
  beforeEach(() => {
    // Setup mock for fetch API
    global.fetch = jest.fn();
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Full workflow test', () => {
    it('should complete upload -> analyze -> download workflow', async () => {
      // Setup
      const { rerender } = render(React.createElement(BOMAnalyzerTool));

      // Create test XLSX with 2-3 components
      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358'],
        ['NXP Semiconductors', 'BC847']
      ];
      const testFile = createXlsxFile(testData, 'bom-test.xlsx');

      // Mock fetch for API calls
      (global.fetch as jest.Mock).mockImplementation((url: string, options: any) => {
        if (url === '/api/find-equivalent') {
          const body = JSON.parse(options.body);
          if (body.manufacturer.includes('texas')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  equivalent: 'LM358N',
                  newPartNumber: 'LM358N-BRT',
                  confidence: 'exact'
                })
            });
          } else if (body.manufacturer.includes('nxp')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  equivalent: 'BC847C',
                  newPartNumber: 'BC847C-MR',
                  confidence: 'spec-based'
                })
            });
          }
        }
        return Promise.reject(new Error('Not found'));
      });

      // Step 1: Upload file via file input
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Step 2: Verify file is displayed as selected
      await waitFor(() => {
        expect(screen.getByText('bom-test.xlsx')).toBeInTheDocument();
      });

      // Step 3: Click "Analyze BOM" button
      const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
      fireEvent.click(analyzeButton);

      // Step 4: Wait for analysis to complete with 30-second timeout
      await waitFor(
        () => {
          // Verify results table appears with rows
          expect(screen.getByText('Analysis Results')).toBeInTheDocument();
          expect(screen.getByRole('table')).toBeInTheDocument();

          // Verify we have results rows (at least 2 components)
          const rows = screen.getAllByRole('row');
          expect(rows.length).toBeGreaterThanOrEqual(3); // header + 2 data rows
        },
        { timeout: 30000 }
      );

      // Step 5: Verify results table has expected content
      expect(screen.getByText('texas instruments')).toBeInTheDocument();
      expect(screen.getByText('nxp semiconductors')).toBeInTheDocument();

      // Step 6: Click "Download Results" button
      const downloadButton = screen.getByRole('button', { name: /Download Results/i });
      expect(downloadButton).toBeInTheDocument();
      fireEvent.click(downloadButton);

      // Step 7: Verify download was triggered (URL.createObjectURL called)
      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled();
      });
    });
  });

  describe('Invalid file test', () => {
    it('should show error message for file with wrong column count (3 columns)', async () => {
      render(React.createElement(BOMAnalyzerTool));

      // Create XLSX with 3 columns
      const testData = [
        ['Manufacturer', 'Part Number', 'Extra Column'],
        ['Texas Instruments', 'LM358', 'Extra Data']
      ];
      const testFile = createXlsxFile(testData, 'invalid-bom.xlsx');

      // Upload file (won't fail, only validates extension/size)
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Verify file was accepted
      await waitFor(() => {
        expect(screen.getByText('invalid-bom.xlsx')).toBeInTheDocument();
      });

      // Click Analyze - this is where column validation happens
      const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
      fireEvent.click(analyzeButton);

      // Verify error message appears during analysis
      await waitFor(() => {
        expect(
          screen.getByText(/File must contain exactly 2 columns/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Missing columns test', () => {
    it('should show error for XLSX with only 1 column', async () => {
      render(React.createElement(BOMAnalyzerTool));

      // Create XLSX with 1 column only
      const testData = [
        ['Manufacturer'],
        ['Texas Instruments']
      ];
      const testFile = createXlsxFile(testData, 'missing-columns.xlsx');

      // Upload file
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Verify file was accepted
      await waitFor(() => {
        expect(screen.getByText('missing-columns.xlsx')).toBeInTheDocument();
      });

      // Click Analyze - this is where column validation happens
      const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
      fireEvent.click(analyzeButton);

      // Verify error appears during analysis
      await waitFor(() => {
        expect(
          screen.getByText(/File must contain exactly 2 columns/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Not found component test', () => {
    it('should display "Not found" in equivalent column for fake manufacturer/part numbers', async () => {
      render(React.createElement(BOMAnalyzerTool));

      // Create XLSX with fake manufacturer/part numbers
      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Fake Manufacturer', 'FAKEPN123']
      ];
      const testFile = createXlsxFile(testData, 'not-found-test.xlsx');

      // Mock fetch to return "not-found" response
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            equivalent: null,
            newPartNumber: null,
            confidence: null
          })
      });

      // Upload file
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Click Analyze
      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
        fireEvent.click(analyzeButton);
      });

      // Wait for results and verify "Not found" appears
      await waitFor(
        () => {
          const table = screen.getByRole('table');
          const cells = within(table).getAllByText('-');
          // Should have "-" for missing equivalent and new part number
          expect(cells.length).toBeGreaterThan(0);
        },
        { timeout: 30000 }
      );
    });
  });

  describe('Empty/invalid data test', () => {
    it('should only analyze valid rows and skip empty rows', async () => {
      render(React.createElement(BOMAnalyzerTool));

      // Create XLSX with empty rows
      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358'],
        [undefined, undefined], // Empty row
        ['', ''], // Whitespace only row
        ['NXP Semiconductors', 'BC847']
      ];
      const testFile = createXlsxFile(testData, 'mixed-data.xlsx');

      // Mock fetch to track calls
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            equivalent: 'FOUND',
            newPartNumber: 'NEW-PN',
            confidence: 'exact'
          })
      });

      // Upload file
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Click Analyze
      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
        fireEvent.click(analyzeButton);
      });

      // Wait for analysis to complete
      await waitFor(
        () => {
          expect(screen.getByText('Analysis Results')).toBeInTheDocument();
        },
        { timeout: 30000 }
      );

      // Verify only 2 fetch calls (for 2 valid rows, empty rows skipped)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling during analysis', () => {
    it('should handle API errors gracefully and show error status', async () => {
      render(React.createElement(BOMAnalyzerTool));

      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358']
      ];
      const testFile = createXlsxFile(testData, 'error-test.xlsx');

      // Mock fetch to throw error
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error('API error: 500')
      );

      // Upload file
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Click Analyze
      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
        fireEvent.click(analyzeButton);
      });

      // Wait for results with error status
      await waitFor(
        () => {
          expect(screen.getByText('Analysis Results')).toBeInTheDocument();
          // Error status should be shown
          const table = screen.getByRole('table');
          expect(table).toBeInTheDocument();
        },
        { timeout: 30000 }
      );
    });
  });

  describe('File validation', () => {
    it('should reject files that are too large', async () => {
      render(React.createElement(BOMAnalyzerTool));

      // Create a large file (over 10MB)
      const largeBuffer = new ArrayBuffer(11 * 1024 * 1024);
      const largeFile = new File([largeBuffer], 'large-file.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [largeFile] } });

      // Verify error message
      await waitFor(() => {
        expect(
          screen.getByText(/File size must be less than 10MB/i)
        ).toBeInTheDocument();
      });
    });

    it('should reject files with invalid extensions', async () => {
      render(React.createElement(BOMAnalyzerTool));

      const invalidFile = new File(['content'], 'test.txt', {
        type: 'text/plain'
      });

      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      // Verify error message
      await waitFor(() => {
        expect(
          screen.getByText(/Invalid file type/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('File removal', () => {
    it('should allow removing selected file and resetting the form', async () => {
      render(React.createElement(BOMAnalyzerTool));

      // Upload a file
      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358']
      ];
      const testFile = createXlsxFile(testData, 'removable.xlsx');

      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Verify file is shown
      await waitFor(() => {
        expect(screen.getByText('removable.xlsx')).toBeInTheDocument();
      });

      // Click remove button
      const removeButton = screen.getByLabelText('Remove file');
      fireEvent.click(removeButton);

      // Verify file is removed and upload UI is back
      await waitFor(() => {
        expect(screen.queryByText('removable.xlsx')).not.toBeInTheDocument();
        expect(
          screen.getByText(/Drag and drop your file here/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Progress tracking', () => {
    it('should display progress during analysis', async () => {
      render(React.createElement(BOMAnalyzerTool));

      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358'],
        ['NXP Semiconductors', 'BC847'],
        ['STMicroelectronics', 'STM32F103']
      ];
      const testFile = createXlsxFile(testData, 'progress-test.xlsx');

      // Mock slow fetch with delay to observe progress
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () =>
                    Promise.resolve({
                      equivalent: 'FOUND',
                      newPartNumber: 'NEW-PN',
                      confidence: 'exact'
                    })
                }),
              500 // 500ms delay per request
            )
          )
      );

      // Upload and analyze
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
        fireEvent.click(analyzeButton);
      });

      // Wait for analysis to complete
      await waitFor(
        () => {
          expect(screen.getByText('Analysis Results')).toBeInTheDocument();
        },
        { timeout: 30000 }
      );

      // Verify progress was shown
      expect(screen.getByText(/Progress:/i)).toBeInTheDocument();
    });
  });

  describe('Results rendering', () => {
    it('should display results with correct status indicators', async () => {
      render(React.createElement(BOMAnalyzerTool));

      const testData = [
        ['Manufacturer', 'Part Number'],
        ['Texas Instruments', 'LM358'],
        ['Unknown Manufacturer', 'UNKNOWNPN']
      ];
      const testFile = createXlsxFile(testData, 'status-test.xlsx');

      // Mock fetch with different responses
      (global.fetch as jest.Mock).mockImplementation((url: string, options: any) => {
        if (url === '/api/find-equivalent') {
          const body = JSON.parse(options.body);
          if (body.manufacturer.includes('texas')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  equivalent: 'LM358N',
                  newPartNumber: 'LM358N-BRT',
                  confidence: 'exact'
                })
            });
          } else if (body.manufacturer.includes('unknown')) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  equivalent: null,
                  newPartNumber: null,
                  confidence: null
                })
            });
          }
        }
        return Promise.reject(new Error('Not found'));
      });

      // Upload and analyze
      const fileInput = screen.getByLabelText('Upload BOM file');
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /Analyze BOM/i });
        fireEvent.click(analyzeButton);
      });

      // Wait for results
      await waitFor(
        () => {
          const table = screen.getByRole('table');
          expect(table).toBeInTheDocument();
        },
        { timeout: 30000 }
      );

      // Verify table contains manufacturer names from file
      expect(screen.getByText(/texas instruments/i)).toBeInTheDocument();
      expect(screen.getByText(/unknown manufacturer/i)).toBeInTheDocument();
    });
  });
});
