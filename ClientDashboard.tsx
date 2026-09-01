import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase.ts';
import { fmiData as staticFmiData, FMI_CLIENT_KEY, type FMIData, type Workstream, type Task, type ActionItem, type Risk } from './clients/fmi.ts';
import { ChevronDown, ChevronUp, Shield, AlertTriangle, CheckCircle2, Clock, Circle, Save, Loader2, ListTodo, Square, CheckSquare, Plus } from 'lucide-react';

// ─── URL param helpers ────────────────────────────────────────────────────────
function useHashParams(): URLSearchParams {
  return useMemo(() => {
    const raw = window.location.hash;
    const qi = raw.indexOf('?');
    if (qi === -1) return new URLSearchParams();
    return new URLSearchParams(raw.slice(qi + 1));
  }, []);
}
function useClientKey(key: string) { return useHashParams().get('key') === key; }
function useEditMode() { return useHashParams().get('edit') === '1'; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function wsStats(ws: Workstream) {
  const done = ws.tasks.filter(t => t.status === 'done').length;
  const progress = ws.tasks.filter(t => t.status === 'progress').length;
  const total = ws.tasks.length;
  const pct = Math.round(((done + progress * 0.5) / total) * 100);
  return { done, progress, total, pct };
}
function globalStats(data: FMIData) {
  let done = 0, progress = 0, todo = 0;
  data.workstreams.forEach(ws => ws.tasks.forEach(t => {
    if (t.status === 'done') done++; else if (t.status === 'progress') progress++; else todo++;
  }));
  return { done, progress, todo, risks: data.risks.length };
}
function cycleStatus(s: Task['status']): Task['status'] {
  return s === 'todo' ? 'progress' : s === 'progress' ? 'done' : 'todo';
}

// ─── Inline edit primitives ───────────────────────────────────────────────────
const EditText: React.FC<{
  value: string; onChange: (v: string) => void;
  className?: string; placeholder?: string; multiline?: boolean;
}> = ({ value, onChange, className = '', placeholder, multiline }) => {
  const base = `bg-white/20 border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 w-full ${className}`;
  return multiline
    ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} className={base + ' resize-none'} />
    : <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} />;
};

const EditSelect: React.FC<{
  value: string; options: string[]; onChange: (v: string) => void; className?: string;
}> = ({ value, options, onChange, className = '' }) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    className={`bg-white border border-blue-300 rounded px-1.5 py-0.5 text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 ${className}`}
  >
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);

