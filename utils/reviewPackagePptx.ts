// ---------------------------------------------------------------------------
// utils/reviewPackagePptx.ts — Gate / Design Review Package PPTX generator.
//
// Fetches live data from all project tool collections and compiles a 9-slide
// review-ready deck. Called from ReviewStudioTool's "Generate Package" tab.
//
// Slides:
//   1. Cover              — Project name, gate, date, overall RAMP score
//   2. Program Status     — RAMP group scores by domain + AI status snapshot
//   3. Top Risks          — PFMEA top risks by RPN with tier and action
//   4. Key Decisions      — Active decisions + reversed (instability signals)
//   5. BOM / ECO Status   — Latest revision, supplier swaps, reason for change
//   6. Manufacturing      — Takt verdict, capacity %, bottleneck step
//   7. Budget Overview    — Planned vs actual, variance %, by category
//   8. Open Actions       — MUST actions from Design Reviews, Meetings & Lessons
//   9. Next Steps         — AI top actions from last Analysis run
// ---------------------------------------------------------------------------

import PptxGenJS from 'pptxgenjs';
import {
  collection, doc, getDocs, getDoc,
  query, where, orderBy, limit
} from 'firebase/firestore';
import type { ProductGate } from '../ProjectDeepDive.tsx';

// ---------------------------------------------------------------------------
// Brand palette — same as pptxGenerator.ts
// ---------------------------------------------------------------------------
const COLORS = {
  slate900: '0F172A',
  slate700: '334155',
  slate500: '64748B',
  slate300: 'CBD5E1',
  slate100: 'F1F5F9',
  blue600:  '2563EB',
  blue400:  '60A5FA',
  emerald:  '10B981',
  amber:    'F59E0B',
  red:      'DC2626',
  white:    'FFFFFF',
  sky:      '0EA5E9',
};

const RAMP_GROUP_META = [
  { id: 'product_design',      shortLabel: 'Product & Design',    barColor: '2563EB' },
  { id: 'manufacturing',       shortLabel: 'Manufacturing',        barColor: '10B981' },
  { id: 'supply_chain',        shortLabel: 'Supply Chain',         barColor: 'F59E0B' },
  { id: 'quality_reliability', shortLabel: 'Quality & Reliability', barColor: '8B5CF6' },
];

function clamp(s: string, max: number): string {
  if (!s) return '—';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function fmtMs(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

// ---------------------------------------------------------------------------
// Shared layout helpers (same approach as pptxGenerator.ts)
// ---------------------------------------------------------------------------
function addHeaderBar(slide: any, pptx: any, title: string, subtitle: string) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 0.9,
    fill: { color: COLORS.slate900 },
    line: { color: COLORS.slate900 }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0.9, w: '100%', h: 0.05,
    fill: { color: COLORS.sky },
    line: { color: COLORS.sky }
  });
  slide.addText(title, {
    x: 0.4, y: 0.12, w: 9.2, h: 0.4,
    fontFace: 'Arial', fontSize: 22, bold: true, color: COLORS.white
  });
  slide.addText(subtitle, {
    x: 0.4, y: 0.52, w: 9.2, h: 0.3,
    fontFace: 'Arial', fontSize: 10,
    color: COLORS.blue400, charSpacing: 4
  });
}

function addFooter(slide: any, projectName: string, pageLabel: string) {
  slide.addText(
    `BridgeOps Engineering  |  ${projectName}  |  ${pageLabel}`,
    {
      x: 0.4, y: 7.15, w: 9.2, h: 0.25,
      fontFace: 'Arial', fontSize: 8,
      color: COLORS.slate500, charSpacing: 2
    }
  );
}

function scoreColor(pct: number): string {
  if (pct >= 70) return COLORS.emerald;
  if (pct >= 40) return COLORS.amber;
  return COLORS.red;
}

function rpnTierColor(rpn: number): string {
  if (rpn > 100) return COLORS.red;
  if (rpn >= 40) return COLORS.amber;
  return COLORS.emerald;
}

