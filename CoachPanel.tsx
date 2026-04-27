// ---------------------------------------------------------------------------
// CoachPanel — renders a structured AI-generated coaching card for a single
// BridgeOps sub-parameter. Stateless: takes an advice payload (or loading /
// error state) and renders the card.
//
// Rendered below the DeliverableChecklist in MetricRow when the user clicks
// the "How to improve this" button. The user can still see and interact with
// the deliverable checklist while the card is open.
// ---------------------------------------------------------------------------

import React from 'react';
import {
  Sparkles,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Milestone,
  FileText,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Loader2
} from 'lucide-react';
import type { CoachAdvice, CoachProductGate } from './coachClient.ts';

interface CoachPanelProps {
  // The advice payload. undefined while loading; null if we have no data yet.
  advice: CoachAdvice | null | undefined;
  loading: boolean;
  error?: string | null;
  // Context shown in the header (so a user knows which sub-parameter this
  // card is for when multiple are expanded).
  subItemTitle: string;
  productType: string;
  // Callbacks — parent wires these up. All optional so the card can also be
  // rendered in truly read-only contexts later if we ever want to.
  onRefresh?: () => void;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  // True if the user has already thumbed this card (so we can disable).
  feedbackGiven?: 'up' | 'down' | null;
}

const GATE_CHIP_BG: Record<CoachProductGate, string> = {
  CR:  'bg-slate-200 text-slate-700',
  PDR: 'bg-blue-100 text-blue-800',
  CDR: 'bg-indigo-100 text-indigo-800',
  TRR: 'bg-amber-100 text-amber-800',
  PRR: 'bg-emerald-100 text-emerald-800',
  MP:  'bg-violet-100 text-violet-800'
};

function relativeTimeFromNow(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
}> = ({ icon, title }) => (
  <div className="flex items-center gap-1.5 mb-2">
    <span className="text-slate-500">{icon}</span>
    <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">
      {title}
    </h5>
  </div>
);

const CoachPanel: React.FC<CoachPanelProps> = ({
  advice,
  loading,
  error,
  subItemTitle,
  productType,
  onRefresh,
  onThumbsUp,
  onThumbsDown,
  feedbackGiven
}) => {
  return (
    <div className="mt-3 bg-gradient-to-br from-slate-50 to-blue-50/40 border border-slate-200 rounded-sm overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 text-white">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={13} className="text-blue-300 flex-shrink-0" />
          <p className="text-[10px] font-black uppercase tracking-[0.3em] truncate">
            Coacher · {subItemTitle}
          </p>
        </div>
        {productType && (
          <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest bg-white/10 px-2 py-0.5">
            {productType}
          </span>
        )}
      </div>

      {/* Loading state */}
      {loading && !advice && (
        <div className="p-6 flex items-center gap-3 text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <p className="text-[11px] font-bold uppercase tracking-widest">
            Generating best practices…
          </p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && !advice && (
        <div className="p-5 flex items-start gap-3 bg-red-50 border-t border-red-100">
          <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-red-800 mb-1">
              Couldn't load coaching advice
            </p>
            <p className="text-[11px] text-red-700 mb-2">{error}</p>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="text-[10px] font-black uppercase tracking-widest text-red-700 hover:text-red-900 underline"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {/* Populated state */}
      {advice && (
        <div className="p-5 space-y-5">
          {/* Summary */}
          <div className="bg-white border border-slate-200 px-4 py-3">
            <p className="text-[12px] font-medium text-slate-800 leading-relaxed">
              {advice.summary}
            </p>
          </div>

          {/* Rules of thumb */}
          {advice.rulesOfThumb.length > 0 && (
            <div>
              <SectionHeader
                icon={<BookOpen size={12} />}
                title="Rules of thumb"
              />
              <ul className="space-y-1.5">
                {advice.rulesOfThumb.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-slate-700 leading-snug"
                  >
                    <span className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-4 h-4 text-[9px] font-black bg-blue-600 text-white rounded-full">
                      {i + 1}
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended approach */}
          {advice.recommendedApproach.length > 0 && (
            <div>
              <SectionHeader
                icon={<CheckCircle2 size={12} />}
                title="Recommended approach"
              />
              <ol className="space-y-2">
                {advice.recommendedApproach.map((s, i) => (
                  <li
                    key={i}
                    className="bg-white border border-slate-200 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-black bg-slate-900 text-white rounded-full">
                        {i + 1}
                      </span>
                      <p className="text-[11px] font-black uppercase tracking-wide text-slate-800">
                        {s.step}
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug pl-6">
                      {s.detail}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Common pitfalls */}
          {advice.commonPitfalls.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 px-4 py-3">
              <SectionHeader
                icon={<AlertTriangle size={12} />}
                title="Common pitfalls"
              />
              <ul className="space-y-1">
                {advice.commonPitfalls.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-amber-900 leading-snug"
                  >
                    <span className="mt-1 flex-shrink-0 w-1 h-1 rounded-full bg-amber-700" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Gate guidance */}
          {advice.gateGuidance.length > 0 && (
            <div>
              <SectionHeader
                icon={<Milestone size={12} />}
                title="What to have at each gate"
              />
              <div className="space-y-1.5">
                {advice.gateGuidance.map((g, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-slate-700"
                  >
                    <span
                      className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-black tracking-widest ${GATE_CHIP_BG[g.gate] || 'bg-slate-200 text-slate-700'}`}
                    >
                      {g.gate}
                    </span>
                    <span className="leading-snug">{g.expectation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tooling + standards — two-column on wide screens */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {advice.toolingExamples.length > 0 && (
              <div>
                <SectionHeader
                  icon={<Wrench size={12} />}
                  title="Tooling examples"
                />
                <div className="flex flex-wrap gap-1.5">
                  {advice.toolingExamples.map((t, i) => (
                    <span
                      key={i}
                      className="inline-block bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {advice.referenceStandards.length > 0 && (
              <div>
                <SectionHeader
                  icon={<FileText size={12} />}
                  title="Reference standards"
                />
                <div className="flex flex-wrap gap-1.5">
                  {advice.referenceStandards.map((s, i) => (
                    <span
                      key={i}
                      className="inline-block bg-slate-900 text-white px-2 py-0.5 text-[10px] font-black tracking-wide"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer strip */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Generated {relativeTimeFromNow(advice.generatedAt)} ·{' '}
              {advice.modelVersion}
            </p>
            <div className="flex items-center gap-2">
              {onThumbsUp && (
                <button
                  type="button"
                  onClick={onThumbsUp}
                  disabled={feedbackGiven === 'up'}
                  title="Helpful"
                  className={`inline-flex items-center justify-center w-7 h-7 border transition-colors ${
                    feedbackGiven === 'up'
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-700 cursor-default'
                      : 'border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300'
                  }`}
                >
                  <ThumbsUp size={12} />
                </button>
              )}
              {onThumbsDown && (
                <button
                  type="button"
                  onClick={onThumbsDown}
                  disabled={feedbackGiven === 'down'}
                  title="Not helpful"
                  className={`inline-flex items-center justify-center w-7 h-7 border transition-colors ${
                    feedbackGiven === 'down'
                      ? 'bg-red-100 border-red-300 text-red-700 cursor-default'
                      : 'border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-700 hover:border-red-300'
                  }`}
                >
                  <ThumbsDown size={12} />
                </button>
              )}
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  title="Regenerate advice"
                  className="inline-flex items-center justify-center w-7 h-7 border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoachPanel;
