// ---------------------------------------------------------------------------
// ScoreHistoryPanel — History tab body in ProjectDeepDive.
//
// Plots the time-series of `scoreHistory` that is appended to each project
// on Save. Shows:
//   * Overall readiness (thick line)
//   * Per-group readiness (4 thin colored lines)
//   * Optional gate target markers (vertical dashed lines) when a gate has a
//     date that falls inside the chart's x-range
//
// The chart is a hand-rolled SVG so we don't pull in recharts. Responsive to
// container width via a ResizeObserver.
// ---------------------------------------------------------------------------

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { LineChart as LineChartIcon, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { ScoreSnapshot, ProductGate } from './ProjectDeepDive';
import { RAMP_GROUPS, accentTokens, scoreBand } from './rampGroups';

interface ScoreHistoryPanelProps {
  history: ScoreSnapshot[];
  gateTargets?: Partial<Record<ProductGate, string>>;
  currentGate?: ProductGate | '';
}

const OVERALL_STROKE = '#0f172a'; // slate-900

// Convert a gate ISO date to a JS timestamp (local-midnight). Returns null on bad input.
function parseGateDate(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatFullDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ScoreHistoryPanel: React.FC<ScoreHistoryPanelProps> = ({
  history,
  gateTargets,
  currentGate
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(Math.max(320, Math.floor(w)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sorted = useMemo(
    () => [...history].sort((a, b) => a.ts - b.ts),
    [history]
  );

  // --- Empty state -------------------------------------------------------
  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-sm shadow border border-slate-200 p-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-100 text-slate-500 mb-4">
          <LineChartIcon size={24} />
        </div>
        <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-2">
          No History Yet
        </h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          Your readiness trend will appear here after the first Save. Each save records
          a snapshot when any score changes, so you can track progress across weeks and
          stage gates.
        </p>
      </div>
    );
  }

  // --- Latest snapshot summary -------------------------------------------
  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const delta = latest.overall - first.overall;
  const deltaIcon = delta > 0 ? <TrendingUp size={14} /> : delta < 0 ? <TrendingDown size={14} /> : <Minus size={14} />;
  const deltaColor =
    delta > 0 ? 'text-emerald-600 bg-emerald-50' :
    delta < 0 ? 'text-red-600 bg-red-50' :
    'text-slate-600 bg-slate-100';
  const latestBand = scoreBand(latest.overall);

  // --- Chart geometry ----------------------------------------------------
  const height = 340;
  const pad = { top: 20, right: 20, bottom: 36, left: 36 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;

  // Domain: if only one point, expand x to ±1 day so the dot sits in the middle.
  const xMin = sorted[0].ts;
  const xMaxRaw = sorted[sorted.length - 1].ts;
  const xSpanOrig = xMaxRaw - xMin;
  const xSpan = xSpanOrig <= 0 ? 86400000 * 2 : xSpanOrig; // 2-day minimum
  const xDomainMin = xSpanOrig <= 0 ? xMin - 86400000 : xMin;
  const xDomainMax = xSpanOrig <= 0 ? xMin + 86400000 : xMaxRaw;

  const xOf = (t: number) => pad.left + ((t - xDomainMin) / xSpan) * innerW;
  const yOf = (v: number) => pad.top + (1 - v / 100) * innerH; // score is 0..100

  // Build polyline points for overall + each group.
  const overallPoints = sorted.map((s) => `${xOf(s.ts)},${yOf(s.overall)}`).join(' ');
  const groupPolylines = RAMP_GROUPS.map((g) => {
    const pts = sorted
      .map((s) => `${xOf(s.ts)},${yOf(s.groups[g.id] ?? 0)}`)
      .join(' ');
    return { id: g.id, title: g.title, points: pts, color: accentTokens[g.accent].stroke };
  });

  // Gate markers — only plot ones whose date falls inside the x-domain.
  const markers: Array<{ gate: ProductGate; x: number; date: string; isCurrent: boolean }> = [];
  if (gateTargets) {
    (Object.keys(gateTargets) as ProductGate[]).forEach((g) => {
      const ts = parseGateDate(gateTargets[g]);
      if (ts == null) return;
      if (ts < xDomainMin || ts > xDomainMax) return;
      markers.push({
        gate: g,
        x: xOf(ts),
        date: gateTargets[g] as string,
        isCurrent: g === currentGate
      });
    });
  }

  // Y-axis gridlines at 0/25/50/75/100.
  const gridLines = [0, 25, 50, 75, 100];

  // X-axis tick count — 4 evenly spaced
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const t = xDomainMin + (xSpan * i) / tickCount;
    return { x: xOf(t), ts: t };
  });

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="bg-white rounded-sm shadow border border-slate-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-1">
              Readiness Trend
            </p>
            <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
              {sorted.length} snapshot{sorted.length === 1 ? '' : 's'} recorded
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Latest
              </p>
              <p className={`text-2xl font-black tracking-tighter ${latestBand.text}`}>
                {latest.overall}%
              </p>
            </div>
            <div className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${deltaColor}`}>
              {deltaIcon}
              {delta > 0 ? '+' : ''}{delta} pts since {formatShortDate(first.ts)}
            </div>
          </div>
        </div>
      </div>

      {/* Chart + legend */}
      <div ref={wrapRef} className="bg-white rounded-sm shadow border border-slate-200 p-6">
        <div className="flex flex-wrap items-center gap-4 mb-4 text-[11px] font-bold text-slate-700">
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-0.5 bg-slate-900" />
            Overall
          </span>
          {RAMP_GROUPS.map((g) => (
            <span key={g.id} className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-0.5"
                style={{ backgroundColor: accentTokens[g.accent].stroke }}
              />
              {g.title.replace(/ Readiness$/, '').replace(/ & /g, ' / ')}
            </span>
          ))}
          {markers.length > 0 && (
            <span className="flex items-center gap-2">
              <span className="inline-block w-4 h-px border-t border-dashed border-slate-400" />
              Gate target
            </span>
          )}
        </div>

        <svg width={width} height={height} className="block">
          {/* Y gridlines + labels */}
          {gridLines.map((v) => (
            <g key={`grid-${v}`}>
              <line
                x1={pad.left}
                x2={pad.left + innerW}
                y1={yOf(v)}
                y2={yOf(v)}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={yOf(v) + 4}
                textAnchor="end"
                fontSize={10}
                fill="#64748b"
                fontWeight={700}
              >
                {v}
              </text>
            </g>
          ))}

          {/* X axis ticks */}
          {ticks.map((tk, i) => (
            <g key={`tick-${i}`}>
              <line
                x1={tk.x}
                x2={tk.x}
                y1={pad.top + innerH}
                y2={pad.top + innerH + 4}
                stroke="#94a3b8"
              />
              <text
                x={tk.x}
                y={pad.top + innerH + 18}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
                fontWeight={700}
              >
                {formatShortDate(tk.ts)}
              </text>
            </g>
          ))}

          {/* Axis lines */}
          <line
            x1={pad.left}
            x2={pad.left + innerW}
            y1={pad.top + innerH}
            y2={pad.top + innerH}
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <line
            x1={pad.left}
            x2={pad.left}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="#94a3b8"
            strokeWidth={1}
          />

          {/* Gate markers (behind lines so lines remain prominent) */}
          {markers.map((m) => (
            <g key={`marker-${m.gate}`}>
              <line
                x1={m.x}
                x2={m.x}
                y1={pad.top}
                y2={pad.top + innerH}
                stroke={m.isCurrent ? '#2563eb' : '#94a3b8'}
                strokeWidth={m.isCurrent ? 2 : 1}
                strokeDasharray="4 4"
              />
              <rect
                x={m.x - 22}
                y={pad.top - 16}
                width={44}
                height={14}
                fill={m.isCurrent ? '#2563eb' : '#334155'}
              />
              <text
                x={m.x}
                y={pad.top - 6}
                textAnchor="middle"
                fontSize={9}
                fill="#fff"
                fontWeight={800}
                letterSpacing={0.5}
              >
                {m.gate}
              </text>
            </g>
          ))}

          {/* Per-group lines */}
          {groupPolylines.map((g) => (
            <polyline
              key={g.id}
              points={g.points}
              fill="none"
              stroke={g.color}
              strokeWidth={1.5}
              strokeOpacity={0.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Overall line (drawn last / on top) */}
          <polyline
            points={overallPoints}
            fill="none"
            stroke={OVERALL_STROKE}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Overall points */}
          {sorted.map((s, i) => (
            <circle
              key={`pt-${i}`}
              cx={xOf(s.ts)}
              cy={yOf(s.overall)}
              r={3.5}
              fill={OVERALL_STROKE}
            />
          ))}
        </svg>
      </div>

      {/* Recent snapshots table */}
      <div className="bg-white rounded-sm shadow border border-slate-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
          <Clock size={14} className="text-slate-500" />
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-600">
            Recent Snapshots
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th className="text-left px-6 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Date</th>
                <th className="text-right px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Overall</th>
                {RAMP_GROUPS.map((g) => (
                  <th
                    key={g.id}
                    className="text-right px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap"
                  >
                    {g.title.split(' ')[0]}
                  </th>
                ))}
                <th className="text-right px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Gate</th>
              </tr>
            </thead>
            <tbody>
              {sorted
                .slice(-10)
                .reverse()
                .map((s) => {
                  const band = scoreBand(s.overall);
                  return (
                    <tr key={s.ts} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-6 py-2 text-slate-700 whitespace-nowrap">
                        {formatFullDate(s.ts)}
                      </td>
                      <td className={`px-4 py-2 text-right font-black tabular-nums ${band.text}`}>
                        {s.overall}%
                      </td>
                      {RAMP_GROUPS.map((g) => (
                        <td
                          key={g.id}
                          className="px-3 py-2 text-right tabular-nums text-slate-600"
                        >
                          {s.groups[g.id] ?? '—'}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right text-slate-500 text-xs">
                        {s.currentGate || '—'}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {sorted.length > 10 && (
          <div className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50 border-t border-slate-200">
            Showing last 10 of {sorted.length} snapshots
          </div>
        )}
      </div>
    </div>
  );
};

export default ScoreHistoryPanel;