// ---------------------------------------------------------------------------
// Slide 1 — Cover
// ---------------------------------------------------------------------------
function buildCoverSlide(
  pptx: any,
  projectName: string,
  currentGate: string | undefined,
  overall: number,
  today: string
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.slate900 };

  // Sky accent top band
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 0.08,
    fill: { color: COLORS.sky }, line: { color: COLORS.sky }
  });

  // Project name
  slide.addText(clamp(projectName, 55), {
    x: 0.6, y: 1.5, w: 8.8, h: 0.9,
    fontFace: 'Arial', fontSize: 36, bold: true, color: COLORS.white
  });

  // "REVIEW PACKAGE"
  slide.addText('REVIEW PACKAGE', {
    x: 0.6, y: 2.4, w: 8.8, h: 0.4,
    fontFace: 'Arial', fontSize: 11, color: COLORS.sky, charSpacing: 6
  });

  // RAMP score badge
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.6, y: 3.3, w: 2.2, h: 1.4,
    fill: { color: COLORS.slate700 }, line: { color: COLORS.slate700 },
    rounding: true
  });
  slide.addText(String(overall) + '%', {
    x: 0.6, y: 3.45, w: 2.2, h: 0.7,
    fontFace: 'Arial', fontSize: 42, bold: true,
    color: scoreColor(overall), align: 'center'
  });
  slide.addText('RAMP READINESS', {
    x: 0.6, y: 4.1, w: 2.2, h: 0.3,
    fontFace: 'Arial', fontSize: 8, color: COLORS.slate300,
    align: 'center', charSpacing: 2
  });

  // Gate + date
  if (currentGate) {
    slide.addText('CURRENT GATE', {
      x: 3.2, y: 3.4, w: 2.5, h: 0.25,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, charSpacing: 2
    });
    slide.addText(currentGate, {
      x: 3.2, y: 3.65, w: 2.5, h: 0.5,
      fontFace: 'Arial', fontSize: 28, bold: true, color: COLORS.sky
    });
  }

  slide.addText('DATE', {
    x: 3.2, y: 4.3, w: 2.5, h: 0.25,
    fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, charSpacing: 2
  });
  slide.addText(today, {
    x: 3.2, y: 4.55, w: 4, h: 0.3,
    fontFace: 'Arial', fontSize: 14, color: COLORS.white
  });

  // Footer line
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 7.3, w: '100%', h: 0.08,
    fill: { color: COLORS.sky }, line: { color: COLORS.sky }
  });
  slide.addText('BridgeOps Engineering · Confidential', {
    x: 0.4, y: 7.1, w: 9.2, h: 0.2,
    fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, align: 'right'
  });
}

// ---------------------------------------------------------------------------
// Slide 2 — Program Status (RAMP group scores)
// ---------------------------------------------------------------------------
function buildProgramStatusSlide(
  pptx: any,
  projectName: string,
  groupScores: Record<string, number>,
  overall: number,
  aiSnapshot?: string
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Program Status', 'RAMP READINESS BY DOMAIN');

  // Overall score
  slide.addText(String(overall) + '%', {
    x: 7.5, y: 1.1, w: 2.1, h: 0.65,
    fontFace: 'Arial', fontSize: 36, bold: true,
    color: scoreColor(overall), align: 'right'
  });
  slide.addText('OVERALL', {
    x: 7.5, y: 1.75, w: 2.1, h: 0.2,
    fontFace: 'Arial', fontSize: 8, color: COLORS.slate500,
    align: 'right', charSpacing: 2
  });

  // 4 group bars
  const startY = 1.2;
  const rowH = 1.0;
  RAMP_GROUP_META.forEach((g, i) => {
    const pct = groupScores[g.id] ?? 0;
    const y = startY + i * rowH;
    const barW = (pct / 100) * 6.5;

    slide.addText(g.shortLabel, {
      x: 0.4, y, w: 3, h: 0.3,
      fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.slate700
    });
    // Bar background
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: y + 0.3, w: 6.5, h: 0.22,
      fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
    });
    // Bar fill
    if (barW > 0) {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: y + 0.3, w: barW, h: 0.22,
        fill: { color: g.barColor }, line: { color: g.barColor }
      });
    }
    // Percentage
    slide.addText(String(pct) + '%', {
      x: 7.1, y: y + 0.28, w: 0.9, h: 0.26,
      fontFace: 'Arial', fontSize: 11, bold: true,
      color: scoreColor(pct), align: 'right'
    });
  });

  // AI snapshot
  if (aiSnapshot) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 5.5, w: 9.2, h: 1.0,
      fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
    });
    slide.addText('AI STATUS SNAPSHOT', {
      x: 0.6, y: 5.6, w: 8.8, h: 0.2,
      fontFace: 'Arial', fontSize: 8, color: COLORS.sky, charSpacing: 3
    });
    slide.addText(clamp(aiSnapshot, 220), {
      x: 0.6, y: 5.82, w: 8.8, h: 0.55,
      fontFace: 'Arial', fontSize: 10, color: COLORS.slate700
    });
  }

  addFooter(slide, projectName, 'Program Status · Slide 2');
}