// ─── Badge components ─────────────────────────────────────────────────────────
const StatusBadge: React.FC<{ status: Task['status']; editMode?: boolean; onClick?: () => void }> = ({ status, editMode, onClick }) => {
  const ring = editMode ? 'cursor-pointer ring-2 ring-offset-1 ring-blue-300 hover:opacity-80 active:scale-95' : '';
  if (status === 'done') return (
    <span onClick={onClick} title={editMode ? 'Click to cycle' : undefined}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap transition-all ${ring}`}>
      <CheckCircle2 size={9} /> Done
    </span>
  );
  if (status === 'progress') return (
    <span onClick={onClick} title={editMode ? 'Click to cycle' : undefined}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap transition-all ${ring}`}>
      <Clock size={9} /> In Progress
    </span>
  );
  return (
    <span onClick={onClick} title={editMode ? 'Click to cycle' : undefined}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap transition-all ${ring}`}>
      <Circle size={9} /> To Do
    </span>
  );
};

const PriorityChip: React.FC<{ priority: ActionItem['priority'] }> = ({ priority }) => {
  if (priority === 'high') return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-red-100 text-red-600">High</span>;
  if (priority === 'medium') return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700">Medium</span>;
  return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Low</span>;
};

// ─── Workstream card ──────────────────────────────────────────────────────────
const WorkstreamCard: React.FC<{
  ws: Workstream; defaultOpen?: boolean; editMode?: boolean;
  onChange?: (updated: Workstream) => void;
}> = ({ ws, defaultOpen = false, editMode, onChange }) => {
  const [open, setOpen] = useState(defaultOpen || editMode);
  useEffect(() => { if (editMode) setOpen(true); }, [editMode]);
  const { done, total, pct } = wsStats(ws);
  const fillColor = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-blue-500';

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    onChange?.({ ...ws, tasks: ws.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t) });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <button className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3 focus:outline-none" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-md bg-slate-900 text-blue-400 text-[11px] font-black flex items-center justify-center flex-shrink-0">{ws.number}</div>
          {editMode
            ? <input value={ws.name} onChange={e => onChange?.({ ...ws, name: e.target.value })}
                onClick={e => e.stopPropagation()}
                className="text-[13px] font-bold text-slate-900 border-b border-blue-300 focus:outline-none bg-transparent w-full" />
            : <span className="text-[13px] font-bold text-slate-900 leading-tight">{ws.name}</span>
          }
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{done}/{total}</span>
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      <div className="h-[3px] bg-slate-100 mx-4">
        <div className={`h-full rounded-full transition-all duration-500 ${fillColor}`} style={{ width: `${pct}%` }} />
      </div>

      {open && (
        <div className="px-4 py-3 border-t border-slate-100 flex flex-col gap-3">
          {editMode && <p className="text-[9px] uppercase tracking-widest text-blue-400 font-bold">Click badge to cycle status</p>}
          {ws.tasks.map(task => (
            <div key={task.id} className="flex items-start gap-2.5">
              <div className="mt-0.5 flex-shrink-0">
                <StatusBadge status={task.status} editMode={editMode} onClick={editMode ? () => updateTask(task.id, { status: cycleStatus(task.status) }) : undefined} />
              </div>
              <div className="flex-1 min-w-0">
                {editMode
                  ? <>
                      <EditText value={task.text} onChange={v => updateTask(task.id, { text: v })} className="text-[13px] font-medium text-slate-700 mb-1" placeholder="Task description" />
                      <EditText value={task.note ?? ''} onChange={v => updateTask(task.id, { note: v })} className="text-[11px] text-slate-400" placeholder="Note (optional)" />
                    </>
                  : <>
                      <p className="text-[13px] text-slate-700 font-medium leading-snug">{task.text}</p>
                      {task.note && <p className="text-[11px] text-slate-400 italic mt-0.5">{task.note}</p>}
                    </>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Risk card ────────────────────────────────────────────────────────────────
const RiskCard: React.FC<{ risk: Risk; editMode?: boolean; onChange?: (r: Risk) => void }> = ({ risk, editMode, onChange }) => {
  const borderColor = risk.level === 'high' ? 'border-l-red-500' : risk.level === 'medium' ? 'border-l-amber-500' : 'border-l-emerald-500';
  const labelColor = risk.level === 'high' ? 'text-red-500' : risk.level === 'medium' ? 'text-amber-500' : 'text-emerald-500';
  const icon = risk.level === 'high' ? '🔴' : risk.level === 'medium' ? '🟡' : '🟢';

  return (
    <div className={`bg-white border border-slate-200 border-l-4 ${borderColor} rounded-xl p-4 shadow-sm`}>
      {editMode
        ? <EditSelect value={risk.level} options={['high', 'medium', 'low']} onChange={v => onChange?.({ ...risk, level: v as Risk['level'] })} className="mb-2" />
        : <p className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 ${labelColor}`}>{icon} {risk.level}</p>
      }
      {editMode
        ? <>
            <EditText value={risk.title} onChange={v => onChange?.({ ...risk, title: v })} className="text-[13px] font-bold text-slate-900 mb-1" placeholder="Risk title" />
            <EditText value={risk.description} onChange={v => onChange?.({ ...risk, description: v })} className="text-[12px] text-slate-500" placeholder="Description" multiline />
          </>
        : <>
            <p className="text-[13px] font-bold text-slate-900 mb-1">{risk.title}</p>
            <p className="text-[12px] text-slate-500 leading-relaxed">{risk.description}</p>
          </>
      }
    </div>
  );
};

// ─── Access denied ────────────────────────────────────────────────────────────
const AccessDenied: React.FC = () => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
    <div className="text-center">
      <Shield size={32} className="text-slate-600 mx-auto mb-4" />
      <p className="text-slate-500 text-sm">Access restricted. Please use the link provided by BridgeOps.</p>
    </div>
  </div>
);

// ─── Firestore ────────────────────────────────────────────────────────────────
const FMI_DOC = 'clients/fmi';
async function loadFromFirestore(): Promise<FMIData | null> {
  try { const s = await getDoc(doc(db, FMI_DOC)); return s.exists() ? s.data() as FMIData : null; } catch { return null; }
}
async function saveToFirestore(data: FMIData) { await setDoc(doc(db, FMI_DOC), data); }

// ─── To Do types ─────────────────────────────────────────────────────────────
interface FmiTodo { id: string; text: string; done: boolean; createdAt: number; doneAt?: number; }
const TODOS_DOC = 'clients/fmi_todos';

async function loadTodosFromFirestore(): Promise<FmiTodo[]> {
  try { const s = await getDoc(doc(db, TODOS_DOC)); return s.exists() ? (s.data().todos as FmiTodo[]) || [] : []; }
  catch { return []; }
}
async function saveTodosToFirestore(todos: FmiTodo[]) { await setDoc(doc(db, TODOS_DOC), { todos }); }

