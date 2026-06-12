// ---------------------------------------------------------------------------
// ProcessMapTool — Per-project manufacturing Process Map.
//
// Sits in the ProjectDeepDive utility tab strip between PFMEA and History.
// Mirrors the chrome of MeetingsTool / PFMEATool (slate-900 header, list +
// form view, blue New button).
//
// Purpose: let the user describe a manufacturing process as an ordered list
// of steps and visualise it as an editable flowchart. The step list is the
// source of truth (manufacturing order = array order); the diagram is
// auto-laid-out via dagre and can be nudged by dragging individual nodes.
//
// Step kinds (Visio-style): start (oval/green), action (rect/blue), decision
// (diamond/amber, yes/no targets), end (oval/red). Each carries a short
// description (≤200 char) and a doc reference (≤30 char, e.g. "WI-014 §3.2").
//
// Decision semantics: a decision row defines `yesNext` and `noNext` (step
// ids). Non-decision rows fall through to the next row in the list. Unset
// decision targets fall back to next-in-list too so the diagram never
// dead-ends silently.
//
// Lifecycle: always editable (same posture as Meetings / PFMEA — no
// draft/completed lock). Saves to the `processMaps` Firestore collection,
// scoped by userId + projectId.
//
// Performance: dagre layout is memoised over (steps, edges, direction) so
// dragging a single node never re-runs it; node drags update the
// `manualPositions` map only for the dragged node. Diagram nodes are
// React.memo'd via custom node types. Export builds an inline SVG from the
// dagre output (not the DOM), so PNG/SVG round-trips don't depend on
// React Flow's CSS being applied.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Workflow,
  ChevronUp,
  ChevronDown,
  Copy,
  Image as ImageIcon,
  FileCode2,
  GitBranch,
  Play,
  Square as SquareIcon,
  CircleDot,
  RotateCcw
} from 'lucide-react';
import { db, auth } from './firebase.ts';
import { logActivity } from './activityLogger.ts';
import { PushToOpenItemsInline } from './OpenItemsPanel.tsx';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeChange
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type StepKind = 'start' | 'action' | 'decision' | 'end';

export interface FlowStep {
  id: string;                   // stable local id (uuid-ish)
  kind: StepKind;
  description: string;          // ≤ DESC_MAX (200)
  docRef: string;               // ≤ DOC_REF_MAX (30)
  // Decision branching. Step ids of the next step for the Yes / No outcome.
  // If unset (or pointing at a deleted step) the diagram falls back to the
  // next item in the array — see resolveNextStep.
  yesNext?: string | null;
  noNext?: string | null;
}