// ---------------------------------------------------------------------------
// Slide 3 — Top Risks (PFMEA)
// ---------------------------------------------------------------------------
function buildRisksSlide(pptx: any, projectName: string, pfmeas: any[]) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Top Risks', 'PFMEA — BY RPN');

  if (!pfmeas.length) {
    slide.addText('No PFMEA data available.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'Top Risks · Slide 3');
    return;
  }

  // Collect all risks from all PFMEAs, sort by RPN desc, top 7
  const allRisks: Array<{ processStep: string; failureMode: string; rpn: number; recommendedAction: string }> = [];
  for (const p of pfmeas) {
    if (Array.isArray(p.risks)) {
      for (const r of p.risks) {
        const s = Number(r.severity ?? 1);
        const o = Number(r.occurrence ?? 1);
        const d = Number(r.detection ?? 1);
        allRisks.push({
          processStep: r.processStep ?? '—',
          failureMode: r.failureMode ?? '—',
          rpn: s * o * d,
          recommendedAction: r.recommendedAction ?? '',
        });
      }
    }
  }
  allRisks.sort((a, b) => b.rpn - a.rpn);
  const top = allRisks.slice(0, 7);

  const colX  = [0.4, 2.4, 4.4, 6.0, 8.2];
  const headers = ['Process Step', 'Failure Mode', 'RPN', 'Tier', 'Recommended Action'];
  const colW  = [2.0, 2.0, 1.5, 2.2, 1.9];
  const rowH  = 0.65;
  const startY = 1.1;

  // Header row
  headers.forEach((h, i) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: colX[i], y: startY, w: colW[i], h: 0.3,
      fill: { color: COLORS.slate900 }, line: { color: COLORS.slate900 }
    });
    slide.addText(h, {
      x: colX[i] + 0.05, y: startY, w: colW[i], h: 0.3,
      fontFace: 'Arial', fontSize: 8, bold: true, color: COLORS.white
    });
  });

  top.forEach((r, i) => {
    const y = startY + 0.3 + i * rowH;
    const bg = i % 2 === 0 ? COLORS.white : COLORS.slate100;
    const tier = r.rpn > 100 ? 'HIGH' : r.rpn >= 40 ? 'MEDIUM' : 'LOW';

    // Row background
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y, w: 9.2, h: rowH - 0.05,
      fill: { color: r.rpn > 100 ? 'FFF1F2' : bg },
      line: { color: COLORS.slate300 }
    });

    slide.addText(clamp(r.processStep, 28), {
      x: colX[0] + 0.05, y: y + 0.1, w: colW[0] - 0.1, h: rowH - 0.2,
      fontFace: 'Arial', fontSize: 9, color: COLORS.slate700
    });
    slide.addText(clamp(r.failureMode, 28), {
      x: colX[1] + 0.05, y: y + 0.1, w: colW[1] - 0.1, h: rowH - 0.2,
      fontFace: 'Arial', fontSize: 9, color: COLORS.slate700
    });
    slide.addText(String(r.rpn), {
      x: colX[2] + 0.05, y: y + 0.1, w: colW[2] - 0.1, h: rowH - 0.2,
      fontFace: 'Arial', fontSize: 11, bold: true, color: rpnTierColor(r.rpn)
    });
    slide.addText(tier, {
      x: colX[3] + 0.05, y: y + 0.1, w: colW[3] - 0.1, h: rowH - 0.2,
      fontFace: 'Arial', fontSize: 8, bold: true, color: rpnTierColor(r.rpn)
    });
    slide.addText(clamp(r.recommendedAction, 30), {
      x: colX[4] + 0.05, y: y + 0.1, w: colW[4] - 0.1, h: rowH - 0.2,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500
    });
  });

  addFooter(slide, projectName, 'Top Risks · Slide 3');
}

