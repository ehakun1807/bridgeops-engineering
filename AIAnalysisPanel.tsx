// ---------------------------------------------------------------------------
// AI Analysis panel — 6th tab on ProjectDeepDive.
// Calls /api/ai-analyze, renders narrative + top actions + risk flags, caches
// last result on the project doc so reopens don't re-bill the Gemini free tier.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  AlertOctagon,
  Flame,
  Target,
  RefreshCw,
  Clock,
  ArrowRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { analyzeProject, AIAnalysis, AnalyzeProjectInput } from './aiClient';

interface AIAnalysisPanelProps {
  projectInput: AnalyzeProjectInput;
  cached?: AIAnalysis | null;
  onAnalyzed: (analysis: AIAnalysis) => void;
  readOnly?: boolean;
}

const IMPACT_STYLES: Record<'high' | 'medium' | 'low', string> = {
  high:   'bg-red-100 text-red-700 border-red-300',
  medium: 'bg-amber-100 text-amber-700 border-amber-300',
  low:    'bg-slate-100 text-slate-600 border-slate-300'
};

const SEVERITY_ICON: Record<'high' | 'medium' | 'low', React.ComponentType<{ size?: number; className?: string }>> = {
  high:   AlertOctagon,
  medium: AlertTriangle,
  low:    Flame
};

const SEVERITY_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high:   'text-red-600',
  medium: 'text-amber-600',
  low:    'text-slate-500'
};

const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({
  projectInput,
  cached,
  onAnalyzed,
  readOnly = false
}) => {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(cached ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeProject(projectInput);
      setAnalysis(result);
      onAnalyzed(result);
    } catch (err: any) {
      setError(err?.message || 'Analysis failed — please retry.');
    } finally {
      setLoading(false);
    }
  };

  const age = analysis
    ? (() => {
        const mins = Math.floor((Date.now() - analysis.generatedAt) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      })()
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-sm">
            <Sparkles size={18} className="text-blue-300" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">
              Powered by Gemini
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              AI Analysis
            </h3>
          </div>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={runAnalyze}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow transition-colors"
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : analysis ? (
              <RefreshCw size={12} />
            ) : (
              <Sparkles size={12} />
            )}
            {loading ? 'Analyzing…' : analysis ? 'Regenerate' : 'Analyze Project'}
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Age / meta line */}
        {analysis && (
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <Clock size={10} />
            Last analysis: {age}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-[11px] font-bold border-l-4 border-red-500 flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Empty state */}
        {!analysis && !loading && !error && (
          <div className="py-12 text-center">
            <Sparkles size={28} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[12px] font-black uppercase tracking-widest text-slate-600 mb-2">
              Get an AI readiness assessment
            </p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
              Synthesizes your scores, notes, and timeline into a plain-English
              summary, top actions, and risk flags. Takes ~10 seconds.
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !analysis && (
          <div className="py-12 text-center">
            <Loader2 size={28} className="mx-auto text-blue-500 animate-spin mb-3" />
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
              Gemini is reading your project…
            </p>
          </div>
        )}

        {/* Results */}
        {analysis && (
          <motion.div
            key={analysis.generatedAt}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            {/* Narrative */}
            <section>
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">
                Readiness Narrative
              </h4>
              <div className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">
                {analysis.narrative}
              </div>
            </section>

            {/* Top actions */}
            {analysis.topActions.length > 0 && (
              <section>
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3 flex items-center gap-2">
                  <Target size={12} />
                  Top Next Actions
                </h4>
                <ol className="space-y-3">
                  {analysis.topActions.map((act, i) => (
                    <li
                      key={i}
                      className="flex gap-4 p-4 bg-slate-50 border border-slate-200 rounded-sm"
                    >
                      <div className="flex-shrink-0 w-8 h-8 bg-slate-900 text-white font-black flex items-center justify-center text-sm">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <p className="text-[12px] font-black text-slate-900 leading-snug">
                            {act.title}
                          </p>
                          <span
                            className={`flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border ${IMPACT_STYLES[act.impact]}`}
                          >
                            {act.impact}
                          </span>
                        </div>
                        <p className="text-[12px] text-slate-600 leading-relaxed flex gap-2">
                          <ArrowRight size={12} className="mt-1 flex-shrink-0 text-slate-400" />
                          <span>{act.rationale}</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Risks */}
            {analysis.risks.length > 0 && (
              <section>
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3 flex items-center gap-2">
                  <AlertTriangle size={12} />
                  Risk Flags
                </h4>
                <ul className="space-y-2">
                  {analysis.risks.map((risk, i) => {
                    const Icon = SEVERITY_ICON[risk.severity];
                    return (
                      <li
                        key={i}
                        className="flex gap-3 p-3 bg-white border border-slate-200 rounded-sm"
                      >
                        <Icon
                          size={16}
                          className={`flex-shrink-0 mt-0.5 ${SEVERITY_COLOR[risk.severity]}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-black text-slate-900 leading-snug">
                            {risk.flag}
                          </p>
                          <p className="text-[10px] font-medium text-slate-500 mt-0.5">
                            Source: {risk.source}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Disclaimer */}
            <div className="pt-4 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
              AI-generated from your current project state. Use as a starting
              point — always verify with subject-matter experts.
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default AIAnalysisPanel;
