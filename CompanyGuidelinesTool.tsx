// ---------------------------------------------------------------------------
// CompanyGuidelinesTool — Org-level company SOP / guideline manager.
//
// Allows uploading company procedure PDFs. On upload, Gemini extracts a
// structured list of actionable requirements. These requirements are then
// fed into every AI Analysis run across all projects, enabling automatic
// compliance drift detection.
//
// Lives as a tile in AdvancedToolsModal (org-level, not per-project).
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  Trash2,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldCheck
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import {
  loadOrgGuidelines,
  deleteOrgGuideline,
  uploadAndExtractGuideline,
  type OrgGuideline,
  type GuidelineSeverity
} from './orgGuidelinesClient.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

const SEVERITY_STYLES: Record<GuidelineSeverity, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  major:    'bg-amber-50 text-amber-700 border-amber-200',
  standard: 'bg-slate-50 text-slate-600 border-slate-200'
};

const CATEGORY_LABELS: Record<string, string> = {
  design_control:  'Design Control',
  process_control: 'Process Control',
  quality:         'Quality',
  supplier:        'Supplier',
  documentation:   'Documentation',
  regulatory:      'Regulatory',
  safety:          'Safety',
  validation:      'Validation',
  other:           'Other'
};

// ---------------------------------------------------------------------------
// Guideline card — collapsed/expanded view of one uploaded guideline
// ---------------------------------------------------------------------------

interface GuidelineCardProps {
  guideline: OrgGuideline;
  onDelete: (id: string) => void;
  deleting: boolean;
}

const GuidelineCard: React.FC<GuidelineCardProps> = ({ guideline, onDelete, deleting }) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const critical = guideline.requirements.filter(r => r.severity === 'critical').length;
  const major    = guideline.requirements.filter(r => r.severity === 'major').length;

  return (
    <div className="border border-slate-200 rounded bg-white">
      {/* Header row */}
      <div className="px-4 py-3 flex items-start gap-3">
        <FileText size={18} className="text-purple-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{guideline.fileName}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{guideline.summary}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] text-slate-400">{fmtDate(guideline.uploadedAtMs)}</span>
            <span className="text-[10px] text-slate-400">·</span>
            <span className="text-[10px] text-slate-600 font-semibold">{guideline.requirements.length} requirements</span>
            {critical > 0 && (
              <span className="text-[10px] font-bold text-rose-600">{critical} critical</span>
            )}
            {major > 0 && (
              <span className="text-[10px] font-bold text-amber-600">{major} major</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
            title={expanded ? 'Collapse' : 'View requirements'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={deleting}
                onClick={() => onDelete(guideline.id)}
                className="text-[10px] font-black uppercase text-white bg-red-600 hover:bg-red-700 px-2 py-1 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={10} className="animate-spin" /> : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-900 px-2 py-1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
              title="Remove guideline"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded requirements list */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5 max-h-64 overflow-y-auto">
          {guideline.requirements.map(r => (
            <div key={r.id} className="flex items-start gap-2">
              <span className={`inline-block text-[9px] font-black uppercase tracking-wide border px-1.5 py-0.5 flex-shrink-0 mt-0.5 ${SEVERITY_STYLES[r.severity]}`}>
                {r.severity}
              </span>
              <span className="text-[11px] text-slate-400 flex-shrink-0 mt-0.5">
                {CATEGORY_LABELS[r.category] ?? r.category}
              </span>
              <p className="text-[12px] text-slate-700 leading-snug">{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CompanyGuidelinesTool: React.FC = () => {
  const [guidelines, setGuidelines] = useState<OrgGuideline[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uid = auth.currentUser?.uid ?? '';

  const load = async () => {
    if (!uid) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const loaded = await loadOrgGuidelines(db, uid);
      setGuidelines(loaded);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load guidelines');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [uid]); // eslint-disable-line

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are supported.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('File must be under 15 MB.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const saved = await uploadAndExtractGuideline(db, file);
      setGuidelines(prev => [saved, ...prev]);
      setUploadSuccess(`"${saved.fileName}" extracted — ${saved.requirements.length} requirements loaded.`);
      setTimeout(() => setUploadSuccess(null), 5000);
    } catch (e: any) {
      setUploadError(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []); // eslint-disable-line

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteOrgGuideline(db, id);
      setGuidelines(prev => prev.filter(g => g.id !== id));
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const totalRequirements = guidelines.reduce((sum, g) => sum + g.requirements.length, 0);

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="bg-purple-50 border border-purple-200 rounded p-3 flex items-start gap-2">
        <ShieldCheck size={16} className="text-purple-600 mt-0.5 flex-shrink-0" />
        <p className="text-[12px] text-purple-800 leading-snug">
          Upload your company SOPs and procedures. Gemini extracts every actionable requirement — these are automatically checked against all projects during AI Analysis to surface compliance drift.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded p-6 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-purple-400 bg-purple-50' : 'border-slate-300 bg-slate-50 hover:border-purple-300 hover:bg-purple-50/50'
        } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-purple-500" />
            <p className="text-sm font-semibold text-purple-700">Extracting requirements…</p>
            <p className="text-[11px] text-purple-500">Gemini is reading the document — this takes 10–20 seconds</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={24} className="text-slate-400" />
            <p className="text-sm font-semibold text-slate-700">Drop a PDF here or click to browse</p>
            <p className="text-[11px] text-slate-400">SOPs, quality manuals, NPI procedures — up to 15 MB</p>
          </div>
        )}
      </div>

      {/* Upload feedback */}
      {uploadError && (
        <div className="border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-[12px] flex items-start gap-2 rounded">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
      {uploadSuccess && (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-[12px] flex items-start gap-2 rounded">
          <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
          <span>{uploadSuccess}</span>
        </div>
      )}

      {/* Guidelines list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
            Active Guidelines
            {guidelines.length > 0 && (
              <span className="ml-2 font-normal text-slate-400">
                {guidelines.length} document{guidelines.length !== 1 ? 's' : ''} · {totalRequirements} requirements
              </span>
            )}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-[12px] flex items-start gap-2 rounded">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : guidelines.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <ShieldCheck size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm">No guidelines uploaded yet.</p>
            <p className="text-[11px] mt-1">Upload your first SOP to enable compliance drift detection.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {guidelines.map(g => (
              <GuidelineCard
                key={g.id}
                guideline={g}
                onDelete={handleDelete}
                deleting={deletingId === g.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyGuidelinesTool;