// ---------------------------------------------------------------------------
// Slide 4 — Key Decisions
// ---------------------------------------------------------------------------
function buildDecisionsSlide(pptx: any, projectName: string, decisions: any[]) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Key Decisions', 'DECISION LEDGER — ACTIVE & REVERSED');

  const active  = decisions.filter(d => d.status === 'active').slice(0, 5);
  const reversed = decisions.filter(d => d.status === 'reversed').slice(0, 2);

  if (!active.length && !reversed.length) {
    slide.addText('No decisions logged yet.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'Key Decisions · Slide 4');
    return;
  }

  let curY = 1.1;

  if (active.length) {
    slide.addText('ACTIVE DECISIONS', {
      x: 0.4, y: curY, w: 9.2, h: 0.25,
      fontFace: 'Arial', fontSize: 8, color: COLORS.sky, charSpacing: 3
    });
    curY += 0.3;

    active.forEach(d => {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: curY, w: 9.2, h: 0.65,
        fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
      });
      slide.addText(clamp(d.title, 70), {
        x: 0.6, y: curY + 0.05, w: 7, h: 0.28,
        fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.slate900
      });
      slide.addText(fmtMs(d.dateMs) + (d.gate ? '  ·  ' + d.gate : ''), {
        x: 0.6, y: curY + 0.33, w: 7, h: 0.22,
        fontFace: 'Arial', fontSize: 8, color: COLORS.slate500
      });
      curY += 0.72;
    });
  }

  if (reversed.length) {
    curY += 0.1;
    slide.addText('⚠  REVERSED DECISIONS (INSTABILITY SIGNAL)', {
      x: 0.4, y: curY, w: 9.2, h: 0.25,
      fontFace: 'Arial', fontSize: 8, color: COLORS.red, charSpacing: 2
    });
    curY += 0.3;

    reversed.forEach(d => {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: curY, w: 9.2, h: 0.55,
        fill: { color: 'FFF1F2' }, line: { color: 'FECDD3' }
      });
      slide.addText(clamp(d.title, 70), {
        x: 0.6, y: curY + 0.08, w: 7, h: 0.28,
        fontFace: 'Arial', fontSize: 10, bold: true, color: COLORS.red
      });
      curY += 0.62;
    });
  }

  addFooter(slide, projectName, 'Key Decisions · Slide 4');
}

// ---------------------------------------------------------------------------
// Slide 5 — BOM / ECO Status
// ---------------------------------------------------------------------------
function buildBomSlide(pptx: any, projectName: string, latestBom: any | null) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'BOM / ECO Status', 'LATEST REVISION');

  if (!latestBom) {
    slide.addText('No BOM revisions uploaded yet.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'BOM / ECO Status · Slide 5');
    return;
  }

  const fields: Array<[string, string]> = [
    ['Revision / Label',  latestBom.versionLabel || '—'],
    ['File',              latestBom.fileName || 'ECO-only entry'],
    ['Effective Date',    fmtMs(latestBom.effectiveDateMs)],
    ['Total Lines',       String(latestBom.totalLines ?? '—')],
    ['Reason for Change', clamp(latestBom.reasonForChange || '—', 120)],
  ];

  let y = 1.2;
  fields.forEach(([label, value]) => {
    slide.addText(label.toUpperCase(), {
      x: 0.4, y, w: 2.5, h: 0.3,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, charSpacing: 1
    });
    slide.addText(value, {
      x: 3.0, y, w: 6.6, h: 0.3,
      fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.slate800 as any
    });
    // Divider
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: y + 0.32, w: 9.2, h: 0.01,
      fill: { color: COLORS.slate300 }, line: { color: COLORS.slate300 }
    });
    y += 0.65;
  });

  addFooter(slide, projectName, 'BOM / ECO Status · Slide 5');
}

