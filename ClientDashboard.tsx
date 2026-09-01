import React, { useState, useEffect, useMemo } from 'react';
import { fmiData, FMI_CLIENT_KEY, type Workstream, type ActionItem, type Risk } from './clients/fmi.ts';
import { ChevronDown, ChevronUp, Shield, AlertTriangle, CheckCircle2, Clock, Circle } from 'lucide-react';

// ─── Token gate ──────────────────────────────────────────────────────────────
function useClientKey(expectedKey: string): boolean {
  return useMemo(() => {
    const raw = window.location.hash; // e.g. #/clients/fmi?key=fmi2026
    const qIndex = raw.indexOf('?');
    if (qIndex === -1) return false;
    const params = new URLSearchParams(raw.slice(qIndex + 1));
    return params.get('key') === expectedKey;
  }, [expectedKey]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function wsStats(ws: Workstream) {
  const done = ws.tasks.filter(t => t.status === 'done').length;
  const progress = ws.tasks.filter(t => t.status === 'progress').length;
  const total = ws.tasks.length;
  const pct = Math.round(((done + progress * 0.5) / total) * 100);
  return { done, progress, total, pct };
}

function globalStats(data: typeof fmiData) {
  let done = 0, progress = 0, todo = 0;
  data.workstreams.forEach(ws => {
    ws.tasks.forEach(t => {
      if (t.status === 'done') done++;
      else if (t.status === 'progress') progress++;
      else todo++;
    });
  });
  const risks = data.risks.length;
  return { done, progress, todo, risks };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: 'done' | 'progress' | 'todo' }> = ({ status }) => {
  if (status === 'done') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">
      <CheckCircle2 size={9} /> Done
    </span>
  );
  if (status === 'progress') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
      <Clock size={9} /> In Progress
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
      <Circle size={9} /> To Do
    </span>
  );
};

const PriorityChip: React.FC<{ priority: 'high' | 'medium' | 'low' }> = ({ priority }) => {
  if (priority === 'high') return <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-red-100 text-red-600">High</span>;
  if (priority === 'medium') return <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-700">Medium</span>;
  return <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Low</span>;
};

