// ---------------------------------------------------------------------------
// DocGuardTool.tsx
//
// Upload a manufacturing PDF, audit it via /api/docguard, render findings,
// download an annotated PDF (sidebar overlays + summary page) built locally
// via pdf-lib. Audit metadata is persisted to the docGuardAudits Firestore
// collection so the user can revisit prior runs.
//
// Mounted from AdvancedToolsModal (project-agnostic, like Alt BOM).
// ---------------------------------------------------------------------------

import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  X,
  File as FileIcon,
  Loader2,
  Download,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ShieldCheck,
  Image as ImageIcon,
  ListOrdered,
  GitBranch,
  Type
} from 'lucide-react';
import { auth } from './firebase.ts';
import {
  auditPdf,
  saveAudit,
  listAudits,
  deleteAudit,
  type SavedAudit,
  type AuditResponse
} from './docGuardClient.ts';
import { buildAnnotatedPdf } from './utils/docGuardPdf.ts';
import type {
  Finding,
  FindingCategory,
  FindingSeverity
} from './utils/docGuardPdfHelpers.ts';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

const CATEGORY_META: Record<
  FindingCategory,
  { label: string; icon: React.ReactNode }
> = {
  grammar:   { label: 'Grammar',   icon: <Type size={12} /> },
  gmp:       { label: 'GMP',       icon: <ShieldCheck size={12} /> },
  logic:     { label: 'Logic/DFA', icon: <GitBranch size={12} /> },
  image:     { label: 'Image',     icon: <ImageIcon size={12} /> },
  numbering: { label: 'Numbering', icon: <ListOrdered size={12} /> }
};

const SEVERITY_META: Record<
  FindingSeverity,
  { label: string; bg: string; text: string; dot: string }