// ---------------------------------------------------------------------------
// Slide 6 — Manufacturing Readiness (Takt)
// ---------------------------------------------------------------------------
function buildManufacturingSlide(pptx: any, projectName: string, taktSummary: any | null) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Manufacturing Readiness', 'TAKT STUDY SUMMARY');

  if (!taktSummary) {
    slide.addText('No completed takt study yet.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'Manufacturing Readiness · Slide 6');
    return;
  }

  const verdict = (taktSummary.capacity as string) || 'AWAITING';
  const verdictColor = verdict === 'PASS' ? COLORS.emerald
    : verdict === 'WARNING' ? COLORS.amber : COLORS.red;

  // Verdict badge
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.4, y: 1.1, w: 3.5, h: 1.2,
    fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
  });
  slide.addText('CAPACITY VERDICT', {
    x: 0.5, y: 1.2, w: 3.3, h: 0.25,
    fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, charSpacing: 2
  });
  slide.addText(verdict, {
    x: 0.5, y: 1.45, w: 3.3, h: 0.65,
    fontFace: 'Arial', fontSize: 32, bold: true, color: verdictColor, align: 'center'
  });

  const metrics: Array<[string, string]> = [
    ['Takt Time',          taktSummary.taktSec != null ? taktSummary.taktSec + ' sec' : '—'],
    ['Bottleneck',         taktSummary.bottleneckSec != null ? taktSummary.bottleneckSec + ' sec' : '—'],
    ['Balance Loss',       taktSummary.balanceLoss != null ? Math.round(taktSummary.balanceLoss) + '%' : '—'],
    ['Completed',          fmtMs(taktSummary.completedAtMs)],
  ];

  let y = 1.1;
  metrics.forEach(([label, value]) => {
    slide.addText(label.toUpperCase(), {
      x: 4.4, y, w: 2.2, h: 0.28,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, charSpacing: 1
    });
    slide.addText(value, {
      x: 6.7, y, w: 2.9, h: 0.28,
      fontFace: 'Arial', fontSize: 12, bold: true, color: COLORS.slate800 as any
    });
    y += 0.42;
  });

  addFooter(slide, projectName, 'Manufacturing Readiness · Slide 6');
}

// ---------------------------------------------------------------------------
// Slide 7 — Budget Overview
// ---------------------------------------------------------------------------
function buildBudgetSlide(pptx: any, projectName: string, budget: any | null) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Budget Overview', 'PLAN vs ACTUALS');

  if (!budget) {
    slide.addText('No budget data recorded yet.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'Budget Overview · Slide 7');
    return;
  }

  const actual = Array.isArray(budget.lines)
    ? (budget.lines as any[]).reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0)
    : 0;
  const planned = Number(budget.kickoffEstimate) || 0;
  const variance = planned > 0 ? Math.round(((actual - planned) / planned) * 100) : 0;
  const varColor = variance > 10 ? COLORS.red : variance < 0 ? COLORS.emerald : COLORS.amber;

  const bigNumbers: Array<[string, string, string]> = [
    ['PLANNED',  planned > 0 ? '$' + planned.toLocaleString() : '—', COLORS.slate700],
    ['ACTUAL',   actual > 0  ? '$' + actual.toLocaleString()  : '—', COLORS.slate700],
    ['VARIANCE', planned > 0 ? (variance >= 0 ? '+' : '') + variance + '%' : '—', varColor],
  ];

  bigNumbers.forEach(([label, value, color], i) => {
    const x = 0.4 + i * 3.1;
    slide.addShape(pptx.ShapeType.rect, {
      x, y: 1.1, w: 3.0, h: 1.4,
      fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
    });
    slide.addText(label, {
      x: x + 0.1, y: 1.2, w: 2.8, h: 0.28,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500,
      charSpacing: 2, align: 'center'
    });
    slide.addText(value, {
      x: x + 0.1, y: 1.48, w: 2.8, h: 0.75,
      fontFace: 'Arial', fontSize: 24, bold: true,
      color: color as any, align: 'center'
    });
  });

  if (budget.notes) {
    slide.addText('NOTES', {
      x: 0.4, y: 3.0, w: 9.2, h: 0.25,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, charSpacing: 2
    });
    slide.addText(clamp(budget.notes, 200), {
      x: 0.4, y: 3.28, w: 9.2, h: 0.6,
      fontFace: 'Arial', fontSize: 10, color: COLORS.slate700
    });
  }

  addFooter(slide, projectName, 'Budget Overview · Slide 7');
}

