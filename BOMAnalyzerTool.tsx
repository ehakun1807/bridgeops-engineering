import React, { useState, useRef } from 'react';
import { Upload, X, File, Loader2, CheckCircle2, AlertTriangle, Download, Sparkles } from 'lucide-react';
import { auth } from './firebase.ts';
import { parseBomsFromXlsx, validateBomRows, type BomRow } from './utils/bomAnalyzer';
import { generateResultsXlsx, downloadXlsx, type AnalysisResult } from './utils/xlsxGenerator';

interface BOMAnalyzerToolProps {}

const BOMAnalyzerTool: React.FC<BOMAnalyzerToolProps> = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const acceptedFormats = ['.xlsx', '.xls', '.csv'];
  const acceptedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ];
  // Formats that aren't natively parseable but have a clean export-to-xlsx
  // path. We catch them on validation and tell the user exactly what to do
  // instead of a generic "invalid file type" error.
  const exportableFormats: Record<string, string> = {
    '.numbers':
      "Apple Numbers files aren't natively supported. Open the file in Numbers, then File → Export To → Excel… and upload the resulting .xlsx.",
    '.gsheet':
      "Google Sheets shortcut files aren't supported. Open the sheet at sheets.google.com, then File → Download → Microsoft Excel (.xlsx) and upload that.",
    '.ods':
      'OpenDocument spreadsheets (.ods) are not supported. Open in LibreOffice / Numbers / Excel and Save As .xlsx, then upload that.'
  };

  const validateFile = (file: File): boolean => {
    // Check file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = acceptedFormats.some((format) => fileName.endsWith(format));

    if (!hasValidExtension) {
      // If they tried a known-but-exportable format, give them the exact
      // recipe instead of a generic rejection.
      const exportableHint = Object.entries(exportableFormats).find(([ext]) =>
        fileName.endsWith(ext)
      );
      if (exportableHint) {
        setError(exportableHint[1]);
      } else {
        setError(
          `Invalid file type. Accepted formats: ${acceptedFormats.join(', ')}. ` +
            'For Apple Numbers or Google Sheets, export to .xlsx or .csv first.'
        );
      }
      return false;
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size must be less than 10MB');
      return false;
    }

    setError(null);
    return true;
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setError(null);
    setAnalysisProgress(0);
    setAnalysisResults([]);

    try {
      // The endpoint is admin-gated and requires a valid Firebase ID token.
      // Surface the auth requirement up front so the user gets a clear
      // message instead of N rows of "Error" once requests start firing.
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError(
          'You need to be signed in to analyze BOMs. Please sign in and try again.'
        );
        setIsAnalyzing(false);
        return;
      }

      let idToken: string;
      try {
        idToken = await currentUser.getIdToken(false);
      } catch (tokenErr) {
        setError(
          'Could not retrieve your authentication token. Please sign out and back in.'
        );
        setIsAnalyzing(false);
        return;
      }

      // Parse XLSX file
      const bomRows = await parseBomsFromXlsx(selectedFile);

      // Validate BOM rows
      const validation = validateBomRows(bomRows);
      if (validation.errors.length > 0) {
        setError(`Validation failed: ${validation.errors.map(e => `Row ${e.rowIndex}: ${e.reason}`).join('; ')}`);
        setIsAnalyzing(false);
        return;
      }

      const validRows = validation.valid;

      // Initialize results with "searching" status
      const initialResults: AnalysisResult[] = validRows.map(row => ({
        rowIndex: row.rowIndex,
        manufacturer: row.manufacturer,
        partNumber: row.partNumber,
        equivalent: null,
        newPartNumber: null,
        confidence: null,
        sourceUrl: null,
        notes: null,
        status: 'searching'
      }));

      setAnalysisResults(initialResults);

      // Concurrency: keep modest because the endpoint calls Gemini per row,
      // and Gemini's per-key rate limits punish bursts. 4 in-flight is a
      // reasonable balance between throughput and 429-avoidance.
      const concurrencyLimit = 4;
      let completed = 0;

      const processRow = async (row: BomRow) => {
        try {
          const response = await fetch('/api/find-equivalent', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
              manufacturer: row.manufacturer,
              partNumber: row.partNumber
            })
          });

          // Auth failures are global — once we get a 401/403 every other
          // row will fail the same way. Bubble them up so the user sees a
          // single, actionable error message.
          if (response.status === 401 || response.status === 403) {
            const data = await response.json().catch(() => ({}));
            throw new Error(
              `Auth failed (${response.status}): ${
                data?.error ||
                'this tool is admin-only. Sign in with the admin account to continue.'
              }`
            );
          }

          // 4xx other than auth = bad row data. 5xx / 502 = upstream model
          // issue. Either way, treat as a per-row error and keep going.
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(
              data?.error || `API error (${response.status}): ${response.statusText}`
            );
          }

          const data = await response.json();

          setAnalysisResults(prev => {
            const updated = [...prev];
            const index = updated.findIndex(r => r.rowIndex === row.rowIndex);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                equivalent: data.equivalent || null,
                newPartNumber: data.newPartNumber || null,
                confidence: data.confidence || null,
                sourceUrl: data.sourceUrl || null,
                notes: data.notes || null,
                status: data.equivalent ? 'found' : 'not-found'
              };
            }
            return updated;
          });
        } catch (err) {
          // Auth failures: surface globally and stop. Per-row failures:
          // log and mark the row as errored, keep processing the rest.
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith('Auth failed')) {
            throw err;
          }
          setAnalysisResults(prev => {
            const updated = [...prev];
            const index = updated.findIndex(r => r.rowIndex === row.rowIndex);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                notes: message.slice(0, 200),
                status: 'error'
              };
            }
            return updated;
          });
        } finally {
          completed++;
          setAnalysisProgress(completed);
        }
      };

      // Simple concurrency-limited queue. The previous implementation had a
      // bug — it used `Promise.race` then tried to remove the resolved
      // promise via `findIndex(p => Promise.resolve(p) === Promise.resolve(p))`,
      // which always finds index 0 regardless of which promise actually
      // resolved. So one slow request would wedge the queue at the wrong
      // slot. We replace it with N parallel workers consuming a shared
      // queue — simpler and correct.
      const queue = [...validRows];
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(concurrencyLimit, queue.length); i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const next = queue.shift();
              if (!next) break;
              await processRow(next);
            }
          })()
        );
      }
      await Promise.all(workers);
      setIsAnalyzing(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsAnalyzing(false);
    }
  };

  const handleDownloadResults = async () => {
    if (analysisResults.length === 0 || !selectedFile) return;

    try {
      // Parse BOM rows again for reference
      const bomRows = await parseBomsFromXlsx(selectedFile);

      // Generate XLSX
      const blob = await generateResultsXlsx(bomRows, analysisResults);

      // Create filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `BOM_Analysis_${timestamp}.xlsx`;

      // Download
      downloadXlsx(blob, filename);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2">
          Upload BOM File
        </h3>
        <p className="text-[12px] text-slate-500">
          Upload an XLSX, XLS, or CSV file containing your bill of materials.
          Numbers and Google Sheets users: export to .xlsx first.
        </p>
      </div>

      {!selectedFile ? (
        <>
          {/* Drag and drop area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer ${
              dragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50'
            }`}
          >
            <Upload
              size={32}
              className={`mx-auto mb-3 ${dragActive ? 'text-blue-600' : 'text-slate-400'}`}
            />
            <p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-1">
              Drag and drop your file here
            </p>
            <p className="text-[12px] text-slate-500 mb-4">or click below to browse</p>

            <button
              onClick={handleClick}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors"
            >
              Select File
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedMimeTypes.join(',')}
              onChange={handleFileSelect}
              className="hidden"
              aria-label="Upload BOM file"
            />
          </div>

          {/* Supported formats info — tells users up front how to handle
              Numbers and Google Sheets without making them discover the
              "wrong format" error first. */}
          <div className="mt-4 p-3 bg-slate-100 rounded text-[11px] text-slate-600 leading-relaxed">
            <p>
              <strong>Supported formats:</strong> {acceptedFormats.join(', ')} (max 10MB)
            </p>
            <p className="mt-1.5">
              <strong>Apple Numbers:</strong> File → Export To → Excel… and upload the .xlsx.
            </p>
            <p className="mt-1">
              <strong>Google Sheets:</strong> File → Download → Microsoft Excel (.xlsx) and upload that.
            </p>
            <p className="mt-1.5 text-slate-500">
              File must have exactly 2 columns: <em>Manufacturer</em> and <em>Part Number</em>.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-600">
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          {/* File selected state */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 p-2 bg-blue-100 rounded">
                  <File size={20} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={handleRemoveFile}
                className="flex-shrink-0 p-1 hover:bg-slate-200 rounded transition-colors ml-2"
                aria-label="Remove file"
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          {/* Analyze button */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Analyze BOM
                </>
              )}
            </button>
          </div>

          {/* Error message for analysis */}
          {error && analysisResults.length === 0 && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-600">
              {error}
            </div>
          )}

          {/* Analysis results table */}
          {analysisResults.length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="mb-4">
                <p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2">
                  Analysis Results
                </p>
                <div className="flex items-center justify-between text-[12px] text-slate-600 mb-3">
                  <span>
                    Progress: {analysisProgress}/{analysisResults.length} completed
                  </span>
                  {isAnalyzing && (
                    <span className="flex items-center gap-1">
                      <Loader2 size={14} className="animate-spin" />
                      Analyzing...
                    </span>
                  )}
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full transition-all duration-300"
                    style={{ width: `${(analysisProgress / analysisResults.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Results table */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Manufacturer</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Part Number</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Status</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Equivalent</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">New Part #</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Confidence</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Notes</th>
                      <th className="px-3 py-2 text-left font-black text-slate-900">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysisResults.map((result) => {
                      let statusIcon = null;
                      let statusText = '';
                      let rowBgColor = '';

                      if (result.status === 'error') {
                        statusIcon = <AlertTriangle size={14} className="text-orange-500" />;
                        statusText = 'Error';
                        rowBgColor = 'bg-orange-50 hover:bg-orange-100';
                      } else if (result.status === 'found') {
                        statusIcon = <CheckCircle2 size={14} className="text-emerald-500" />;
                        statusText = 'Found';
                        rowBgColor = 'bg-emerald-50 hover:bg-emerald-100';
                      } else if (result.status === 'not-found') {
                        statusIcon = <AlertTriangle size={14} className="text-red-500" />;
                        statusText = 'Not found';
                        rowBgColor = 'bg-red-50 hover:bg-red-100';
                      } else {
                        statusIcon = <Loader2 size={14} className="animate-spin text-blue-500" />;
                        statusText = 'Searching';
                        rowBgColor = 'bg-blue-50 hover:bg-blue-100';
                      }

                      let confidenceBadge = null;
                      if (result.confidence === 'exact') {
                        confidenceBadge = (
                          <span className="inline-block bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[11px] font-semibold">
                            Exact Match
                          </span>
                        );
                      } else if (result.confidence === 'spec-based') {
                        confidenceBadge = (
                          <span className="inline-block bg-amber-100 text-amber-700 px-2 py-1 rounded text-[11px] font-semibold">
                            Spec-Based
                          </span>
                        );
                      }

                      return (
                        <tr key={result.rowIndex} className={`border-b border-slate-200 transition-colors ${rowBgColor} align-top`}>
                          <td className="px-3 py-2 text-slate-900">{result.manufacturer}</td>
                          <td className="px-3 py-2 text-slate-900">{result.partNumber}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {statusIcon}
                              <span className="text-slate-600">{statusText}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-900">{result.equivalent || '—'}</td>
                          <td className="px-3 py-2 text-slate-900">{result.newPartNumber || '—'}</td>
                          <td className="px-3 py-2">{confidenceBadge}</td>
                          <td className="px-3 py-2 text-slate-700 max-w-[28ch]">
                            {result.notes ? (
                              <span className="leading-snug">{result.notes}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {result.sourceUrl ? (
                              <a
                                href={result.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline break-all"
                              >
                                Open
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Download button */}
              {!isAnalyzing && (
                <button
                  onClick={handleDownloadResults}
                  className="mt-4 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors"
                >
                  <Download size={14} />
                  Download Results
                </button>
              )}

              {/* Error message for download */}
              {error && analysisResults.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-600">
                  {error}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BOMAnalyzerTool;
