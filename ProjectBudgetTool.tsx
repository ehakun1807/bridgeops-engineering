// ---------------------------------------------------------------------------
// ProjectBudgetTool — per-project budget tracker.
//
// Tracks a single kickoff estimate vs. ongoing actual costs across six
// categories: labor, materials, test/equipment, capex, overhead, other.
// Each cost line is direct or indirect and can optionally reference an
// ECO Pulse entry. The tool mirrors a lightweight budgetSummary to the
// projectIntelligence collection (via the parent) for org-level cost
// pattern analysis.
//
// Single Firestore doc per project: projectBudgets/{projectId}
// No composite index needed (read by doc ID).
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet,
  Plus,
  Trash2,
  Pencil,
  Download,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  Link2
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { logActivity } from './activityLogger.ts';
import { downloadBudgetXlsx } from './budgetXlsx.ts';

// ---------------------------------------------------------------------------
// Types — exported so budgetXlsx.ts and aiClient.ts can share them.
// ---------------------------------------------------------------------------
export type CostCategory = 'labor' | 'material' | 'test_equipment' | 'capex' | 'overhead' | 'other';
export type CostType = 'direct' | 'indirect';

export interface CostLine {
  id: string;
  category: CostCategory;
  type: CostType;
  description: string;   // ≤ 200 chars
  amount: number;        // USD
  dateMs: number;        // UTC midnight
  linkedEcoId?: string;  // optional ECO Pulse / productBoms doc reference
}

export interface ProjectBudget {
  userId: string;
  projectId: string;
  kickoffEstimate: number;  // overall project cost estimate at kickoff
  notes: string;            // ≤ 500 chars
  lines: CostLine[];
  updatedAtMs: number;
  createdAtMs: number;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  labor:          'Working Hours',
  material:       'Materials & BOM',
  test_equipment: 'Test & Equipment',
  capex:          'CapEx',
  overhead:       'Overhead',
  other:          'Other',
};

const CATEGORY_BAR: Record<CostCategory, string> = {
  labor:          'bg-blue-500',
  material:       'bg-amber-500',
  test_equipment: 'bg-purple-500',
  capex:          'bg-rose-500',
  overhead:       'bg-slate-400',
  other:          'bg-green-500',
};

const CATEGORY_CHIP_TEXT: Record<CostCategory, string> = {
  labor:          'text-blue-700',
  material:       'text-amber-700',
  test_equipment: 'text-purple-700',
  capex:          'text-rose-700',
  overhead:       'text-slate-600',
  other:          'text-green-700',
};

const CATEGORY_CHIP_BG: Record<CostCategory, string> = {
  labor:          'bg-blue-50',
  material:       'bg-amber-50',
  test_equipment: 'bg-purple-50',
  capex:          'bg-rose-50',
  overhead:       'bg-slate-100',
  other:          'bg-green-50',
};

const CATEGORY_SELECTED_BORDER: Record<CostCategory, string> = {
  labor:          'border-blue-400 bg-blue-50 text-blue-700',
  material:       'border-amber-400 bg-amber-50 text-amber-700',
  test_equipment: 'border-purple-400 bg-purple-50 text-purple-700',
  capex:          'border-rose-400 bg-rose-50 text-rose-700',
  overhead:       'border-slate-400 bg-slate-100 text-slate-700',
  other:          'border-green-400 bg-green-50 text-green-700',
};

const ALL_CATEGORIES: CostCategory[] = ['labor', 'material', 'test_equipment', 'capex', 'overhead', 'other'];

const fmtCurrency = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const todayMs = (): number => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const genId = (): string =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const toDateInput = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

const fromDateInput = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface ProjectBudgetToolProps {
  projectId: string;
  projectName: string;
  readOnly?: boolean;
}