// ---------------------------------------------------------------------------
// Slide 8 — Open Actions (MUST from Design Reviews, Meetings, Lessons)
// ---------------------------------------------------------------------------
function buildOpenActionsSlide(
  pptx: any,
  projectName: string,
  designReviews: any[],
  meetings: any[],
  lessons: any[]
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Open Actions', 'MUST ACTIONS — DESIGN REVIEWS · MEETINGS · LESSONS');

  const actions: Array<{ source: string; text: string; owner: string; targetDateMs?: number }> = [];

  for (const r of designReviews) {
    if (Array.isArray(r.actionItems)) {
      for (const a of r.actionItems) {
        if (a.priority === 'must' && !a.done) {
          actions.push({ source: 'Review: ' + clamp(r.title, 25), text: a.text, owner: a.owner, targetDateMs: a.targetDateMs });
        }
      }
    }
  }
  for (const m of meetings) {
    const lines = (m.actionItems as string || '').split('\n').filter(Boolean);
    if (lines.length) {
      actions.push({ source: 'Meeting: ' + clamp(m.scope || m.title || '', 25), text: lines[0], owner: '', targetDateMs: undefined });
    }
  }
  for (const l of lessons) {
    if (Array.isArray(l.actionItems)) {
      for (const a of l.actionItems) {
        if (a.priority === 'must' && !a.done) {
          actions.push({ source: 'Lesson: ' + clamp(l.title, 25), text: a.text, owner: a.owner, targetDateMs: a.targetDateMs });
        }
      }
    }
  }

  const top = actions.slice(0, 8);

  if (!top.length) {
    slide.addText('No open MUST actions.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'Open Actions · Slide 8');
    return;
  }

  let y = 1.1;
  top.forEach(a => {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y, w: 9.2, h: 0.62,
      fill: { color: 'FFF1F2' }, line: { color: 'FECDD3' }
    });
    slide.addText(clamp(a.text, 80), {
      x: 0.6, y: y + 0.05, w: 6, h: 0.3,
      fontFace: 'Arial', fontSize: 10, bold: true, color: COLORS.slate900
    });
    slide.addText(a.source, {
      x: 0.6, y: y + 0.33, w: 4, h: 0.22,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500
    });
    if (a.owner) {
      slide.addText('→ ' + a.owner, {
        x: 7, y: y + 0.1, w: 2.5, h: 0.25,
        fontFace: 'Arial', fontSize: 9, color: COLORS.sky, align: 'right'
      });
    }
    if (a.targetDateMs) {
      slide.addText(fmtMs(a.targetDateMs), {
        x: 7, y: y + 0.33, w: 2.5, h: 0.22,
        fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, align: 'right'
      });
    }
    y += 0.68;
  });

  if (actions.length > 8) {
    slide.addText(`+ ${actions.length - 8} more open actions`, {
      x: 0.4, y: y + 0.1, w: 9.2, h: 0.25,
      fontFace: 'Arial', fontSize: 9, color: COLORS.slate500
    });
  }

  addFooter(slide, projectName, 'Open Actions · Slide 8');
}

// ---------------------------------------------------------------------------
// Slide 9 — Next Steps (AI top actions)
// ---------------------------------------------------------------------------
function buildNextStepsSlide(pptx: any, projectName: string, topActions: any[]) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addHeaderBar(slide, pptx, 'Next Steps', 'AI TOP ACTIONS');

  if (!topActions.length) {
    slide.addText('Run AI Analysis to generate next steps.', {
      x: 0.4, y: 2, w: 9.2, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: COLORS.slate500
    });
    addFooter(slide, projectName, 'Next Steps · Slide 9');
    return;
  }

  let y = 1.1;
  topActions.slice(0, 5).forEach((action, i) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y, w: 9.2, h: 0.95,
      fill: { color: i === 0 ? 'F0F9FF' : COLORS.white },
      line: { color: COLORS.slate300 }
    });
    // Number badge
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.5, y: y + 0.1, w: 0.35, h: 0.35,
      fill: { color: COLORS.sky }, line: { color: COLORS.sky }
    });
    slide.addText(String(i + 1), {
      x: 0.5, y: y + 0.1, w: 0.35, h: 0.35,
      fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.white, align: 'center'
    });

    slide.addText(clamp(action.action || action.title || '', 90), {
      x: 1.0, y: y + 0.08, w: 7.9, h: 0.32,
      fontFace: 'Arial', fontSize: 11, bold: true, color: COLORS.slate900
    });
    if (action.rationale) {
      slide.addText(clamp(action.rationale, 110), {
        x: 1.0, y: y + 0.42, w: 7.9, h: 0.42,
        fontFace: 'Arial', fontSize: 9, color: COLORS.slate500
      });
    }
    y += 1.0;
  });

  addFooter(slide, projectName, 'Next Steps · Slide 9');
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------
interface GeneratePackageOptions {
  db: any;
  userId: string;
  projectId: string;
  projectName: string;
  currentGate?: ProductGate;
  project: any;
  groupScores: Record<string, number>;
  overall: number;
  onStatus?: (msg: string) => void;
}