export interface ProcessMap {
  id: string;                   // Firestore doc id ('' for unsaved)
  userId: string;
  projectId: string;
  title: string;                // 200 char
  description: string;          // 500 char optional
  steps: FlowStep[];
  manualPositions: Record<string, { x: number; y: number }>;
  layoutDirection: 'TB' | 'LR'; // top-to-bottom or left-to-right
  updatedAtMs: number;          // epoch ms — drives orderBy in list query
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

const TITLE_MAX = 200;
const PROCESS_DESC_MAX = 500;
const DESC_MAX = 200;
const DOC_REF_MAX = 30;
const MAX_STEPS = 200;

// ---------------------------------------------------------------------------
// id + factories
// ---------------------------------------------------------------------------

function newStepId(): string {
  return `s_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function newStep(kind: StepKind): FlowStep {
  return {
    id: newStepId(),
    kind,
    description: '',
    docRef: '',
    yesNext: null,
    noNext: null
  };
}

function newProcessMap(projectId: string, userId: string): ProcessMap {
  const start = newStep('start');
  const action = newStep('action');
  const end = newStep('end');
  start.description = 'Start';
  end.description = 'End';
  return {
    id: '',
    userId,
    projectId,
    title: '',
    description: '',
    steps: [start, action, end],
    manualPositions: {},
    layoutDirection: 'TB',
    updatedAtMs: Date.now()
  };
}

// ---------------------------------------------------------------------------
// Step kind chrome (colors, icons, label, shape used in custom nodes)
// ---------------------------------------------------------------------------

interface KindTheme {
  label: string;
  ring: string;       // tailwind ring color class
  bg: string;
  border: string;
  text: string;
  chip: string;       // for list row chip
  fillHex: string;    // for SVG export
  strokeHex: string;
  textHex: string;
  shape: 'oval' | 'rect' | 'diamond';
}

const KIND_THEME: Record<StepKind, KindTheme> = {
  start: {
    label: 'Start',
    ring: 'ring-emerald-300',
    bg: 'bg-emerald-500',
    border: 'border-emerald-700',
    text: 'text-white',
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    fillHex: '#10b981',
    strokeHex: '#047857',
    textHex: '#ffffff',
    shape: 'oval'
  },
  action: {
    label: 'Action',
    ring: 'ring-blue-300',
    bg: 'bg-blue-500',
    border: 'border-blue-700',
    text: 'text-white',
    chip: 'bg-blue-100 text-blue-800 border-blue-300',
    fillHex: '#3b82f6',
    strokeHex: '#1d4ed8',
    textHex: '#ffffff',
    shape: 'rect'
  },
  decision: {
    label: 'Decision',
    ring: 'ring-amber-300',
    bg: 'bg-amber-500',
    border: 'border-amber-700',
    text: 'text-white',
    chip: 'bg-amber-100 text-amber-800 border-amber-300',
    fillHex: '#f59e0b',
    strokeHex: '#b45309',
    textHex: '#ffffff',
    shape: 'diamond'
  },
  end: {
    label: 'End',
    ring: 'ring-rose-300',
    bg: 'bg-rose-500',
    border: 'border-rose-700',
    text: 'text-white',
    chip: 'bg-rose-100 text-rose-800 border-rose-300',
    fillHex: '#f43f5e',
    strokeHex: '#9f1239',
    textHex: '#ffffff',
    shape: 'oval'
  }
};

function kindIcon(kind: StepKind, size = 12) {
  switch (kind) {
    case 'start': return <Play size={size} />;
    case 'action': return <SquareIcon size={size} />;
    case 'decision': return <GitBranch size={size} />;
    case 'end': return <CircleDot size={size} />;
  }
}

// ---------------------------------------------------------------------------
// Edges + next-step resolution
// ---------------------------------------------------------------------------

interface BuiltEdge {
  id: string;
  source: string;
  target: string;
  label?: string;       // 'Yes' / 'No' for decision branches
}

/**
 * Resolve the "fall-through" next step id for a given index — the next step
 * that exists in the array. Returns undefined if i is the last index.
 */
function fallThroughNext(steps: FlowStep[], i: number): string | undefined {
  return i + 1 < steps.length ? steps[i + 1].id : undefined;
}

/**
 * Build the edges for the diagram from the step list.
 *
 * - end → no outgoing edges (terminal)
 * - decision → up to two labelled edges; unset targets fall back to next-in-list
 * - other → single edge to next-in-list
 */
function buildEdges(steps: FlowStep[]): BuiltEdge[] {
  const validIds = new Set(steps.map((s) => s.id));
  const out: BuiltEdge[] = [];
  steps.forEach((step, i) => {
    if (step.kind === 'end') return;
    if (step.kind === 'decision') {
      const yes = step.yesNext && validIds.has(step.yesNext) ? step.yesNext : fallThroughNext(steps, i);
      const no = step.noNext && validIds.has(step.noNext) ? step.noNext : fallThroughNext(steps, i);
      if (yes) out.push({ id: `${step.id}__yes`, source: step.id, target: yes, label: 'Yes' });
      if (no && no !== yes) out.push({ id: `${step.id}__no`, source: step.id, target: no, label: 'No' });
      return;
    }
    const next = fallThroughNext(steps, i);
    if (next) out.push({ id: `${step.id}__next`, source: step.id, target: next });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Dagre auto-layout
// ---------------------------------------------------------------------------

const NODE_W = 220;
const NODE_H = 78;
const DECISION_W = 220;
const DECISION_H = 110;
const RANK_SEP = 70;
const NODE_SEP = 50;

interface Positioned {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function nodeSizeFor(kind: StepKind): { width: number; height: number } {
  if (kind === 'decision') return { width: DECISION_W, height: DECISION_H };
  return { width: NODE_W, height: NODE_H };
}

/**
 * Run dagre with the supplied direction. Returns a map of stepId → top-left
 * coords (React Flow positions nodes from the top-left, dagre returns
 * centers, so we subtract half-w/h).
 */
function autoLayout(
  steps: FlowStep[],
  edges: BuiltEdge[],
  direction: 'TB' | 'LR'
): Map<string, Positioned> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  steps.forEach((s) => {
    const sz = nodeSizeFor(s.kind);
    g.setNode(s.id, { width: sz.width, height: sz.height });
  });
  edges.forEach((e) => {
    g.setEdge(e.source, e.target);
  });
  dagre.layout(g);
  const out = new Map<string, Positioned>();
  steps.forEach((s) => {
    const n = g.node(s.id);
    const sz = nodeSizeFor(s.kind);
    if (!n) {
      out.set(s.id, { id: s.id, x: 0, y: 0, width: sz.width, height: sz.height });
      return;
    }
    out.set(s.id, {
      id: s.id,
      x: n.x - sz.width / 2,
      y: n.y - sz.height / 2,
      width: sz.width,
      height: sz.height
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Custom React Flow node components — Visio-like shapes via Tailwind/SVG.
// Each is React.memo'd; React Flow calls these for every node on every
// render so the memo is important for diagrams with many steps.
// ---------------------------------------------------------------------------

interface NodeData {
  num: number;
  description: string;
  docRef: string;
  kind: StepKind;
  [key: string]: unknown;
}

const ShapeWrap: React.FC<{ kind: StepKind; children: React.ReactNode }> = ({ kind, children }) => {
  const theme = KIND_THEME[kind];
  const baseCls = `relative ${theme.bg} ${theme.text} border-2 ${theme.border} shadow-md`;
  if (theme.shape === 'oval') {
    return <div className={`${baseCls} rounded-full px-5 py-3 flex items-center justify-center`} style={{ width: NODE_W, height: NODE_H }}>{children}</div>;
  }
  if (theme.shape === 'diamond') {
    // Diamond rendered as a square rotated 45°; inner content kept upright by
    // a counter-rotated wrapper. Sized to DECISION_W/H so connection handles
    // line up with the dagre layout.
    const inner = Math.round(DECISION_W * 0.7071);
    return (
      <div className="relative" style={{ width: DECISION_W, height: DECISION_H }}>
        <div
          className={`absolute left-1/2 top-1/2 ${theme.bg} ${theme.border} border-2 shadow-md`}
          style={{
            width: inner,
            height: inner,
            transform: 'translate(-50%, -50%) rotate(45deg)'
          }}
        />
        <div className={`absolute inset-0 flex items-center justify-center px-6 ${theme.text}`}>
          {children}
        </div>
      </div>
    );
  }
  return <div className={`${baseCls} rounded-md px-4 py-3 flex items-center justify-center`} style={{ width: NODE_W, height: NODE_H }}>{children}</div>;
};

const NodeInner: React.FC<NodeData> = ({ num, description, docRef, kind }) => {
  const isOval = KIND_THEME[kind].shape === 'oval';
  return (
    <div className={`w-full text-center ${isOval ? 'leading-tight' : ''}`}>
      <div className="flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest opacity-90">
        <span className="bg-black/30 rounded-full w-4 h-4 inline-flex items-center justify-center text-[9px]">
          {num}
        </span>
        {kindIcon(kind, 10)}
        <span>{KIND_THEME[kind].label}</span>
      </div>
      <div className="mt-1 text-[11px] font-bold leading-snug line-clamp-2">
        {description || <span className="italic opacity-60">untitled</span>}
      </div>
      {docRef ? (
        <div className="mt-0.5 text-[9px] font-mono opacity-90 truncate">{docRef}</div>
      ) : null}
    </div>
  );
};

const StartNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as NodeData;
  return (
    <>
      <ShapeWrap kind="start"><NodeInner {...d} /></ShapeWrap>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-700 !w-2 !h-2" />
    </>
  );
};

const ActionNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as NodeData;
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-blue-700 !w-2 !h-2" />
      <ShapeWrap kind="action"><NodeInner {...d} /></ShapeWrap>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-700 !w-2 !h-2" />
    </>
  );
};

const DecisionNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as NodeData;
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-amber-700 !w-2 !h-2" />
      <ShapeWrap kind="decision"><NodeInner {...d} /></ShapeWrap>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-700 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-amber-700 !w-2 !h-2" />
    </>
  );
};

const EndNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as NodeData;
  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-rose-700 !w-2 !h-2" />
      <ShapeWrap kind="end"><NodeInner {...d} /></ShapeWrap>
    </>
  );
};

const nodeTypes: NodeTypes = {
  start: React.memo(StartNode),
  action: React.memo(ActionNode),
  decision: React.memo(DecisionNode),
  end: React.memo(EndNode)
};

// ---------------------------------------------------------------------------
// SVG export — render an export-ready SVG directly from dagre output. This
// is independent of React Flow's DOM so the download is deterministic and
// doesn't depend on getting CSS through to a screenshot library.
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) {
      cur = (cur + ' ' + w).trim();
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && text.length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? last.slice(0, -3) + '…' : last;
  }
  return lines;
}

/**
 * Build a self-contained SVG string for the diagram. Uses the positions map
 * (after manualPositions overrides have been applied) so dragged nodes
 * export at their final coords.
 */
function buildSvg(
  steps: FlowStep[],
  positions: Map<string, Positioned>,
  edges: BuiltEdge[],
  title: string
): string {
  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  positions.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.width > maxX) maxX = p.x + p.width;
    if (p.y + p.height > maxY) maxY = p.y + p.height;
  });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 200; }
  const pad = 60;
  const titlePad = title ? 36 : 0;
  const W = maxX - minX + pad * 2;
  const H = maxY - minY + pad * 2 + titlePad;
  const offX = -minX + pad;
  const offY = -minY + pad + titlePad;

  const numByIdMap = new Map<string, number>();
  steps.forEach((s, i) => numByIdMap.set(s.id, i + 1));

  // Edges first (under nodes)
  const edgePaths: string[] = [];
  edges.forEach((e) => {
    const a = positions.get(e.source);
    const b = positions.get(e.target);
    if (!a || !b) return;
    const ax = a.x + a.width / 2 + offX;
    const ay = a.y + a.height + offY;
    const bx = b.x + b.width / 2 + offX;
    const by = b.y + offY;
    const midY = (ay + by) / 2;
    edgePaths.push(`<path d="M ${ax} ${ay} C ${ax} ${midY}, ${bx} ${midY}, ${bx} ${by}" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    if (e.label) {
      const lx = (ax + bx) / 2;
      const ly = midY;
      edgePaths.push(`<rect x="${lx - 14}" y="${ly - 9}" width="28" height="14" fill="white" stroke="#475569" stroke-width="1" rx="2"/>`);
      edgePaths.push(`<text x="${lx}" y="${ly + 1}" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#0f172a">${escapeXml(e.label)}</text>`);
    }
  });

  // Nodes
  const nodeShapes: string[] = [];
  steps.forEach((s) => {
    const p = positions.get(s.id);
    if (!p) return;
    const theme = KIND_THEME[s.kind];
    const num = numByIdMap.get(s.id) ?? 0;
    const cx = p.x + p.width / 2 + offX;
    const cy = p.y + p.height / 2 + offY;
    const tx = p.x + offX;
    const ty = p.y + offY;
    if (theme.shape === 'oval') {
      const rx = p.width / 2;
      const ry = p.height / 2;
      nodeShapes.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${theme.fillHex}" stroke="${theme.strokeHex}" stroke-width="2"/>`);
    } else if (theme.shape === 'diamond') {
      const points = [
        `${cx},${ty}`,
        `${tx + p.width},${cy}`,
        `${cx},${ty + p.height}`,
        `${tx},${cy}`
      ].join(' ');
      nodeShapes.push(`<polygon points="${points}" fill="${theme.fillHex}" stroke="${theme.strokeHex}" stroke-width="2"/>`);
    } else {
      nodeShapes.push(`<rect x="${tx}" y="${ty}" width="${p.width}" height="${p.height}" rx="8" ry="8" fill="${theme.fillHex}" stroke="${theme.strokeHex}" stroke-width="2"/>`);
    }
    // Text content
    const labelLine = `${num} · ${theme.label.toUpperCase()}`;
    nodeShapes.push(`<text x="${cx}" y="${cy - 14}" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="900" letter-spacing="1.5" text-anchor="middle" fill="${theme.textHex}" opacity="0.85">${escapeXml(labelLine)}</text>`);
    const lines = wrapLines(s.description || 'untitled', 24, 2);
    lines.forEach((ln, i) => {
      nodeShapes.push(`<text x="${cx}" y="${cy + i * 12}" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="${theme.textHex}">${escapeXml(ln)}</text>`);
    });
    if (s.docRef) {
      const dy = cy + Math.min(lines.length, 2) * 12 + 8;
      nodeShapes.push(`<text x="${cx}" y="${dy}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" text-anchor="middle" fill="${theme.textHex}" opacity="0.9">${escapeXml(s.docRef)}</text>`);
    }
  });

  const titleSvg = title
    ? `<text x="${pad}" y="${pad - 8}" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="900" letter-spacing="-0.3" fill="#0f172a">${escapeXml(title)}</text>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/>
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${titleSvg}
  ${edgePaths.join('\n  ')}
  ${nodeShapes.join('\n  ')}
</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function svgToPngBlob(svgText: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || 1200;
      const h = img.naturalHeight || 800;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas 2d unavailable')); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => {
        URL.revokeObjectURL(url);
        if (!b) reject(new Error('toBlob failed'));
        else resolve(b);
      }, 'image/png');
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function safeFileStem(s: string): string {
  return (s || 'process-map').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'process-map';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProcessMapToolProps {
  projectId: string;
  readOnly?: boolean;
}

type Mode = { kind: 'list' } | { kind: 'edit'; map: ProcessMap };

const ProcessMapTool: React.FC<ProcessMapToolProps> = ({ projectId, readOnly = false }) => {
  const [maps, setMaps] = useState<ProcessMap[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const uid = auth.currentUser?.uid ?? '';

  const load = useCallback(async () => {
    if (!uid || !projectId) { setMaps([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'processMaps'),
        where('userId', '==', uid),
        where('projectId', '==', projectId),
        orderBy('updatedAtMs', 'desc')
      );
      const snap = await getDocs(q);
      const rows: ProcessMap[] = snap.docs.map((d) => {
        const data = d.data() as Omit<ProcessMap, 'id'>;
        return {
          ...data,
          id: d.id,
          steps: Array.isArray(data.steps) ? data.steps : [],
          manualPositions: (data.manualPositions || {}) as Record<string, { x: number; y: number }>,
          layoutDirection: data.layoutDirection === 'LR' ? 'LR' : 'TB'
        };
      });
      setMaps(rows);
    } catch (e: any) {
      console.error('[ProcessMapTool] load failed', e);
      setError(e?.message || 'Failed to load process maps');
    } finally {
      setLoading(false);
    }
  }, [uid, projectId]);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    if (!uid) return;
    setMode({ kind: 'edit', map: newProcessMap(projectId, uid) });
  };
  const openMap = (m: ProcessMap) => setMode({ kind: 'edit', map: m });
  const cancelEdit = () => setMode({ kind: 'list' });

  const saveMap = async (m: ProcessMap) => {
    if (!uid) throw new Error('Not authenticated');
    const sanitizedSteps: FlowStep[] = (m.steps || []).slice(0, MAX_STEPS).map((s) => ({
      id: s.id || newStepId(),
      kind: (['start', 'action', 'decision', 'end'].includes(s.kind) ? s.kind : 'action') as StepKind,
      description: (s.description || '').slice(0, DESC_MAX),
      docRef: (s.docRef || '').slice(0, DOC_REF_MAX),
      yesNext: s.kind === 'decision' ? (s.yesNext ?? null) : null,
      noNext: s.kind === 'decision' ? (s.noNext ?? null) : null
    }));
    const validIds = new Set(sanitizedSteps.map((s) => s.id));
    const cleanedPositions: Record<string, { x: number; y: number }> = {};
    Object.entries(m.manualPositions || {}).forEach(([k, v]) => {
      if (validIds.has(k) && v && typeof v.x === 'number' && typeof v.y === 'number') {
        cleanedPositions[k] = { x: v.x, y: v.y };
      }
    });
    const nowMs = Date.now();
    const payload = {
      userId: uid,
      projectId,
      title: (m.title || '').slice(0, TITLE_MAX).trim() || 'Untitled process map',
      description: (m.description || '').slice(0, PROCESS_DESC_MAX),
      steps: sanitizedSteps,
      manualPositions: cleanedPositions,
      layoutDirection: m.layoutDirection === 'LR' ? 'LR' : 'TB',
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp()
    };
    if (m.id) {
      await updateDoc(doc(db, 'processMaps', m.id), payload);
    } else {
      await addDoc(collection(db, 'processMaps'), { ...payload, createdAt: serverTimestamp() });
    }
    // Log activity (fire-and-forget)
    const isNew = !m.id;
    const decisionCount = sanitizedSteps.filter((s) => s.kind === 'decision').length;
    logActivity({
      userId: uid,
      projectId,
      eventType: isNew ? 'process_map_created' : 'process_map_updated',
      tool: 'process_map',
      title: isNew ? `Process Map created: ${payload.title}` : `Process Map updated: ${payload.title}`,
      detail: sanitizedSteps.length > 0
        ? `${sanitizedSteps.length} step${sanitizedSteps.length !== 1 ? 's' : ''}${decisionCount > 0 ? ` · ${decisionCount} decision point${decisionCount !== 1 ? 's' : ''}` : ''}`
        : undefined,
      metadata: { stepCount: sanitizedSteps.length, decisionCount },
      timestampMs: Date.now(),
    });

    await load();
    setMode({ kind: 'list' });
  };

  const deleteMap = async (m: ProcessMap) => {
    if (!m.id) return;
    if (!confirm(`Delete "${m.title || 'this process map'}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'processMaps', m.id));
      logActivity({
        userId: uid,
        projectId,
        eventType: 'process_map_deleted',
        tool: 'process_map',
        title: `Process Map deleted: ${m.title || 'Untitled'}`,
        timestampMs: Date.now(),
      });
      await load();
    } catch (e: any) {
      console.error('[ProcessMapTool] delete failed', e);
      alert(e?.message || 'Delete failed');
    }
  };

  const duplicateMap = (m: ProcessMap) => {
    if (!uid) return;
    const idMap = new Map<string, string>();
    m.steps.forEach((s) => idMap.set(s.id, newStepId()));
    const clonedSteps: FlowStep[] = m.steps.map((s) => ({
      ...s,
      id: idMap.get(s.id)!,
      yesNext: s.yesNext ? idMap.get(s.yesNext) ?? null : null,
      noNext: s.noNext ? idMap.get(s.noNext) ?? null : null
    }));
    const clonedPositions: Record<string, { x: number; y: number }> = {};
    Object.entries(m.manualPositions || {}).forEach(([oldId, pos]) => {
      const newId = idMap.get(oldId);
      if (newId) clonedPositions[newId] = pos;
    });
    setMode({
      kind: 'edit',
      map: {
        ...m,
        id: '',
        userId: uid,
        title: `${m.title || 'Untitled'} (copy)`,
        steps: clonedSteps,
        manualPositions: clonedPositions,
        updatedAtMs: Date.now()
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Workflow size={20} className="text-slate-300" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/70 mb-1">Tool · Visio-style</p>
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">Process Map</h3>
          </div>
        </div>
        {mode.kind === 'list' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Reload
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={startNew}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
              >
                <Plus size={12} /> New Map
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {mode.kind === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <ProcessMapList
              maps={maps}
              loading={loading}
              error={error}
              onOpen={openMap}
              onDelete={deleteMap}
              onDuplicate={duplicateMap}
              readOnly={readOnly}
            />
          </motion.div>
        ) : (
          <motion.div
            key="edit"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <ProcessMapForm
              initial={mode.map}
              onCancel={cancelEdit}
              onSave={saveMap}
              readOnly={readOnly}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ProcessMapTool;

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

interface ProcessMapListProps {
  maps: ProcessMap[];
  loading: boolean;
  error: string | null;
  onOpen: (m: ProcessMap) => void;
  onDelete: (m: ProcessMap) => void;
  onDuplicate: (m: ProcessMap) => void;
  readOnly: boolean;
}

const ProcessMapList: React.FC<ProcessMapListProps> = ({ maps, loading, error, onOpen, onDelete, onDuplicate, readOnly }) => {
  if (loading) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading process maps…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 text-center text-sm">
        <div className="inline-flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded">
          <AlertTriangle size={14} /> {error}
        </div>
      </div>
    );
  }
  if (maps.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <Workflow size={28} className="mx-auto text-slate-300 mb-3" />
        <p className="text-sm font-bold text-slate-700 mb-1">No process maps yet</p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Describe your manufacturing process as an ordered list of steps. The diagram is generated automatically and stays editable — drag to nudge, branch with decisions, export as PNG or SVG.
        </p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-200">
      {maps.map((m) => {
        const counts = m.steps.reduce(
          (acc, s) => { acc[s.kind] = (acc[s.kind] || 0) + 1; return acc; },
          {} as Record<StepKind, number>
        );
        return (
          <div key={m.id} className="px-6 py-4 hover:bg-slate-50 group">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => onOpen(m)}
                className="flex-1 text-left flex items-center gap-3 min-w-0"
              >
                <Workflow size={18} className="text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-slate-900 truncate">{m.title || 'Untitled process map'}</span>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">{m.steps.length} steps</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                    {(['start', 'action', 'decision', 'end'] as StepKind[]).map((k) =>
                      counts[k] ? (
                        <span key={k} className={`px-1.5 py-0.5 rounded border ${KIND_THEME[k].chip}`}>
                          {KIND_THEME[k].label} · {counts[k]}
                        </span>
                      ) : null
                    )}
                    {m.description ? (
                      <span className="text-slate-500 font-normal italic ml-1 truncate">{m.description}</span>
                    ) : null}
                  </div>
                </div>
              </button>
              {!readOnly && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => onDuplicate(m)}
                    title="Duplicate"
                    className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(m)}
                    title="Delete"
                    className="p-1.5 text-rose-400 hover:text-rose-700 hover:bg-rose-50 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            {!readOnly && (
              <div className="mt-2 pl-9">
                <PushToOpenItemsInline
                  db={db}
                  userId={m.userId}
                  projectId={m.projectId}
                  sourceTool="process_map"
                  sourceDocId={m.id}
                  initialTitle={m.title || ''}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Form view
// ---------------------------------------------------------------------------

interface ProcessMapFormProps {
  initial: ProcessMap;
  onCancel: () => void;
  onSave: (m: ProcessMap) => Promise<void>;
  readOnly: boolean;
}

const ProcessMapForm: React.FC<ProcessMapFormProps> = ({ initial, onCancel, onSave, readOnly }) => {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [steps, setSteps] = useState<FlowStep[]>(initial.steps);
  const [manualPositions, setManualPositions] = useState<Record<string, { x: number; y: number }>>(initial.manualPositions || {});
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(initial.layoutDirection || 'TB');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const edges = useMemo(() => buildEdges(steps), [steps]);
  const autoPositions = useMemo(() => autoLayout(steps, edges, layoutDirection), [steps, edges, layoutDirection]);

  const effectivePositions = useMemo(() => {
    const out = new Map<string, Positioned>();
    autoPositions.forEach((p, id) => {
      const manual = manualPositions[id];
      if (manual) out.set(id, { ...p, x: manual.x, y: manual.y });
      else out.set(id, p);
    });
    return out;
  }, [autoPositions, manualPositions]);

  // ----- Step list mutators -----

  const updateStep = (idx: number, patch: Partial<FlowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStepAt = (idx: number, kind: StepKind) => {
    setSteps((prev) => {
      const next = [...prev];
      next.splice(idx, 0, newStep(kind));
      return next;
    });
  };

  const deleteStep = (idx: number) => {
    setSteps((prev) => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx).map((s) => ({
        ...s,
        yesNext: s.yesNext === removed?.id ? null : s.yesNext,
        noNext: s.noNext === removed?.id ? null : s.noNext
      }));
      return next;
    });
    setManualPositions((prev) => {
      const { [steps[idx].id]: _omit, ...rest } = prev;
      return rest;
    });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  // ----- Manual position handling (from React Flow drag) -----

  const handleNodePositionChange = (id: string, position: { x: number; y: number }) => {
    setManualPositions((prev) => ({ ...prev, [id]: position }));
  };

  const resetLayout = () => setManualPositions({});

  // ----- Save -----

  const handleSave = async () => {
    if (readOnly) return;
    setSaveError(null);
    setSaving(true);
    try {
      await onSave({
        ...initial,
        title,
        description,
        steps,
        manualPositions,
        layoutDirection
      });
    } catch (e: any) {
      console.error('[ProcessMapTool] save failed', e);
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ----- Export -----

  const exportSvg = () => {
    const svg = buildSvg(steps, effectivePositions, edges, title || 'Process Map');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${safeFileStem(title)}.svg`);
  };

  const exportPng = async () => {
    const svg = buildSvg(steps, effectivePositions, edges, title || 'Process Map');
    try {
      const png = await svgToPngBlob(svg, 2);
      downloadBlob(png, `${safeFileStem(title)}.png`);
    } catch (e: any) {
      alert(`PNG export failed: ${e?.message || e}`);
    }
  };

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 flex items-center gap-1.5"
        >
          <ArrowLeft size={14} /> Back to list
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex border border-slate-300 rounded overflow-hidden text-[10px] font-black uppercase tracking-widest">
            <button
              type="button"
              onClick={() => setLayoutDirection('TB')}
              className={`px-2.5 py-1 ${layoutDirection === 'TB' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >Top-down</button>
            <button
              type="button"
              onClick={() => setLayoutDirection('LR')}
              className={`px-2.5 py-1 ${layoutDirection === 'LR' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >Left-right</button>
          </div>
          {Object.keys(manualPositions).length > 0 && (
            <button
              type="button"
              onClick={resetLayout}
              title="Discard manual node positions"
              className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600 border border-slate-300 hover:bg-slate-50 flex items-center gap-1"
            >
              <RotateCcw size={11} /> Reset layout
            </button>
          )}
          <button
            type="button"
            onClick={exportSvg}
            className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700 border border-slate-300 hover:bg-slate-50 flex items-center gap-1"
          >
            <FileCode2 size={11} /> SVG
          </button>
          <button
            type="button"
            onClick={exportPng}
            className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700 border border-slate-300 hover:bg-slate-50 flex items-center gap-1"
          >
            <ImageIcon size={11} /> PNG
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {initial.id ? 'Save changes' : 'Create map'}
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="inline-flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded text-xs">
          <AlertTriangle size={14} /> {saveError}
        </div>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4">
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Title</label>
          <input
            type="text"
            value={title}
            disabled={readOnly}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            placeholder="e.g. PCBA assembly — main line"
            className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 rounded-sm"
          />
          <div className="text-[10px] text-slate-400 text-right mt-0.5">{title.length}/{TITLE_MAX}</div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Description (optional)</label>
          <input
            type="text"
            value={description}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value.slice(0, PROCESS_DESC_MAX))}
            placeholder="One-line summary of what this process covers"
            className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 rounded-sm"
          />
          <div className="text-[10px] text-slate-400 text-right mt-0.5">{description.length}/{PROCESS_DESC_MAX}</div>
        </div>
      </div>

      {/* Steps */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-600">Steps · {steps.length}</h4>
          {!readOnly && (
            <div className="flex items-center gap-1">
              {(['start', 'action', 'decision', 'end'] as StepKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => addStepAt(steps.length, k)}
                  className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border ${KIND_THEME[k].chip} hover:opacity-80 flex items-center gap-1`}
                >
                  <Plus size={10} /> {KIND_THEME[k].label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {steps.map((s, idx) => (
            <StepRow
              key={s.id}
              step={s}
              index={idx}
              total={steps.length}
              steps={steps}
              readOnly={readOnly}
              onChange={(patch) => updateStep(idx, patch)}
              onMoveUp={() => moveStep(idx, -1)}
              onMoveDown={() => moveStep(idx, 1)}
              onDelete={() => deleteStep(idx)}
            />
          ))}
          {steps.length === 0 && (
            <div className="text-center text-xs text-slate-500 py-6 border border-dashed border-slate-300 rounded">
              No steps. Add a Start step to begin.
            </div>
          )}
        </div>
      </div>

      {/* Diagram */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-600">Diagram</h4>
          <p className="text-[10px] text-slate-400">
            Drag any node to nudge · {Object.keys(manualPositions).length > 0 ? `${Object.keys(manualPositions).length} manual position${Object.keys(manualPositions).length === 1 ? '' : 's'}` : 'auto-layout'}
          </p>
        </div>
        <div className="border border-slate-200 rounded-sm bg-slate-50" style={{ height: 520 }}>
          <ReactFlowProvider>
            <DiagramCanvas
              steps={steps}
              edges={edges}
              positions={effectivePositions}
              readOnly={readOnly}
              onNodePositionChange={handleNodePositionChange}
            />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Step row
// ---------------------------------------------------------------------------

interface StepRowProps {
  step: FlowStep;
  index: number;
  total: number;
  steps: FlowStep[];
  readOnly: boolean;
  onChange: (patch: Partial<FlowStep>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

const StepRow: React.FC<StepRowProps> = ({ step, index, total, steps, readOnly, onChange, onMoveUp, onMoveDown, onDelete }) => {
  const theme = KIND_THEME[step.kind];
  const targetOptions = steps
    .map((s, i) => ({ id: s.id, num: i + 1, label: s.description || `Step ${i + 1}` }))
    .filter((opt) => opt.id !== step.id);

  return (
    <div className={`border ${theme.border} bg-white rounded-sm shadow-sm`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${theme.border} ${theme.bg} ${theme.text}`}>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-90 flex items-center gap-1.5">
          <span className="bg-black/30 rounded-full w-5 h-5 inline-flex items-center justify-center text-[10px]">{index + 1}</span>
          {kindIcon(step.kind, 11)} {theme.label}
        </span>
        <select
          value={step.kind}
          disabled={readOnly}
          onChange={(e) => onChange({ kind: e.target.value as StepKind })}
          className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded px-1.5 py-0.5 focus:outline-none"
        >
          <option className="text-slate-900" value="start">Start</option>
          <option className="text-slate-900" value="action">Action</option>
          <option className="text-slate-900" value="decision">Decision</option>
          <option className="text-slate-900" value="end">End</option>
        </select>
        <div className="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={readOnly || index === 0}
            title="Move up"
            className="p-1 text-white/80 hover:text-white disabled:opacity-30"
          ><ChevronUp size={12} /></button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={readOnly || index === total - 1}
            title="Move down"
            className="p-1 text-white/80 hover:text-white disabled:opacity-30"
          ><ChevronDown size={12} /></button>
          <button
            type="button"
            onClick={onDelete}
            disabled={readOnly}
            title="Delete step"
            className="p-1 text-white/80 hover:text-white disabled:opacity-30"
          ><Trash2 size={12} /></button>
        </div>
      </div>
      <div className="p-3 grid grid-cols-1 md:grid-cols-[3fr_1fr] gap-3">
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Description</label>
          <textarea
            value={step.description}
            disabled={readOnly}
            onChange={(e) => onChange({ description: e.target.value.slice(0, DESC_MAX) })}
            placeholder="What happens in this step"
            rows={2}
            className="w-full border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 rounded-sm resize-none"
          />
          <div className="text-[10px] text-slate-400 text-right">{step.description.length}/{DESC_MAX}</div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Doc ref</label>
          <input
            type="text"
            value={step.docRef}
            disabled={readOnly}
            onChange={(e) => onChange({ docRef: e.target.value.slice(0, DOC_REF_MAX) })}
            placeholder="WI-014 §3.2"
            className="w-full border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 rounded-sm"
          />
          <div className="text-[10px] text-slate-400 text-right">{step.docRef.length}/{DOC_REF_MAX}</div>
        </div>
        {step.kind === 'decision' && (
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 mt-1 pt-3 border-t border-slate-200">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-emerald-700 block mb-1">Yes → go to</label>
              <select
                value={step.yesNext ?? ''}
                disabled={readOnly}
                onChange={(e) => onChange({ yesNext: e.target.value || null })}
                className="w-full border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 rounded-sm"
              >
                <option value="">(next step in list)</option>
                {targetOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>#{opt.num} · {opt.label.slice(0, 40)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-rose-700 block mb-1">No → go to</label>
              <select
                value={step.noNext ?? ''}
                disabled={readOnly}
                onChange={(e) => onChange({ noNext: e.target.value || null })}
                className="w-full border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 rounded-sm"
              >
                <option value="">(next step in list)</option>
                {targetOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>#{opt.num} · {opt.label.slice(0, 40)}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// React Flow canvas
// ---------------------------------------------------------------------------

interface DiagramCanvasProps {
  steps: FlowStep[];
  edges: BuiltEdge[];
  positions: Map<string, Positioned>;
  readOnly: boolean;
  onNodePositionChange: (id: string, position: { x: number; y: number }) => void;
}

const DiagramCanvas: React.FC<DiagramCanvasProps> = ({ steps, edges, positions, readOnly, onNodePositionChange }) => {
  // Build React Flow nodes from steps + positions. Memoise so unrelated state
  // changes don't churn the array identity.
  const rfNodes: Node<NodeData>[] = useMemo(() => {
    return steps.map((s, i) => {
      const p = positions.get(s.id);
      const pos = p ? { x: p.x, y: p.y } : { x: 0, y: i * 110 };
      return {
        id: s.id,
        type: s.kind,
        position: pos,
        data: {
          num: i + 1,
          description: s.description,
          docRef: s.docRef,
          kind: s.kind
        },
        draggable: !readOnly,
        selectable: true
      };
    });
  }, [steps, positions, readOnly]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      labelStyle: { fontSize: 10, fontWeight: 700, fill: '#0f172a' },
      labelBgStyle: { fill: '#ffffff' },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 2,
      type: 'smoothstep',
      style: { stroke: '#475569', strokeWidth: 1.5 },
      markerEnd: { type: 'arrowclosed' as const, color: '#475569', width: 16, height: 16 }
    }));
  }, [edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(rfNodes);
  const [, setEdges] = useEdgesState<Edge>(rfEdges);

  // Sync incoming props → flow state when steps / positions / readOnly shift.
  // Identity dep on the memoised arrays so this only fires on real changes.
  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  // Push position changes back up only when a drag ends (avoids flooding
  // parent state on every pixel of a drag). xyflow types NodeChange generic
  // over the node type, so we have to match the same generic as useNodesState.
  const handleNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    onNodesChange(changes);
    changes.forEach((c) => {
      if (c.type === 'position' && c.dragging === false && c.position) {
        onNodePositionChange(c.id, c.position);
      }
    });
  }, [onNodesChange, onNodePositionChange]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      nodesDraggable={!readOnly}
      nodesConnectable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.8}
    >
      <Background gap={20} color="#e2e8f0" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={(n) => KIND_THEME[(n.data as NodeData)?.kind ?? 'action'].fillHex} />
    </ReactFlow>
  );
};