> = {
  high:   { label: 'High',   bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500' },
  medium: { label: 'Medium', bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  low:    { label: 'Low',    bg: 'bg-slate-50',  text: 'text-slate-600',  dot: 'bg-slate-400' }
};

const VERDICT_META: Record<
  AuditResponse['summary']['overallVerdict'],
  { label: string; bg: string; text: string }
> = {
  pass:          { label: 'PASS',          bg: 'bg-emerald-600', text: 'text-white' },
  minor_issues:  { label: 'MINOR ISSUES',  bg: 'bg-amber-500',   text: 'text-white' },
  major_issues:  { label: 'MAJOR ISSUES',  bg: 'bg-red-600',     text: 'text-white' }
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function downloadBlob(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser can finish initiating the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function annotatedFileName(original: string): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}__doc_guard.pdf`;
}

const DocGuardTool: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [history, setHistory] = useState<SavedAudit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshHistory() {
    if (!auth.currentUser) return;
    setHistoryLoading(true);
    try {
      const audits = await listAudits();
      setHistory(audits);
    } catch (err) {
      // Don't block the main flow on history failures.
      console.warn('Failed to load DocGuard history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }

  function validateFile(file: File): boolean {
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setError('Only PDF files are accepted.');
      return false;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(`File is ${formatFileSize(file.size)}. Max ${formatFileSize(MAX_PDF_BYTES)}.`);
      return false;
    }
    setError(null);
    return true;
  }

  function handleDrag(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f && validateFile(f)) {
      setSelectedFile(f);
      setResult(null);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.currentTarget.files?.[0];
    if (f && validateFile(f)) {
      setSelectedFile(f);
      setResult(null);
    }
  }

  function handleRemove() {
    setSelectedFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleAudit() {
    if (!selectedFile) return;
    if (!auth.currentUser) {
      setError('Sign in to use Doc Guard.');
      return;
    }

    setIsAuditing(true);
    setError(null);
    setResult(null);

    try {
      const audit = await auditPdf(selectedFile);
      setResult(audit);
      // Persist (best-effort — don't block the UI if Firestore write fails).
      try {
        await saveAudit(selectedFile.name, selectedFile.size, audit);
        await refreshHistory();
      } catch (persistErr) {
        console.warn('Failed to persist audit:', persistErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAuditing(false);
    }
  }

  async function handleDownloadAnnotated() {
    if (!selectedFile || !result) return;
    try {
      const buf = await selectedFile.arrayBuffer();
      const annotated = await buildAnnotatedPdf(buf, result.findings, result.summary);
      downloadBlob(annotated, annotatedFileName(selectedFile.name));
    } catch (err) {
      setError(`Could not build annotated PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDeleteHistory(id: string) {
    if (!confirm('Delete this audit from history?')) return;
    try {
      await deleteAudit(id);
      setHistory((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Counts for the result header.
  const counts = result
    ? result.findings.reduce(
        (acc, f) => {
          acc[f.severity]++;
          return acc;
        },
        { high: 0, medium: 0, low: 0 } as Record<FindingSeverity, number>
      )
    : null;

  return (
    <div className="text-slate-900">
      {/* Intro */}
      <div className="mb-4">
        <p className="text-[13px] text-slate-600 leading-relaxed">
          Upload a manufacturing PDF (SOP, work instruction, assembly procedure).
          Doc Guard audits grammar, step numbering, GMP structure, assembly
          logic, and image clarity, then returns short, actionable comments —
          plus an annotated PDF you can hand to the author.
        </p>
      </div>

      {/* Upload area */}
      {!selectedFile ? (
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
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload
            size={32}
            className={`mx-auto mb-3 ${dragActive ? 'text-blue-600' : 'text-slate-400'}`}
          />
          <p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-1">
            Drop a PDF here
          </p>
          <p className="text-[12px] text-slate-500 mb-4">
            or click to browse · PDF only · max {formatFileSize(MAX_PDF_BYTES)}
          </p>
          <button
            type="button"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            Select PDF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="Upload PDF"
          />
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0 p-2 bg-blue-100 rounded">
                <FileIcon size={20} className="text-blue-600" />
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
              type="button"
              onClick={handleRemove}
              disabled={isAuditing}
              className="flex-shrink-0 p-1 hover:bg-slate-200 rounded transition-colors ml-2 disabled:opacity-40"
              aria-label="Remove file"
            >
              <X size={18} className="text-slate-500" />
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-700 flex items-start gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Audit button */}
      {selectedFile && !result && (
        <div className="mt-6 pt-6 border-t border-slate-200">
          <button
            type="button"
            onClick={handleAudit}
            disabled={isAuditing}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2"
          >
            {isAuditing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Auditing — this can take 20–40s for large docs…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Audit Document
              </>
            )}
          </button>
        </div>
      )}

      {/* Result */}
      {result && counts && (
        <div className="mt-6 pt-6 border-t border-slate-200">
          {/* Verdict header */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span
              className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded ${VERDICT_META[result.summary.overallVerdict].bg} ${VERDICT_META[result.summary.overallVerdict].text}`}
            >
              {VERDICT_META[result.summary.overallVerdict].label}
            </span>
            <span className="text-[12px] text-slate-600">
              {result.findings.length} finding{result.findings.length === 1 ? '' : 's'}
              {' · '}
              <span className="text-red-700">{counts.high} high</span>{' · '}
              <span className="text-amber-700">{counts.medium} med</span>{' · '}
              <span className="text-slate-500">{counts.low} low</span>
            </span>
          </div>
          {result.summary.headline && (
            <p className="text-[13px] text-slate-700 mb-4 leading-relaxed">
              {result.summary.headline}
            </p>
          )}

          {/* Download */}
          <button
            type="button"
            onClick={handleDownloadAnnotated}
            className="mb-5 inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors"
          >
            <Download size={14} />
            Download Annotated PDF
          </button>

          {/* Findings list */}
          {result.findings.length === 0 ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded text-[13px] text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} />
              No issues found. Document looks clean.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {result.findings.map((f, i) => (
                <FindingRow key={i} finding={f} />
              ))}
            </div>
          )}

          {/* Reset */}
          <button
            type="button"
            onClick={handleRemove}
            className="mt-5 text-[11px] text-slate-500 hover:text-slate-700 underline"
          >
            Audit another document
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-3">
            Recent audits {historyLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
          </h3>
          <div className="space-y-1.5">
            {history.slice(0, 8).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 text-[12px] text-slate-700 px-2 py-1.5 hover:bg-slate-50 rounded"
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${VERDICT_META[a.summary.overallVerdict].bg}`}
                />
                <span className="flex-1 truncate font-medium">{a.fileName}</span>
                <span className="text-slate-400 text-[11px] tabular-nums">
                  {a.findings.length} finding{a.findings.length === 1 ? '' : 's'}
                </span>
                <span className="text-slate-400 text-[11px]">
                  {new Date(a.createdAtMs).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteHistory(a.id)}
                  className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                  aria-label="Delete audit"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FindingRow: React.FC<{ finding: Finding }> = ({ finding }) => {
  const sev = SEVERITY_META[finding.severity];
  const cat = CATEGORY_META[finding.category];
  return (
    <div className={`p-3 rounded border border-slate-200 ${sev.bg}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${sev.dot}`} />
        <span className={`text-[10px] font-black uppercase tracking-widest ${sev.text}`}>
          {sev.label}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {cat.icon}
          {cat.label}
        </span>
        <span className="ml-auto text-[10px] font-bold text-slate-500 tabular-nums">
          PAGE {finding.page}
        </span>
      </div>
      {finding.quote && (
        <p className="text-[11px] text-slate-500 italic mb-1 leading-snug">
          "{finding.quote}"
        </p>
      )}
      <p className="text-[12px] text-slate-800 leading-relaxed">{finding.comment}</p>
    </div>
  );
};

export default DocGuardTool;