export default function ProjectBudgetTool({
  projectId,
  projectName,
  readOnly,
}: ProjectBudgetToolProps) {
  const user = auth.currentUser;

  const [budget, setBudget]     = useState<ProjectBudget | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [exporting, setExporting] = useState(false);

  // Estimate / notes inline edit
  const [editEstimate, setEditEstimate] = useState(false);
  const [estimateInput, setEstimateInput] = useState('');
  const [notesInput, setNotesInput]     = useState('');

  // Line form
  const [showForm, setShowForm]       = useState(false);
  const [editingLine, setEditingLine] = useState<CostLine | null>(null);
  const [fCategory, setFCategory]     = useState<CostCategory>('labor');
  const [fType, setFType]             = useState<CostType>('direct');
  const [fDescription, setFDescription] = useState('');
  const [fAmount, setFAmount]         = useState('');
  const [fDateMs, setFDateMs]         = useState(todayMs());
  const [fLinkedEcoId, setFLinkedEcoId] = useState('');
  const [formError, setFormError]     = useState('');

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getDoc(doc(db, 'projectBudgets', projectId))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as ProjectBudget;
          setBudget(data);
          setEstimateInput(String(data.kickoffEstimate ?? ''));
          setNotesInput(data.notes ?? '');
        }
      })
      .catch((e) => console.warn('[ProjectBudgetTool] load error', e))
      .finally(() => setLoading(false));
  }, [projectId, user]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  const saveBudget = useCallback(
    async (patch: { lines: CostLine[]; kickoffEstimate?: number; notes?: string }) => {
      if (!user) return;
      setSaving(true);
      try {
        const now     = Date.now();
        const existing = budget;
        const payload: ProjectBudget = {
          userId:          user.uid,
          projectId,
          kickoffEstimate: patch.kickoffEstimate ?? existing?.kickoffEstimate ?? 0,
          notes:           patch.notes ?? existing?.notes ?? '',
          lines:           patch.lines,
          updatedAtMs:     now,
          createdAtMs:     existing?.createdAtMs ?? now,
        };
        await setDoc(doc(db, 'projectBudgets', projectId), payload);
        setBudget(payload);

        const actualTotal = payload.lines.reduce((s, l) => s + l.amount, 0);
        logActivity({
          userId:      user.uid,
          projectId,
          eventType:   'budget_updated',
          tool:        'budget',
          title:       'Budget updated',
          detail:      `Estimate: ${fmtCurrency(payload.kickoffEstimate)} · Actual: ${fmtCurrency(actualTotal)} · ${payload.lines.length} line${payload.lines.length !== 1 ? 's' : ''}`,
          timestampMs: now,
          metadata:    { lineCount: payload.lines.length, estimate: payload.kickoffEstimate, actual: actualTotal },
        });
      } catch (e) {
        console.error('[ProjectBudgetTool] save error', e);
      } finally {
        setSaving(false);
      }
    },
    [user, projectId, budget]
  );

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const lines       = budget?.lines ?? [];
  const actualTotal = lines.reduce((s, l) => s + l.amount, 0);
  const estimate    = budget?.kickoffEstimate ?? 0;
  const variance    = actualTotal - estimate;
  const variancePct = estimate > 0 ? (variance / estimate) * 100 : 0;

  const byCategory = ALL_CATEGORIES.map((cat) => {
    const total = lines.filter((l) => l.category === cat).reduce((s, l) => s + l.amount, 0);
    return { cat, total };
  }).filter((c) => c.total > 0);

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------
  const openAdd = () => {
    setEditingLine(null);
    setFCategory('labor');
    setFType('direct');
    setFDescription('');
    setFAmount('');
    setFDateMs(todayMs());
    setFLinkedEcoId('');
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (line: CostLine) => {
    setEditingLine(line);
    setFCategory(line.category);
    setFType(line.type);
    setFDescription(line.description);
    setFAmount(String(line.amount));
    setFDateMs(line.dateMs);
    setFLinkedEcoId(line.linkedEcoId ?? '');
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingLine(null);
    setFormError('');
  };

  const handleSaveForm = async () => {
    if (!fDescription.trim()) { setFormError('Description is required.'); return; }
    const amt = parseFloat(fAmount);
    if (!fAmount || isNaN(amt) || amt < 0) { setFormError('Enter a valid amount ≥ 0.'); return; }

    const newLine: CostLine = {
      id:           editingLine?.id ?? genId(),
      category:     fCategory,
      type:         fType,
      description:  fDescription.trim(),
      amount:       amt,
      dateMs:       fDateMs,
      linkedEcoId:  fLinkedEcoId.trim() || undefined,
    };

    const newLines = editingLine
      ? lines.map((l) => (l.id === editingLine.id ? newLine : l))
      : [...lines, newLine];

    await saveBudget({ lines: newLines });
    closeForm();
  };

  const handleDeleteLine = async (id: string) => {
    if (!window.confirm('Delete this cost entry?')) return;
    await saveBudget({ lines: lines.filter((l) => l.id !== id) });
  };

  const handleSaveEstimate = async () => {
    const est = parseFloat(estimateInput);
    if (isNaN(est) || est < 0) return;
    await saveBudget({ lines, kickoffEstimate: est, notes: notesInput });
    setEditEstimate(false);
  };

  const handleCancelEstimate = () => {
    setEditEstimate(false);
    setEstimateInput(String(budget?.kickoffEstimate ?? ''));
    setNotesInput(budget?.notes ?? '');
  };

  const handleExport = async () => {
    if (!budget) return;
    setExporting(true);
    try {
      downloadBudgetXlsx(budget, projectName);
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span className="text-sm">Loading budget…</span>
      </div>
    );
  }

  const hasData    = lines.length > 0 || estimate > 0;
  const sortedLines = [...lines].sort((a, b) => b.dateMs - a.dateMs);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">

      {/* ── Header ── */}
      <div className="bg-slate-900 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium">
            Tool · Project Budget
          </p>
          <h3 className="text-white font-semibold text-sm mt-0.5 flex items-center gap-1.5">
            <Wallet size={14} className="text-green-400" />
            Budget Tracker
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {hasData && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded border border-slate-700 hover:border-slate-500 transition-colors"
            >
              {exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              Export
            </button>
          )}
          {!readOnly && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1 text-[11px] bg-green-600 hover:bg-green-500 text-white px-2.5 py-1 rounded transition-colors font-medium"
            >
              <Plus size={11} /> Add Cost
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Card ── */}
      <div className="p-4 border-b border-slate-100">

        {/* Top row: Estimate / Actual / Variance */}
        <div className="flex flex-wrap items-start gap-6 mb-4">

          {/* Kickoff Estimate */}
          <div className="min-w-[140px]">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Kickoff Estimate</p>
            {editEstimate ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  value={estimateInput}
                  onChange={(e) => setEstimateInput(e.target.value)}
                  className="w-28 border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                  min="0"
                  autoFocus
                />
                <button
                  onClick={handleSaveEstimate}
                  disabled={saving}
                  className="text-[11px] bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded transition-colors"
                >
                  {saving ? <Loader2 size={10} className="animate-spin" /> : 'Save'}
                </button>
                <button onClick={handleCancelEstimate} className="text-[11px] text-slate-400 hover:text-slate-600">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-slate-800">
                  {estimate > 0 ? fmtCurrency(estimate) : '—'}
                </span>
                {!readOnly && (
                  <button
                    onClick={() => setEditEstimate(true)}
                    className="text-[10px] text-slate-400 hover:text-green-600 border border-slate-200 hover:border-green-300 px-1.5 py-0.5 rounded transition-colors"
                  >
                    {estimate > 0 ? 'Edit' : 'Set estimate'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Actual Spent */}
          <div className="min-w-[120px]">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Actual Spent</p>
            <span className="text-2xl font-bold text-slate-800">{fmtCurrency(actualTotal)}</span>
          </div>

          {/* Variance — only when estimate is set */}
          {estimate > 0 && (
            <div className="min-w-[120px]">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Variance</p>
              <div className="flex items-center gap-1">
                {variance > 0
                  ? <TrendingUp size={15} className="text-rose-500" />
                  : variance < 0
                  ? <TrendingDown size={15} className="text-green-500" />
                  : <Minus size={15} className="text-slate-400" />}
                <span className={`text-xl font-bold ${variance > 0 ? 'text-rose-600' : variance < 0 ? 'text-green-600' : 'text-slate-500'}`}>
                  {variance >= 0 ? '+' : ''}{fmtCurrency(variance)}
                </span>
              </div>
              <p className={`text-[11px] mt-0.5 ${variance > 0 ? 'text-rose-500' : variance < 0 ? 'text-green-500' : 'text-slate-400'}`}>
                {variancePct >= 0 ? '+' : ''}{variancePct.toFixed(1)}% vs estimate
              </p>
            </div>
          )}
        </div>

        {/* Notes inline edit */}
        {editEstimate && (
          <div className="mt-3">
            <label className="text-[10px] text-slate-400 uppercase tracking-wider">
              Notes <span className="normal-case text-slate-300">(assumptions, constraints…)</span>
            </label>
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value.slice(0, 500))}
              rows={2}
              className="mt-1 w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] text-slate-600 resize-none focus:outline-none focus:ring-1 focus:ring-green-400"
              placeholder="e.g. Estimate based on SOW v2; excludes regulatory fees"
            />
            <p className="text-right text-[9px] text-slate-300">{notesInput.length}/500</p>
          </div>
        )}
        {budget?.notes && !editEstimate && (
          <p className="mt-1 text-[11px] text-slate-400 italic leading-snug">{budget.notes}</p>
        )}

        {/* Category breakdown */}
        {actualTotal > 0 && byCategory.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Spend by Category</p>
            <div className="space-y-2">
              {byCategory.map(({ cat, total }) => {
                const pct = (total / actualTotal) * 100;
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <span className={`text-[10px] font-medium w-32 shrink-0 ${CATEGORY_CHIP_TEXT[cat]}`}>
                      {COST_CATEGORY_LABELS[cat]}
                    </span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${CATEGORY_BAR[cat]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-600 font-medium w-14 text-right">
                      {fmtCurrency(total)}
                    </span>
                    <span className="text-[10px] text-slate-400 w-8 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Cost Lines ── */}
      {lines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Wallet size={30} className="mb-2 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No cost entries yet</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Log working hours, materials, equipment, capex & overhead
          </p>
          {!readOnly && (
            <button
              onClick={openAdd}
              className="mt-4 flex items-center gap-1.5 text-[11px] bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded transition-colors font-medium"
            >
              <Plus size={12} /> Add first entry
            </button>
          )}
        </div>
      ) : (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-[100px_150px_72px_1fr_90px_52px] gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-100">
            {['Date', 'Category', 'Type', 'Description', 'Amount', ''].map((h, i) => (
              <span key={i} className={`text-[9px] text-slate-400 uppercase tracking-wider ${i === 4 ? 'text-right' : ''}`}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-50">
            {sortedLines.map((line) => (
              <div
                key={line.id}
                className="grid grid-cols-[100px_150px_72px_1fr_90px_52px] gap-2 px-4 py-2.5 hover:bg-slate-50 group transition-colors items-center"
              >
                <span className="text-[11px] text-slate-500">{fmtDate(line.dateMs)}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-fit ${CATEGORY_CHIP_TEXT[line.category]} ${CATEGORY_CHIP_BG[line.category]}`}>
                  {COST_CATEGORY_LABELS[line.category]}
                </span>
                <span className="text-[10px] text-slate-400 capitalize">{line.type}</span>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[11px] text-slate-700 truncate">{line.description}</span>
                  {line.linkedEcoId && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] text-blue-500 bg-blue-50 px-1 py-0.5 rounded">
                      <Link2 size={8} /> ECO
                    </span>
                  )}
                </div>
                <span className="text-[12px] font-semibold text-slate-700 text-right">
                  {fmtCurrency(line.amount)}
                </span>
                <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => openEdit(line)}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteLine(line.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Total row */}
          <div className="grid grid-cols-[100px_150px_72px_1fr_90px_52px] gap-2 px-4 py-2 bg-slate-50 border-t border-slate-200">
            <span className="col-span-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider self-center">
              Total ({lines.length} {lines.length === 1 ? 'entry' : 'entries'})
            </span>
            <span className="text-[13px] font-bold text-slate-800 text-right">{fmtCurrency(actualTotal)}</span>
            <span />
          </div>
        </div>
      )}

      {/* ── Add / Edit Line Form (modal) ── */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={closeForm}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-[440px] pointer-events-auto">

                {/* Form header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <h4 className="text-sm font-semibold text-slate-800">
                    {editingLine ? 'Edit Cost Entry' : 'Add Cost Entry'}
                  </h4>
                  <button onClick={closeForm} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X size={16} />
                  </button>
                </div>

                {/* Form body */}
                <div className="p-4 space-y-4">

                  {/* Category */}
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase tracking-wider">Category</label>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      {ALL_CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setFCategory(cat)}
                          className={`text-[10px] py-1.5 rounded border font-medium transition-colors ${
                            fCategory === cat
                              ? CATEGORY_SELECTED_BORDER[cat]
                              : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                          }`}
                        >
                          {COST_CATEGORY_LABELS[cat]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Type */}
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase tracking-wider">Cost Type</label>
                    <div className="mt-1.5 flex gap-2">
                      {(['direct', 'indirect'] as CostType[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => setFType(t)}
                          className={`flex-1 text-[11px] py-1.5 rounded border font-medium capitalize transition-colors ${
                            fType === t
                              ? 'bg-green-50 text-green-700 border-green-400'
                              : 'border-slate-200 text-slate-500 hover:border-slate-300'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase tracking-wider">Description *</label>
                    <div className="relative mt-1.5">
                      <input
                        type="text"
                        value={fDescription}
                        onChange={(e) => setFDescription(e.target.value.slice(0, 200))}
                        className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                        placeholder="e.g. 3 × engineering days (CDR prep), Supplier A tooling NRE"
                      />
                      <span className="absolute right-2 top-1.5 text-[9px] text-slate-300">
                        {fDescription.length}/200
                      </span>
                    </div>
                  </div>

                  {/* Amount + Date side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider">Amount (USD) *</label>
                      <div className="relative mt-1.5">
                        <span className="absolute left-2.5 top-1.5 text-slate-400 text-sm pointer-events-none">$</span>
                        <input
                          type="number"
                          value={fAmount}
                          onChange={(e) => setFAmount(e.target.value)}
                          className="w-full border border-slate-200 rounded pl-6 pr-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                          placeholder="0"
                          min="0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider">Date</label>
                      <input
                        type="date"
                        value={toDateInput(fDateMs)}
                        onChange={(e) => e.target.value && setFDateMs(fromDateInput(e.target.value))}
                        className="mt-1.5 w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                      />
                    </div>
                  </div>

                  {/* ECO Reference (optional) */}
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase tracking-wider">
                      ECO / BOM Reference <span className="normal-case text-slate-300">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={fLinkedEcoId}
                      onChange={(e) => setFLinkedEcoId(e.target.value.slice(0, 60))}
                      className="mt-1.5 w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                      placeholder="ECO number, BOM revision label…"
                    />
                  </div>

                  {formError && (
                    <p className="text-xs text-rose-500 bg-rose-50 border border-rose-100 rounded px-2.5 py-1.5">
                      {formError}
                    </p>
                  )}
                </div>

                {/* Form footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100">
                  <button
                    onClick={closeForm}
                    className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveForm}
                    disabled={saving}
                    className="flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-4 py-1.5 rounded font-medium transition-colors"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />}
                    {editingLine ? 'Update Entry' : 'Add Entry'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