export async function generateAndDownloadReviewPackage(opts: GeneratePackageOptions): Promise<void> {
  const { db: firestoreDb, userId, projectId, projectName, currentGate, project, groupScores, overall, onStatus } = opts;

  onStatus?.('Fetching PFMEA data…');
  const pfmeaQ = query(
    collection(firestoreDb, 'pfmeas'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    orderBy('dateMs', 'desc'),
    limit(3)
  );
  const pfmeaSnap = await getDocs(pfmeaQ);
  const pfmeas = pfmeaSnap.docs.map(d => d.data());

  onStatus?.('Fetching decisions…');
  const decisionQ = query(
    collection(firestoreDb, 'decisions'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    orderBy('dateMs', 'desc'),
    limit(10)
  );
  const decisionSnap = await getDocs(decisionQ);
  const decisions = decisionSnap.docs.map(d => d.data());

  onStatus?.('Fetching BOM/ECO data…');
  const bomQ = query(
    collection(firestoreDb, 'productBoms'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    orderBy('uploadedAtMs', 'desc'),
    limit(1)
  );
  const bomSnap = await getDocs(bomQ);
  const latestBom = bomSnap.empty ? null : bomSnap.docs[0].data();

  onStatus?.('Fetching design reviews…');
  const reviewQ = query(
    collection(firestoreDb, 'designReviews'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    orderBy('dateMs', 'desc'),
    limit(5)
  );
  const reviewSnap = await getDocs(reviewQ);
  const designReviews = reviewSnap.docs.map(d => d.data());

  onStatus?.('Fetching meetings…');
  const meetingsQ = query(
    collection(firestoreDb, 'meetings'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    orderBy('dateMs', 'desc'),
    limit(5)
  );
  const meetingsSnap = await getDocs(meetingsQ);
  const meetings = meetingsSnap.docs.map(d => d.data());

  onStatus?.('Fetching lessons…');
  const lessonsQ = query(
    collection(firestoreDb, 'lessons'),
    where('userId', '==', userId),
    where('projectId', '==', projectId),
    orderBy('dateMs', 'desc'),
    limit(10)
  );
  const lessonsSnap = await getDocs(lessonsQ);
  const lessons = lessonsSnap.docs.map(d => d.data());

  onStatus?.('Fetching budget…');
  const budgetRef = doc(firestoreDb, 'projectBudgets', projectId);
  const budgetSnap = await getDoc(budgetRef);
  const budget = budgetSnap.exists() ? budgetSnap.data() : null;

  onStatus?.('Loading AI analysis…');
  const intelligenceRef = doc(firestoreDb, 'projectIntelligence', projectId);
  const intelligenceSnap = await getDoc(intelligenceRef);
  const intelligence = intelligenceSnap.exists() ? intelligenceSnap.data() : null;
  const aiSnapshot = intelligence?.analysis?.statusSnapshot as string | undefined;
  const topActions = (intelligence?.analysis?.topActions as any[]) || [];

  const taktSummary = project.taktSummary ?? null;

  onStatus?.('Building slides…');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  buildCoverSlide(pptx, projectName, currentGate, overall, today);
  buildProgramStatusSlide(pptx, projectName, groupScores, overall, aiSnapshot);
  buildRisksSlide(pptx, projectName, pfmeas);
  buildDecisionsSlide(pptx, projectName, decisions);
  buildBomSlide(pptx, projectName, latestBom);
  buildManufacturingSlide(pptx, projectName, taktSummary);
  buildBudgetSlide(pptx, projectName, budget);
  buildOpenActionsSlide(pptx, projectName, designReviews, meetings, lessons);
  buildNextStepsSlide(pptx, projectName, topActions);

  onStatus?.('Downloading…');
  const safeName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
  const dateSlug = new Date().toISOString().split('T')[0];
  await pptx.writeFile({ fileName: `${safeName}__review_package__${dateSlug}.pptx` });
}