// ─── Main ─────────────────────────────────────────────────────────────────────
const ClientDashboard: React.FC = () => {
  const authorized = useClientKey(FMI_CLIENT_KEY);
  const editMode = useEditMode();

  const [data, setData] = useState<FMIData>(staticFmiData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const stats = globalStats(data);

  useEffect(() => {
    loadFromFirestore().then(live => { if (live) setData(live); setLoading(false); });
  }, []);

  const [barWidth, setBarWidth] = useState(0);
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setBarWidth(data.overallReadiness), 400);
    return () => clearTimeout(t);
  }, [loading, data.overallReadiness]);

  const setReadiness = useCallback((pct: number) => {
    setData(p => ({ ...p, overallReadiness: pct })); setBarWidth(pct);
  }, []);

  const updateWorkstream = useCallback((updated: Workstream) => {
    setData(p => ({ ...p, workstreams: p.workstreams.map(ws => ws.id === updated.id ? updated : ws) }));
  }, []);

  const updateAction = useCallback((updated: ActionItem) => {
    setData(p => ({ ...p, actions: p.actions.map(a => a.id === updated.id ? updated : a) }));
  }, []);

  const updateRisk = useCallback((updated: Risk) => {
    setData(p => ({ ...p, risks: p.risks.map(r => r.id === updated.id ? updated : r) }));
  }, []);

  // ── To Do state (edit mode only) ──────────────────────────────────────────
  const [todos, setTodos] = useState<FmiTodo[]>([]);
  const [todoInput, setTodoInput] = useState('');
  const [todoArchiveOpen, setTodoArchiveOpen] = useState(false);

  useEffect(() => {
    if (!editMode) return;
    loadTodosFromFirestore().then(setTodos);
  }, [editMode]);

  const saveTodos = useCallback(async (updated: FmiTodo[]) => {
    setTodos(updated);
    await saveTodosToFirestore(updated);
  }, []);

  const addTodo = useCallback(async () => {
    const text = todoInput.trim(); if (!text) return;
    await saveTodos([{ id: `t${Date.now()}`, text, done: false, createdAt: Date.now() }, ...todos]);
    setTodoInput('');
  }, [todoInput, todos, saveTodos]);

  const toggleTodo = useCallback(async (id: string) => {
    await saveTodos(todos.map(t => t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : undefined } : t));
  }, [todos, saveTodos]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try { await saveToFirestore(data); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    finally { setSaving(false); }
  }, [data]);

  if (!authorized) return <AccessDenied />;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Edit banner ── */}
      {editMode && (
        <div className="bg-blue-600 text-white px-5 py-2.5 flex items-center justify-between gap-4 sticky top-0 z-[60] shadow-lg flex-wrap">
          <p className="text-[11px] font-black uppercase tracking-widest">✏️ Edit Mode — all fields live</p>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold opacity-75 uppercase tracking-widest">Readiness</span>
              <input type="range" min={0} max={100} step={1} value={data.overallReadiness}
                onChange={e => setReadiness(Number(e.target.value))} className="w-24 accent-white" />
              <span className="text-[12px] font-black tabular-nums w-8">{data.overallReadiness}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold opacity-75 uppercase tracking-widest">Updated</span>
              <input type="text" value={data.updatedAt} onChange={e => setData(p => ({ ...p, updatedAt: e.target.value }))}
                className="bg-white/20 text-white text-[11px] font-bold rounded px-2 py-1 w-32 border border-white/30 focus:outline-none" />
            </div>
            <button onClick={handleSave} disabled={saving}
              className="bg-white text-blue-700 px-4 py-1.5 rounded font-black text-[10px] uppercase tracking-widest flex items-center gap-1.5 hover:bg-blue-50 disabled:opacity-60 transition-all">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-slate-900 text-white sticky z-50 border-b border-white/5 shadow-xl" style={{ top: editMode ? 44 : 0 }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-400 mb-0.5">Field Medical · BridgeOps</p>
            <h1 className="text-[18px] sm:text-xl font-black tracking-tight leading-tight">Operational Readiness Dashboard</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">{data.subtitle} · Updated {data.updatedAt}</p>
          </div>
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
          <div className="flex items-center gap-3 mt-3.5">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Overall Readiness</span>
            <div className="flex-1 max-w-xs h-[5px] bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-700 ease-out" style={{ width: `${barWidth}%` }} />
            </div>
            <span className="text-[12px] font-bold text-blue-400 tabular-nums">{data.overallReadiness}%</span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
          <Loader2 size={20} className="animate-spin text-blue-500" />
          <span className="text-sm font-medium">Loading…</span>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-10">

          {/* Workstreams */}
          <section>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 mb-4">Workstream Status</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {data.workstreams.map((ws, i) => (
                <div key={ws.id} className={ws.number === 5 ? 'md:col-span-2' : ''}>
                  <WorkstreamCard ws={ws} defaultOpen={i === 0} editMode={editMode} onChange={updateWorkstream} />
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
                    {data.actions.map((a, i) => (
                      <tr key={a.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i === data.actions.length - 1 ? 'border-0' : ''}`}>
                        <td className="px-4 py-3 max-w-xs">
                          {editMode
                            ? <>
                                <EditText value={a.title} onChange={v => updateAction({ ...a, title: v })} className="text-[13px] font-semibold mb-1" placeholder="Action title" />
                                <EditText value={a.detail} onChange={v => updateAction({ ...a, detail: v })} className="text-[11px]" placeholder="Detail" />
                              </>
                            : <>
                                <p className="text-[13px] font-semibold text-slate-900 leading-snug">{a.title}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">{a.detail}</p>
                              </>
                          }
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {editMode
                            ? <EditSelect value={a.priority} options={['high', 'medium', 'low']} onChange={v => updateAction({ ...a, priority: v as ActionItem['priority'] })} />
                            : <PriorityChip priority={a.priority} />
                          }
                        </td>
                        <td className="px-4 py-3">
                          {editMode
                            ? <EditText value={a.workstream} onChange={v => updateAction({ ...a, workstream: v })} className="text-[11px] w-20" />
                            : <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{a.workstream}</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {editMode
                            ? <EditText value={a.owner} onChange={v => updateAction({ ...a, owner: v })} className="text-[12px] w-24" />
                            : <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-slate-800 text-blue-400 text-[8px] font-black flex items-center justify-center">
                                  {a.owner.slice(0, 2).toUpperCase()}
                                </div>
                                <span className="text-[12px] text-slate-500">{a.owner}</span>
                              </div>
                          }
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {editMode
                            ? <EditText value={a.target} onChange={v => updateAction({ ...a, target: v })} className="text-[11px] w-20" />
                            : <span className="text-[11px] text-slate-400 tabular-nums">{a.target}</span>
                          }
                        </td>
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
              {data.risks.map(r => <RiskCard key={r.id} risk={r} editMode={editMode} onChange={updateRisk} />)}
            </div>
          </section>

          {/* To Do — edit mode only */}
          {editMode && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <ListTodo size={13} className="text-blue-500" />
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">FMI To Do</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                {/* Add */}
                <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex gap-3">
                  <input
                    type="text" value={todoInput}
                    onChange={e => setTodoInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTodo(); }}
                    placeholder="New task…"
                    className="flex-1 border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button onClick={addTodo} disabled={!todoInput.trim()}
                    className="bg-slate-900 text-white px-4 py-2 rounded flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all disabled:opacity-40">
                    <Plus size={13} /> Add
                  </button>
                </div>
                {/* Active */}
                <div className="px-5 py-4 flex flex-col gap-2">
                  {todos.filter(t => !t.done).length === 0 && (
                    <p className="text-[12px] text-slate-400 italic text-center py-3">No open tasks.</p>
                  )}
                  {todos.filter(t => !t.done).map(todo => (
                    <div key={todo.id} className="flex items-start gap-3 py-2 border-b border-slate-50">
                      <button onClick={() => toggleTodo(todo.id)} className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-emerald-500 transition-colors">
                        <Square size={16} />
                      </button>
                      <span className="text-[13px] text-slate-800 flex-1 leading-snug">{todo.text}</span>
                    </div>
                  ))}
                </div>
                {/* Archive */}
                {todos.filter(t => t.done).length > 0 && (
                  <div className="px-5 pb-4">
                    <button onClick={() => setTodoArchiveOpen(o => !o)}
                      className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 mb-3 transition-colors">
                      {todoArchiveOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      Archive ({todos.filter(t => t.done).length})
                    </button>
                    {todoArchiveOpen && (
                      <div className="flex flex-col gap-2">
                        {todos.filter(t => t.done).map(todo => (
                          <div key={todo.id} className="flex items-start gap-3 py-1.5 border-b border-slate-50">
                            <button onClick={() => toggleTodo(todo.id)} className="mt-0.5 flex-shrink-0 text-emerald-500 hover:text-slate-400 transition-colors">
                              <CheckSquare size={16} />
                            </button>
                            <span className="text-[12px] text-slate-400 line-through flex-1">{todo.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

        </div>
      )}

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
