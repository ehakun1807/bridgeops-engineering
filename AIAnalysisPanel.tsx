// ---------------------------------------------------------------------------
// AI Analysis panel — utility tab on ProjectDeepDive.
// Fetches live tool signals (PFMEA, BOM Pulse, Meetings, Takt) from Firestore
// just before calling /api/ai-analyze, so the AI sees a full YTD snapshot.
// Caches last result on the project doc so reopens don't re-bill Gemini.
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
  ArrowRight,
  Activity
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Firestore
} from 'firebase/firestore';
import {
  analyzeProject,
  AIAnalysis,
  AnalyzeProjectInput,
  ToolContext,
  PFMEASignal,
  MeetingSignal,
  BomSignal,
  TaktSignal,
  DecisionSignal,
  LessonSignal,
  ControlPlanSignal,
  ConnectedProjectContext
} from './aiClient';
import type { ProjectStub } from './projectConnectionsClient.ts';

interface AIAnalysisPanelProps {
  projectInput: AnalyzeProjectInput;
  cached?: AIAnalysis | null;
  onAnalyzed: (analysis: AIAnalysis) => void;
  readOnly?: boolean;
  /** Needed for tool-data fetches. */
  projectId: string;
  userId: string;
  db: Firestore;
  /** Already on the project doc — pass through so we skip an extra read. */
  taktSummary?: TaktSignal;
  /** IDs of projects connected to this one — enables cross-project AI signals. */
  connectedProjectIds?: string[];
  /** All user projects (for name lookup on connected projects). */
  allUserProjects?: ProjectStub[];
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

// ---------------------------------------------------------------------------
// Fetch helpers — pull just the fields the AI needs; keep payloads small.
// ---------------------------------------------------------------------------

async function fetchToolContext(
  db: Firestore,
  userId: string,
  projectId: string,
  taktSummary?: TaktSignal,
  connectedProjectIds?: string[],
  projectNameMap?: Map<string, string>
): Promise<{ toolContext: ToolContext; connectedProjectsContext?: ConnectedProjectContext[] }> {
  const ctx: ToolContext = {};

  // Takt is already on the project doc — pass it straight through.
  if (taktSummary) {
    ctx.takt = taktSummary;
  }

  // PFMEA — up to 3 most-recent, extract top risks per FMEA.
  try {
    const pfmeaSnap = await getDocs(
      query(
        collection(db, 'pfmeas'),
        where('userId', '==', userId),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc'),
        limit(3)
      )
    );
    if (!pfmeaSnap.empty) {
      ctx.pfmeas = pfmeaSnap.docs.map((d) => {
        const data = d.data() as any;
        const risks: any[] = Array.isArray(data.risks) ? data.risks : [];
        const rpn = (r: any) => (r.severity ?? 1) * (r.occurrence ?? 1) * (r.detection ?? 1);
        const sorted = [...risks].sort((a, b) => rpn(b) - rpn(a));
        const highCount = risks.filter((r) => rpn(r) > 100).length;
        const mediumCount = risks.filter((r) => rpn(r) >= 40 && rpn(r) <= 100).length;
        const maxRpn = sorted.length > 0 ? rpn(sorted[0]) : 0;
        const topRisks = sorted.slice(0, 3).map((r) => ({
          processStep: String(r.processStep || '').slice(0, 60),
          failureMode: String(r.failureMode || '').slice(0, 60),
          rpn: rpn(r)
        }));
        return {
          title: String(data.title || 'Untitled'),
          dateMs: Number(data.dateMs || 0),
          totalRisks: risks.length,
          highCount,
          mediumCount,
          maxRpn,
          topRisks
        } satisfies PFMEASignal;
      });
    }
  } catch (e) {
    console.warn('[AIAnalysisPanel] pfmeas fetch failed', e);
  }

  // Meetings — up to 5 most-recent.
  try {
    const meetSnap = await getDocs(
      query(
        collection(db, 'meetings'),
        where('userId', '==', userId),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc'),
        limit(5)
      )
    );
    if (!meetSnap.empty) {
      ctx.recentMeetings = meetSnap.docs.map((d) => {
        const data = d.data() as any;
        const ai = String(data.actionItems || '').trim();
        return {
          dateMs: Number(data.dateMs || 0),
          title: String(data.title || 'Untitled').slice(0, 100),
          type: data.meetingType === 'External' ? 'External' : 'Internal',
          hasActionItems: ai.length > 0,
          actionItemsPreview: ai.length > 0 ? ai.slice(0, 300) : undefined
        } satisfies MeetingSignal;
      });
    }
  } catch (e) {
    console.warn('[AIAnalysisPanel] meetings fetch failed', e);
  }

  // BOM Pulse — latest 1.
  try {
    const bomSnap = await getDocs(
      query(
        collection(db, 'productBoms'),
        where('userId', '==', userId),
        where('projectId', '==', projectId),
        orderBy('uploadedAtMs', 'desc'),
        limit(1)
      )
    );
    if (!bomSnap.empty) {
      const data = bomSnap.docs[0].data() as any;
      const ia = data.impactAnalysis;
      const bom: BomSignal = {
        versionLabel: data.versionLabel || undefined,
        uploadedAtMs: Number(data.uploadedAtMs || 0),
        effectiveDateMs: data.effectiveDateMs || undefined,
        reasonForChange: data.reasonForChange
          ? String(data.reasonForChange).slice(0, 200)
          : undefined,
        totalLines: Number(data.totalLines || 0)
      };
      // Diff stats live on the doc after the client writes them back.
      if (data.diffStats) {
        bom.diff = {
          added: data.diffStats.added ?? 0,
          removed: data.diffStats.removed ?? 0,
          changed: data.diffStats.changed ?? 0,
          supplierSwapCount: data.diffStats.supplierSwapCount ?? 0,
          costDelta: data.diffStats.costDelta ?? 0
        };
      }
      if (ia?.narrative) {
        bom.aiImpactNarrative = String(ia.narrative).slice(0, 400);
      }
      if (data.eco?.ref) {
        bom.eco = {
          ref:      String(data.eco.ref),
          title:    data.eco.title ? String(data.eco.title) : undefined,
          status:   String(data.eco.status || 'open'),
          area:     String(data.eco.area || 'bom'),
          blocking: Boolean(data.eco.blocking),
        };
      }
      ctx.latestBom = bom;
    }
  } catch (e) {
    console.warn('[AIAnalysisPanel] productBoms fetch failed', e);
  }

  // Decision Ledger — up to 5 active + any reversed (for drift/instability detection).
  try {
    const decSnap = await getDocs(
      query(
        collection(db, 'decisions'),
        where('userId',    '==', userId),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc'),
        limit(10)
      )
    );
    if (!decSnap.empty) {
      const all = decSnap.docs.map(d => d.data() as any);
      // Keep up to 5 active + all reversed (reversed = instability signal)
      const active   = all.filter((d: any) => d.status === 'active').slice(0, 5);
      const reversed = all.filter((d: any) => d.status === 'reversed');
      ctx.decisions = [...active, ...reversed].map((d: any): DecisionSignal => ({
        title:         String(d.title         || '').slice(0, 150),
        dateMs:        Number(d.dateMs        || 0),
        decisionMaker: String(d.decisionMaker || '').slice(0, 60),
        description:   String(d.description  || '').slice(0, 300),
        rationale:     String(d.rationale     || '').slice(0, 200),
        relatedRisks:  d.relatedRisks ? String(d.relatedRisks).slice(0, 200) : undefined,
        impact:        d.impact       ? String(d.impact).slice(0, 200)       : undefined,
        status:        d.status in ['active', 'superseded', 'reversed'] ? d.status : 'active',
        category:      String(d.category || 'other'),
        gate:          d.gate ? String(d.gate) : undefined
      }));
    }
  } catch (e) {
    console.warn('[AIAnalysisPanel] decisions fetch failed', e);
  }

  // Lessons & Learned — up to 5 most recent, prioritising open + in-progress.
  try {
    const lessonSnap = await getDocs(
      query(
        collection(db, 'lessons'),
        where('userId',    '==', userId),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc'),
        limit(10)
      )
    );
    if (!lessonSnap.empty) {
      const all = lessonSnap.docs.map(d => d.data() as any);
      // Surface open + in-progress first (highest signal), then closed if space
      const openOrInProgress = all.filter((l: any) => l.status !== 'closed');
      const closed           = all.filter((l: any) => l.status === 'closed');
      const selected         = [...openOrInProgress, ...closed].slice(0, 5);
      ctx.lessons = selected.map((l: any): LessonSignal => {
        const actions: any[] = Array.isArray(l.actionItems) ? l.actionItems : [];
        const mustActions    = actions.filter((a: any) => a.priority === 'must');
        const openMust       = mustActions.filter((a: any) => !a.done);
        return {
          title:       String(l.title       || '').slice(0, 150),
          dateMs:      Number(l.dateMs      || 0),
          category:    String(l.category    || 'other'),
          lessonType:  l.lessonType in ['problem', 'improvement', 'best_practice']
                         ? l.lessonType : 'problem',
          status:      l.status in ['open', 'in_progress', 'closed'] ? l.status : 'open',
          gate:        l.gate ? String(l.gate) : undefined,
          description: String(l.description || '').slice(0, 300),
          rootCause:   l.rootCause ? String(l.rootCause).slice(0, 200) : undefined,
          openMustActions: openMust.slice(0, 3).map((a: any) => ({
            text:         String(a.text  || '').slice(0, 150),
            owner:        a.owner ? String(a.owner).slice(0, 60) : undefined,
            targetDateMs: a.targetDateMs ? Number(a.targetDateMs) : undefined
          })),
          totalMust: mustActions.length,
          totalNice: actions.filter((a: any) => a.priority === 'nice_to_have').length
        };
      });
    }
  } catch (e) {
    console.warn('[AIAnalysisPanel] lessons fetch failed', e);
  }

  // Control Plan — most-recent production plan (or pre-launch if none).
  try {
    const cpSnap = await getDocs(
      query(
        collection(db, 'controlPlans'),
        where('userId', '==', userId),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc'),
        limit(5)
      )
    );
    if (!cpSnap.empty) {
      // Prefer a production plan; fall back to most-recent if none.
      const all = cpSnap.docs.map(d => d.data() as any);
      const cp = all.find((d: any) => d.planType === 'production') ?? all[0];
      const items: any[] = Array.isArray(cp.items) ? cp.items : [];
      const critical    = items.filter((i: any) => i.specialClass === 'critical');
      const significant = items.filter((i: any) => i.specialClass === 'significant');
      // Top items: critical first, then significant, up to 5 total.
      const topRaw = [...critical, ...significant].slice(0, 5);
      ctx.controlPlan = {
        title:            String(cp.title || 'Untitled'),
        planType:         cp.planType in ['prototype', 'pre_launch', 'production'] ? cp.planType : 'prototype',
        dateMs:           Number(cp.dateMs || 0),
        totalItems:       items.length,
        criticalCount:    critical.length,
        significantCount: significant.length,
        topItems:         topRaw.map((i: any): ControlPlanSignal['topItems'][number] => ({
          processStep:      String(i.processStep || '').slice(0, 80),
          characteristic:   i.productCharacteristic
                              ? String(i.productCharacteristic).slice(0, 80)
                              : i.processCharacteristic
                                ? String(i.processCharacteristic).slice(0, 80)
                                : undefined,
          specialClass:     String(i.specialClass || 'none'),
          controlMethod:    i.controlMethod ? String(i.controlMethod).slice(0, 100) : undefined,
          reactionPlan:     i.reactionPlan  ? String(i.reactionPlan).slice(0, 100)  : undefined,
        }))
      } satisfies ControlPlanSignal;
    }
  } catch (e) {
    console.warn('[AIAnalysisPanel] controlPlans fetch failed', e);
  }

  // ---------------------------------------------------------------------------
  // Cross-project signals — fetch key tool data for each connected project.
  // Kept lightweight: up to 2 PFMEAs + 1 latest BOM + up to 5 active decisions
  // per connected project. Failures are non-fatal — missing signals are silently
  // skipped so a Firestore hiccup on a connected project never blocks the scan.
  // ---------------------------------------------------------------------------
  let connectedProjectsContext: ConnectedProjectContext[] | undefined;

  if (connectedProjectIds && connectedProjectIds.length > 0) {
    const connectedResults = await Promise.all(
      connectedProjectIds.slice(0, 10).map(async (connProjectId): Promise<ConnectedProjectContext> => {
        const projectName = projectNameMap?.get(connProjectId) ?? connProjectId;
        const connCtx: ConnectedProjectContext = { projectId: connProjectId, projectName };

        // PFMEA — up to 2 most-recent from connected project.
        try {
          const snap = await getDocs(
            query(
              collection(db, 'pfmeas'),
              where('userId', '==', userId),
              where('projectId', '==', connProjectId),
              orderBy('dateMs', 'desc'),
              limit(2)
            )
          );
          if (!snap.empty) {
            const rpn = (r: any) => (r.severity ?? 1) * (r.occurrence ?? 1) * (r.detection ?? 1);
            connCtx.pfmeas = snap.docs.map((d) => {
              const data = d.data() as any;
              const risks: any[] = Array.isArray(data.risks) ? data.risks : [];
              const sorted = [...risks].sort((a, b) => rpn(b) - rpn(a));
              const highCount = risks.filter((r) => rpn(r) > 100).length;
              const mediumCount = risks.filter((r) => rpn(r) >= 40 && rpn(r) <= 100).length;
              const maxRpn = sorted.length > 0 ? rpn(sorted[0]) : 0;
              return {
                title: String(data.title || 'Untitled'),
                dateMs: Number(data.dateMs || 0),
                totalRisks: risks.length,
                highCount,
                mediumCount,
                maxRpn,
                topRisks: sorted.slice(0, 3).map((r) => ({
                  processStep: String(r.processStep || '').slice(0, 60),
                  failureMode: String(r.failureMode || '').slice(0, 60),
                  rpn: rpn(r)
                }))
              } satisfies PFMEASignal;
            });
          }
        } catch (e) {
          console.warn(`[AIAnalysisPanel] connected pfmeas fetch failed for ${connProjectId}`, e);
        }

        // Latest BOM.
        try {
          const snap = await getDocs(
            query(
              collection(db, 'productBoms'),
              where('userId', '==', userId),
              where('projectId', '==', connProjectId),
              orderBy('uploadedAtMs', 'desc'),
              limit(1)
            )
          );
          if (!snap.empty) {
            const data = snap.docs[0].data() as any;
            const bom: BomSignal = {
              versionLabel: data.versionLabel || undefined,
              uploadedAtMs: Number(data.uploadedAtMs || 0),
              effectiveDateMs: data.effectiveDateMs || undefined,
              reasonForChange: data.reasonForChange
                ? String(data.reasonForChange).slice(0, 200)
                : undefined,
              totalLines: Number(data.totalLines || 0)
            };
            if (data.diffStats) {
              bom.diff = {
                added: data.diffStats.added ?? 0,
                removed: data.diffStats.removed ?? 0,
                changed: data.diffStats.changed ?? 0,
                supplierSwapCount: data.diffStats.supplierSwapCount ?? 0,
                costDelta: data.diffStats.costDelta ?? 0
              };
            }
            if (data.impactAnalysis?.narrative) {
              bom.aiImpactNarrative = String(data.impactAnalysis.narrative).slice(0, 300);
            }
            if (data.eco?.ref) {
              bom.eco = {
                ref:      String(data.eco.ref),
                title:    data.eco.title ? String(data.eco.title) : undefined,
                status:   String(data.eco.status || 'open'),
                area:     String(data.eco.area || 'bom'),
                blocking: Boolean(data.eco.blocking),
              };
            }
            connCtx.latestBom = bom;
          }
        } catch (e) {
          console.warn(`[AIAnalysisPanel] connected productBoms fetch failed for ${connProjectId}`, e);
        }

        // Active decisions + any reversed (instability/drift signal).
        try {
          const snap = await getDocs(
            query(
              collection(db, 'decisions'),
              where('userId', '==', userId),
              where('projectId', '==', connProjectId),
              orderBy('dateMs', 'desc'),
              limit(8)
            )
          );
          if (!snap.empty) {
            const all = snap.docs.map((d) => d.data() as any);
            const active   = all.filter((d: any) => d.status === 'active').slice(0, 5);
            const reversed = all.filter((d: any) => d.status === 'reversed');
            connCtx.decisions = [...active, ...reversed].map((d: any): DecisionSignal => ({
              title:         String(d.title         || '').slice(0, 150),
              dateMs:        Number(d.dateMs        || 0),
              decisionMaker: String(d.decisionMaker || '').slice(0, 60),
              description:   String(d.description  || '').slice(0, 300),
              rationale:     String(d.rationale     || '').slice(0, 200),
              relatedRisks:  d.relatedRisks ? String(d.relatedRisks).slice(0, 150) : undefined,
              impact:        d.impact       ? String(d.impact).slice(0, 150)       : undefined,
              status:        d.status in ['active', 'superseded', 'reversed'] ? d.status : 'active',
              category:      String(d.category || 'other'),
              gate:          d.gate ? String(d.gate) : undefined
            }));
          }
        } catch (e) {
          console.warn(`[AIAnalysisPanel] connected decisions fetch failed for ${connProjectId}`, e);
        }

        return connCtx;
      })
    );

    const populated = connectedResults.filter(
      (c) => c.pfmeas?.length || c.latestBom || c.decisions?.length
    );
    if (populated.length > 0) {
      connectedProjectsContext = populated;
    }
  }

  return { toolContext: ctx, connectedProjectsContext };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({
  projectInput,
  cached,
  onAnalyzed,
  readOnly = false,
  projectId,
  userId,
  db,
  taktSummary,
  connectedProjectIds,
  allUserProjects
}) => {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(cached ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      // Build a name map for connected projects so the AI sees project names.
      const projectNameMap = new Map<string, string>(
        (allUserProjects ?? []).map((p) => [p.id, p.name])
      );
      // Fetch primary tool data + cross-project signals in one call.
      const { toolContext, connectedProjectsContext } = await fetchToolContext(
        db,
        userId,
        projectId,
        taktSummary,
        connectedProjectIds,
        projectNameMap
      );
      const result = await analyzeProject({ ...projectInput, toolContext, connectedProjectsContext });
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
              Powered by Gemini · Full project scan
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
            {loading ? 'Scanning project…' : analysis ? 'Regenerate' : 'Analyze Project'}
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
            <Activity size={28} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[12px] font-black uppercase tracking-widest text-slate-600 mb-2">
              Full project scan
            </p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
              Reads your RAMP scores, PFMEA risks, BOM changes, meeting action items,
              and takt capacity — then gives you a YTD snapshot, top 5 actions, and
              up to 8 risk flags. Takes ~15 seconds.
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !analysis && (
          <div className="py-12 text-center">
            <Loader2 size={28} className="mx-auto text-blue-500 animate-spin mb-3" />
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
              Scanning scores, risks, BOM, meetings…
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
            {/* YTD Status Snapshot — prominent verdict card */}
            {analysis.statusSnapshot && (
              <div className="bg-slate-900 text-white px-5 py-4 rounded-sm flex items-start gap-3">
                <Activity size={16} className="text-blue-300 flex-shrink-0 mt-0.5" />
                <p className="text-[13px] font-bold leading-snug">
                  {analysis.statusSnapshot}
                </p>
              </div>
            )}

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
                  Top Actions
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
              AI-generated from your current project state including RAMP scores, PFMEA, BOM Pulse, meetings, and takt data. Use as a starting point — always verify with subject-matter experts.
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default AIAnalysisPanel;