const WorkstreamCard: React.FC<{ ws: Workstream; defaultOpen?: boolean }> = ({ ws, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const { done, total, pct } = wsStats(ws);

  const fillColor = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-blue-500';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-md bg-slate-900 text-blue-400 text-[11px] font-black flex items-center justify-center flex-shrink-0">
            {ws.number}
          </div>
          <span className="text-[13px] font-bold text-slate-900 leading-tight">{ws.name}</span>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{done}/{total}</span>
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      {/* mini progress track */}
      <div className="h-[3px] bg-slate-100 mx-4">
        <div className={`h-full rounded-full transition-all duration-500 ${fillColor}`} style={{ width: `${pct}%` }} />
      </div>

      {open && (
        <div className="px-4 py-3 border-t border-slate-100 flex flex-col gap-2.5">
          {ws.tasks.map(task => (
            <div key={task.id} className="flex items-start gap-2.5">
              <div className="mt-0.5 flex-shrink-0">
                <StatusBadge status={task.status} />
              </div>
              <div>
                <p className="text-[13px] text-slate-700 font-medium leading-snug">{task.text}</p>
                {task.note && <p className="text-[11px] text-slate-400 italic mt-0.5">{task.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RiskCard: React.FC<{ risk: Risk }> = ({ risk }) => {
  const borderColor = risk.level === 'high' ? 'border-l-red-500' : risk.level === 'medium' ? 'border-l-amber-500' : 'border-l-emerald-500';
  const labelColor = risk.level === 'high' ? 'text-red-500' : risk.level === 'medium' ? 'text-amber-500' : 'text-emerald-500';
  const icon = risk.level === 'high' ? '🔴' : risk.level === 'medium' ? '🟡' : '🟢';

  return (
    <div className={`bg-white border border-slate-200 border-l-4 ${borderColor} rounded-xl p-4 shadow-sm`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 ${labelColor}`}>{icon} {risk.level}</p>
      <p className="text-[13px] font-bold text-slate-900 mb-1">{risk.title}</p>
      <p className="text-[12px] text-slate-500 leading-relaxed">{risk.description}</p>
    </div>
  );
};

// ─── Access denied screen ────────────────────────────────────────────────────
const AccessDenied: React.FC = () => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
    <div className="text-center">
      <Shield size={32} className="text-slate-600 mx-auto mb-4" />
      <p className="text-slate-500 text-sm">Access restricted. Please use the link provided by BridgeOps.</p>
    </div>
  </div>
);

// ─── Main dashboard ──────────────────────────────────────────────────────────
const ClientDashboard: React.FC = () => {
  const authorized = useClientKey(FMI_CLIENT_KEY);
  const data = fmiData;
  const stats = globalStats(data);

  // Animate readiness bar on mount
  const [barWidth, setBarWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setBarWidth(data.overallReadiness), 400);
    return () => clearTimeout(t);
  }, [data.overallReadiness]);

  if (!authorized) return <AccessDenied />;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-slate-900 text-white sticky top-0 z-50 border-b border-white/5 shadow-xl">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5">

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-400 mb-0.5">
                Field Medical · BridgeOps
              </p>
              <h1 className="text-[18px] sm:text-xl font-black tracking-tight leading-tight">
                Operational Readiness Dashboard
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">{data.subtitle} · Updated {data.updatedAt}</p>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="flex flex-wrap gap-5 mt-4">
            {[
              { value: data.workstreams.length, label: 'Workstreams', color: 'text-blue-400' },
              { value: stats.done, label: 'Completed', color: 'text-emerald-400' },
              { value: stats.progress, label: 'In Progress', color: 'text-amber-400' },
              { value: stats.todo, label: 'Not Started', color: 'text-slate-400' },
              { value: stats.risks, label: 'Open Risks', color: 'text-red-400' },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <div className="flex flex-col gap-0.5">
                  <span className={`text-2xl font-black leading-none tabular-nums ${s.color}`}>{s.value}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{s.label}</span>
                </div>
                {i < arr.length - 1 && <div className="w-px bg-white/8 self-stretch my-1 hidden sm:block" />}
              </React.Fragment>
            ))}
          </div>

          {/* Readiness bar */}
          <div className="flex items-center gap-3 mt-3.5">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Overall Readiness</span>
            <div className="flex-1 max-w-xs h-[5px] bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="text-[12px] font-bold text-blue-400 tabular-nums">{data.overallReadiness}%</span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-10">

        {/* Workstreams */}
        <section>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 mb-4">Workstream Status</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {data.workstreams.map((ws, i) => (
              <div key={ws.id} className={ws.number === 5 ? 'md:col-span-2' : ''}>
                <WorkstreamCard ws={ws} defaultOpen={i === 0} />
              </div>
            ))}
          </div>
        </section>

        {/* Priority Actions */}
        <section>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 mb-4">Priority Action Items — Next 60 Days</p>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Action', 'Priority', 'Workstream', 'Owner', 'Target'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.actions.map((a: ActionItem, i) => (
                    <tr key={a.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i === data.actions.length - 1 ? 'border-0' : ''}`}>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-[13px] font-semibold text-slate-900 leading-snug">{a.title}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{a.detail}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><PriorityChip priority={a.priority} /></td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{a.workstream}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-800 text-blue-400 text-[8px] font-black flex items-center justify-center">
                            {a.owner.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-[12px] text-slate-500">{a.owner}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-400 tabular-nums whitespace-nowrap">{a.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Risks */}
        <section>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 mb-4">Key Risks</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {data.risks.map((r: Risk) => <RiskCard key={r.id} risk={r} />)}
          </div>
        </section>

      </div>

      {/* Footer */}
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pb-10 flex items-center justify-between gap-4 flex-wrap text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Prepared by BridgeOps · Eran Hakun · {data.updatedAt}
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={11} />
          Strictly Confidential · Field Medical Internal
        </div>
      </div>
    </div>
  );
};

export default ClientDashboard;
