// ---------------------------------------------------------------------------
// pptxGenerator.ts — Project Health Snapshot PPTX export for ProjectDeepDive.
// Uses pptxgenjs (client-side, browser-compatible) to produce a 2-5 slide
// editable deck summarising a project's readiness snapshot + latest AI output.
//
// Slide layout:
//   1. Overview       — name, type, readiness %, current gate, status, dates,
//                       AI narrative (if present)
//   2. Readiness      — 4 RAMP group scores as visual bars + overall score
//   Scorecard           + AI status snapshot (only if AI analysis exists)
//   3. Timelines      — start/end + all stage-gate target dates, current gate
//                       highlighted
//   4. Top Actions    — top 3 AI actions (title + rationale + impact badge)
//                       [only if an AI analysis exists]
//   5. Risks          — flagged risks with severity + source (top 8, HIGH
//                       visually accented) [only if an AI analysis exists]
// ---------------------------------------------------------------------------

import PptxGenJS from 'pptxgenjs';
import type { AIAnalysis } from './aiClient';
import type { DeepDiveProject, ProductGate } from './ProjectDeepDive';

// RAMP group display labels + accent colors (mirrors RAMP_GROUPS in rampGroups.ts).
const RAMP_GROUP_META: Array<{ id: string; label: string; shortLabel: string; barColor: string }> = [
  { id: 'product_design',      label: 'Product & Design Readiness',    shortLabel: 'Product & Design',    barColor: '2563EB' },
  { id: 'manufacturing',       label: 'Manufacturing Readiness',        shortLabel: 'Manufacturing',        barColor: '10B981' },
  { id: 'supply_chain',        label: 'Supply Chain Readiness',         shortLabel: 'Supply Chain',         barColor: 'F59E0B' },
  { id: 'quality_reliability', label: 'Quality & Reliability Readiness', shortLabel: 'Quality & Reliability', barColor: '8B5CF6' },
];

// Hardware stage-gate ordering + readable labels.
const GATE_ORDER: ProductGate[] = ['CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'];
const GATE_LABELS: Record<ProductGate, string> = {
  'CR':  'Concept Review',
  'PDR': 'Preliminary Design Review',
  'CDR': 'Critical Design Review',
  'TRR': 'Test Readiness Review',
  'PRR': 'Production Readiness Review',
  'MP':  'Mass Production'
};

// BridgeOps brand palette.
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
  white:    'FFFFFF'
};

const IMPACT_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high:   COLORS.red,
  medium: COLORS.amber,
  low:    COLORS.emerald
};

const SEVERITY_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high:   COLORS.red,
  medium: COLORS.amber,
  low:    COLORS.emerald
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  // ISO 'YYYY-MM-DD' → 'Apr 17, 2026'
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function clamp(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Compute the overall readiness percent from metrics — mirrors rampGroups logic
// via the score already cached on the project if available; else recomputes.
function overallScore(project: DeepDiveProject, fallback?: number): number {
  if (typeof fallback === 'number') return fallback;
  const anyProj = project as any;
  if (typeof anyProj.lastScore === 'number') return Math.round(anyProj.lastScore);
  return 0;
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function addHeaderBar(slide: any, pptx: any, title: string, subtitle: string) {
  // Dark slate top banner
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 0.9,
    fill: { color: COLORS.slate900 },
    line: { color: COLORS.slate900 }
  });
  // Blue accent stripe
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0.9, w: '100%', h: 0.05,
    fill: { color: COLORS.blue600 },
    line: { color: COLORS.blue600 }
  });

  slide.addText(title, {
    x: 0.4, y: 0.12, w: 9.2, h: 0.4,
    fontFace: 'Arial',
    fontSize: 22,
    bold: true,
    color: COLORS.white
  });

  slide.addText(subtitle, {
    x: 0.4, y: 0.52, w: 9.2, h: 0.3,
    fontFace: 'Arial',
    fontSize: 10,
    color: COLORS.blue400,
    charSpacing: 4
  });
}

function addFooter(slide: any, projectName: string, pageLabel: string) {
  slide.addText(
    `BridgeOps Engineering  |  ${projectName}  |  ${pageLabel}`,
    {
      x: 0.4, y: 7.15, w: 9.2, h: 0.25,
      fontFace: 'Arial',
      fontSize: 8,
      color: COLORS.slate500,
      charSpacing: 2
    }
  );
}

function buildOverviewSlide(
  pptx: any,
  project: DeepDiveProject,
  analysis: AIAnalysis | null,
  score: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  addHeaderBar(
    slide,
    pptx,
    clamp(project.name, 60),
    'EXECUTIVE SUMMARY — OVERVIEW'
  );

  // Readiness tile (top-right)
  slide.addShape(pptx.ShapeType.rect, {
    x: 7.3, y: 1.25, w: 2.3, h: 1.4,
    fill: { color: COLORS.slate900 },
    line: { color: COLORS.slate900 }
  });
  slide.addText('OVERALL READINESS', {
    x: 7.3, y: 1.3, w: 2.3, h: 0.3,
    fontFace: 'Arial',
    fontSize: 8,
    bold: true,
    color: COLORS.blue400,
    align: 'center',
    charSpacing: 3
  });
  slide.addText(`${Math.round(score)}%`, {
    x: 7.3, y: 1.55, w: 2.3, h: 1.1,
    fontFace: 'Arial',
    fontSize: 48,
    bold: true,
    color: COLORS.white,
    align: 'center',
    valign: 'middle'
  });

  // Left-column facts
  const gatesEnabled = (project.templateId ?? 'full_ramp') === 'full_ramp';
  const facts: Array<[string, string]> = [];
  facts.push(['Product Type', project.productType || '—']);
  facts.push(['Status', project.infoStatus || 'TBD']);
  if (gatesEnabled) {
    facts.push([
      'Current Stage Gate',
      project.currentGate
        ? `${project.currentGate} — ${GATE_LABELS[project.currentGate]}`
        : 'Not set'
    ]);
  } else {
    const scopeLabels: Record<string, string> = {
      pcba: 'PCBA / Sub-Assembly',
      mechanical: 'Mechanical Module',
      pilot: 'Pilot / Prototype',
      custom: 'Custom'
    };
    facts.push(['Scope', scopeLabels[project.templateId || ''] || 'Custom']);
  }
  facts.push(['Start Date', formatDate(project.startDate)]);
  facts.push(['End Date', formatDate(project.endDate)]);

  let y = 1.25;
  for (const [label, value] of facts) {
    slide.addText(label.toUpperCase(), {
      x: 0.4, y, w: 2.3, h: 0.3,
      fontFace: 'Arial',
      fontSize: 9,
      bold: true,
      color: COLORS.slate500,
      charSpacing: 3
    });
    slide.addText(value, {
      x: 2.7, y, w: 4.5, h: 0.3,
      fontFace: 'Arial',
      fontSize: 12,
      color: COLORS.slate900
    });
    y += 0.42;
  }

  // Narrative block (below the facts)
  const narrative = analysis?.narrative
    ? clamp(analysis.narrative, 900)
    : (project.generalInfo
       ? clamp(project.generalInfo, 600)
       : 'No narrative available. Run AI Analysis from the workspace to populate this section.');

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.4, y: 3.65, w: 9.2, h: 0.05,
    fill: { color: COLORS.slate300 },
    line: { color: COLORS.slate300 }
  });

  slide.addText(
    analysis?.narrative ? 'AI NARRATIVE' : 'NOTES',
    {
      x: 0.4, y: 3.8, w: 9.2, h: 0.3,
      fontFace: 'Arial',
      fontSize: 9,
      bold: true,
      color: COLORS.blue600,
      charSpacing: 3
    }
  );
  slide.addText(narrative, {
    x: 0.4, y: 4.15, w: 9.2, h: 2.9,
    fontFace: 'Arial',
    fontSize: 11,
    color: COLORS.slate700,
    valign: 'top',
    paraSpaceAfter: 6
  });

  addFooter(slide, project.name, '1 / Overview');
}

function buildScorecardSlide(
  pptx: any,
  project: DeepDiveProject,
  groupScores: Record<string, number>,
  overall: number,
  analysis: AIAnalysis | null,
  pageLabel: string
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  addHeaderBar(
    slide,
    pptx,
    clamp(project.name, 60),
    'PROJECT HEALTH SNAPSHOT — READINESS SCORECARD'
  );

  // Overall score tile (top-right)
  const bandColor =
    overall >= 80 ? COLORS.emerald :
    overall >= 50 ? COLORS.amber :
    COLORS.red;

  slide.addShape(pptx.ShapeType.rect, {
    x: 7.3, y: 1.1, w: 2.3, h: 1.55,
    fill: { color: COLORS.slate900 },
    line: { color: COLORS.slate900 }
  });
  slide.addText('OVERALL', {
    x: 7.3, y: 1.15, w: 2.3, h: 0.25,
    fontFace: 'Arial', fontSize: 8, bold: true, color: COLORS.blue400,
    align: 'center', charSpacing: 4
  });
  slide.addText(`${Math.round(overall)}%`, {
    x: 7.3, y: 1.35, w: 2.3, h: 0.9,
    fontFace: 'Arial', fontSize: 52, bold: true, color: bandColor,
    align: 'center', valign: 'middle'
  });

  // Status snapshot (if AI ran)
  const snapshot = analysis?.statusSnapshot;
  if (snapshot) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.1, w: 6.7, h: 0.55,
      fill: { color: COLORS.slate900 },
      line: { color: COLORS.slate900 }
    });
    slide.addText('AI STATUS SNAPSHOT', {
      x: 0.55, y: 1.1, w: 2.0, h: 0.55,
      fontFace: 'Arial', fontSize: 8, bold: true, color: COLORS.blue400,
      valign: 'middle', charSpacing: 3
    });
    slide.addText(clamp(snapshot, 120), {
      x: 2.6, y: 1.1, w: 4.4, h: 0.55,
      fontFace: 'Arial', fontSize: 10, color: COLORS.white,
      valign: 'middle'
    });
  }

  // RAMP group score bars
  const barTop = 1.85;
  const barRowH = 1.1;

  RAMP_GROUP_META.forEach((meta, idx) => {
    const score = groupScores[meta.id] ?? 0;
    const y = barTop + idx * barRowH;
    const barMaxW = 5.5;
    const barFillW = Math.max(0, Math.min(1, score / 100)) * barMaxW;

    // Label
    slide.addText(meta.shortLabel.toUpperCase(), {
      x: 0.4, y, w: 3.0, h: 0.35,
      fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.slate700, valign: 'middle', charSpacing: 2
    });

    // Score value
    const scoreColor =
      score >= 80 ? COLORS.emerald :
      score >= 50 ? COLORS.amber :
      COLORS.red;
    slide.addText(`${Math.round(score)}%`, {
      x: 3.1, y, w: 0.8, h: 0.35,
      fontFace: 'Arial', fontSize: 13, bold: true, color: scoreColor, valign: 'middle', align: 'right'
    });

    // Bar background
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: y + 0.4, w: barMaxW, h: 0.32,
      fill: { color: COLORS.slate300 },
      line: { color: COLORS.slate300 }
    });
    // Bar fill
    if (barFillW > 0) {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: y + 0.4, w: barFillW, h: 0.32,
        fill: { color: meta.barColor },
        line: { color: meta.barColor }
      });
    }

    // Thin separator
    if (idx < RAMP_GROUP_META.length - 1) {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: y + barRowH - 0.05, w: barMaxW, h: 0.02,
        fill: { color: COLORS.slate300 },
        line: { color: COLORS.slate300 }
      });
    }
  });

  // Legend: score bands
  const legendY = barTop + RAMP_GROUP_META.length * barRowH + 0.1;
  const bands: Array<[string, string]> = [
    ['≥ 80% On Track', COLORS.emerald],
    ['50–79% At Risk', COLORS.amber],
    ['< 50% Critical', COLORS.red],
  ];
  let lx = 0.4;
  for (const [label, color] of bands) {
    slide.addShape(pptx.ShapeType.rect, {
      x: lx, y: legendY, w: 0.18, h: 0.18,
      fill: { color }, line: { color }
    });
    slide.addText(label, {
      x: lx + 0.24, y: legendY, w: 1.6, h: 0.2,
      fontFace: 'Arial', fontSize: 8, color: COLORS.slate500, valign: 'middle'
    });
    lx += 1.9;
  }

  // Gate + assignees context (right column, below overall tile)
  const gatesEnabledSC = (project.templateId ?? 'full_ramp') === 'full_ramp';
  const contextY = 2.75;
  const ctxItems: Array<[string, string]> = [];
  if (gatesEnabledSC && project.currentGate) ctxItems.push(['Current Gate', `${project.currentGate} — ${GATE_LABELS[project.currentGate]}`]);
  if (project.infoStatus) ctxItems.push(['Status', project.infoStatus]);
  if ((project as any).assignees) ctxItems.push(['Team', clamp((project as any).assignees, 80)]);

  let cy = contextY;
  for (const [lbl, val] of ctxItems) {
    slide.addText(lbl.toUpperCase(), {
      x: 6.2, y: cy, w: 1.5, h: 0.28,
      fontFace: 'Arial', fontSize: 8, bold: true, color: COLORS.slate500, charSpacing: 2
    });
    slide.addText(val, {
      x: 7.75, y: cy, w: 1.85, h: 0.28,
      fontFace: 'Arial', fontSize: 10, color: COLORS.slate900, valign: 'middle'
    });
    cy += 0.38;
  }

  addFooter(slide, project.name, pageLabel);
}

function buildTimelineSlide(
  pptx: any,
  project: DeepDiveProject,
  pageLabel: string
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  const gatesEnabled = (project.templateId ?? 'full_ramp') === 'full_ramp';

  addHeaderBar(
    slide,
    pptx,
    clamp(project.name, 60),
    gatesEnabled
      ? 'PROJECT HEALTH SNAPSHOT — TIMELINE & STAGE GATES'
      : 'PROJECT HEALTH SNAPSHOT — TIMELINE'
  );

  // Project window — always shown
  slide.addText('PROJECT WINDOW', {
    x: 0.4, y: 1.2, w: 9.2, h: 0.3,
    fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.blue600, charSpacing: 3
  });

  slide.addText(
    [
      { text: 'Start: ',    options: { fontSize: 11, color: COLORS.slate500, bold: true } },
      { text: formatDate(project.startDate), options: { fontSize: 12, color: COLORS.slate900 } },
      { text: '     End: ', options: { fontSize: 11, color: COLORS.slate500, bold: true } },
      { text: formatDate(project.endDate),   options: { fontSize: 12, color: COLORS.slate900 } }
    ],
    { x: 0.4, y: 1.5, w: 9.2, h: 0.35, fontFace: 'Arial' }
  );

  if (gatesEnabled) {
    // Full gate table — Full Ramp only
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 2.1, w: 9.2, h: 0.45,
      fill: { color: COLORS.slate900 }, line: { color: COLORS.slate900 }
    });
    slide.addText('STAGE GATE', {
      x: 0.6, y: 2.1, w: 2.4, h: 0.45,
      fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.white, valign: 'middle', charSpacing: 3
    });
    slide.addText('DESCRIPTION', {
      x: 3.0, y: 2.1, w: 4.2, h: 0.45,
      fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.white, valign: 'middle', charSpacing: 3
    });
    slide.addText('TARGET DATE', {
      x: 7.2, y: 2.1, w: 2.2, h: 0.45,
      fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.white, valign: 'middle', charSpacing: 3
    });

    const targets = project.gateTargets || {};
    let rowY = 2.6;
    const rowH = 0.55;
    GATE_ORDER.forEach((gate, idx) => {
      const isCurrent = project.currentGate === gate;
      const rowBg = isCurrent ? COLORS.blue600 : (idx % 2 === 0 ? COLORS.slate100 : COLORS.white);
      const txtColor = isCurrent ? COLORS.white : COLORS.slate900;
      const subColor = isCurrent ? COLORS.white : COLORS.slate500;

      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: rowY, w: 9.2, h: rowH,
        fill: { color: rowBg }, line: { color: rowBg }
      });
      slide.addText(isCurrent ? `${gate}  ◀ CURRENT` : gate, {
        x: 0.6, y: rowY, w: 2.4, h: rowH,
        fontFace: 'Arial', fontSize: 12, bold: true, color: txtColor, valign: 'middle'
      });
      slide.addText(GATE_LABELS[gate], {
        x: 3.0, y: rowY, w: 4.2, h: rowH,
        fontFace: 'Arial', fontSize: 11, color: subColor, valign: 'middle'
      });
      slide.addText(formatDate(targets[gate]), {
        x: 7.2, y: rowY, w: 2.2, h: rowH,
        fontFace: 'Arial', fontSize: 11, bold: true, color: txtColor, valign: 'middle'
      });
      rowY += rowH + 0.05;
    });
  } else {
    // Non-Full-Ramp: note that stage gates are not applicable
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 2.1, w: 9.2, h: 0.55,
      fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
    });
    slide.addText('Stage gate tracking is not applicable for this project scope.', {
      x: 0.6, y: 2.1, w: 8.8, h: 0.55,
      fontFace: 'Arial', fontSize: 11, italic: true, color: COLORS.slate500, valign: 'middle'
    });
  }

  addFooter(slide, project.name, pageLabel);
}

function buildDeliverablesSlide(
  pptx: any,
  project: DeepDiveProject,
  analysis: AIAnalysis | null,
  pageLabel: string
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  addHeaderBar(
    slide,
    pptx,
    clamp(project.name, 60),
    'EXECUTIVE SUMMARY — LATEST DELIVERABLES'
  );

  slide.addText('TOP 3 RECOMMENDED ACTIONS (AI GENERATED)', {
    x: 0.4, y: 1.15, w: 9.2, h: 0.3,
    fontFace: 'Arial',
    fontSize: 9,
    bold: true,
    color: COLORS.blue600,
    charSpacing: 3
  });

  if (!analysis) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 2.5, w: 9.2, h: 1.2,
      fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
    });
    slide.addText('Run AI Analysis from the project workspace to populate this slide.', {
      x: 0.6, y: 2.5, w: 8.8, h: 1.2,
      fontFace: 'Arial', fontSize: 13, italic: true, color: COLORS.slate500,
      align: 'center', valign: 'middle'
    });
    addFooter(slide, project.name, pageLabel);
    return;
  }

  const actions = (analysis.topActions || []).slice(0, 3);

  if (actions.length === 0) {
    slide.addText('No actions available.', {
      x: 0.4, y: 3.2, w: 9.2, h: 0.4,
      fontFace: 'Arial',
      fontSize: 12,
      color: COLORS.slate500,
      align: 'center'
    });
    addFooter(slide, project.name, pageLabel);
    return;
  }

  const cardTop = 1.55;
  const cardHeight = 1.65;
  const cardGap = 0.15;

  actions.forEach((action, idx) => {
    const y = cardTop + idx * (cardHeight + cardGap);

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y, w: 9.2, h: cardHeight,
      fill: { color: COLORS.slate100 },
      line: { color: COLORS.slate300 }
    });

    // Number circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.6, y: y + 0.25, w: 0.6, h: 0.6,
      fill: { color: COLORS.blue600 },
      line: { color: COLORS.blue600 }
    });
    slide.addText(`${idx + 1}`, {
      x: 0.6, y: y + 0.25, w: 0.6, h: 0.6,
      fontFace: 'Arial', fontSize: 20, bold: true, color: COLORS.white,
      align: 'center', valign: 'middle'
    });

    // Impact pill
    const impact = action.impact || 'medium';
    const pillColor = IMPACT_COLOR[impact];
    slide.addShape(pptx.ShapeType.rect, {
      x: 8.1, y: y + 0.2, w: 1.3, h: 0.35,
      fill: { color: pillColor },
      line: { color: pillColor }
    });
    slide.addText(`${impact.toUpperCase()} IMPACT`, {
      x: 8.1, y: y + 0.2, w: 1.3, h: 0.35,
      fontFace: 'Arial', fontSize: 8, bold: true, color: COLORS.white,
      align: 'center', valign: 'middle', charSpacing: 2
    });

    // Title
    slide.addText(clamp(action.title || '', 90), {
      x: 1.4, y: y + 0.15, w: 6.6, h: 0.4,
      fontFace: 'Arial', fontSize: 13, bold: true, color: COLORS.slate900
    });

    // Rationale
    slide.addText(clamp(action.rationale || '', 280), {
      x: 1.4, y: y + 0.6, w: 8.0, h: cardHeight - 0.7,
      fontFace: 'Arial', fontSize: 10, color: COLORS.slate700, valign: 'top'
    });
  });

  addFooter(slide, project.name, pageLabel);
}

function buildRisksSlide(
  pptx: any,
  project: DeepDiveProject,
  analysis: AIAnalysis | null,
  pageLabel: string
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };

  addHeaderBar(
    slide,
    pptx,
    clamp(project.name, 60),
    'EXECUTIVE SUMMARY — RISKS'
  );

  slide.addText('FLAGGED RISKS (AI GENERATED)', {
    x: 0.4, y: 1.15, w: 9.2, h: 0.3,
    fontFace: 'Arial',
    fontSize: 9,
    bold: true,
    color: COLORS.blue600,
    charSpacing: 3
  });

  if (!analysis) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 2.5, w: 9.2, h: 1.2,
      fill: { color: COLORS.slate100 }, line: { color: COLORS.slate300 }
    });
    slide.addText('Run AI Analysis from the project workspace to populate this slide.', {
      x: 0.6, y: 2.5, w: 8.8, h: 1.2,
      fontFace: 'Arial', fontSize: 13, italic: true, color: COLORS.slate500,
      align: 'center', valign: 'middle'
    });
    addFooter(slide, project.name, pageLabel);
    return;
  }

  const risks = analysis.risks || [];

  if (risks.length === 0) {
    slide.addText('No risks flagged.', {
      x: 0.4, y: 3.2, w: 9.2, h: 0.4,
      fontFace: 'Arial',
      fontSize: 12,
      color: COLORS.slate500,
      align: 'center'
    });
    addFooter(slide, project.name, pageLabel);
    return;
  }

  // Table header
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.4, y: 1.55, w: 9.2, h: 0.45,
    fill: { color: COLORS.slate900 },
    line: { color: COLORS.slate900 }
  });
  slide.addText('SEVERITY', {
    x: 0.55, y: 1.55, w: 1.3, h: 0.45,
    fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.white, valign: 'middle', charSpacing: 3
  });
  slide.addText('RISK', {
    x: 1.9, y: 1.55, w: 5.3, h: 0.45,
    fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.white, valign: 'middle', charSpacing: 3
  });
  slide.addText('SOURCE', {
    x: 7.2, y: 1.55, w: 2.3, h: 0.45,
    fontFace: 'Arial', fontSize: 9, bold: true, color: COLORS.white, valign: 'middle', charSpacing: 3
  });

  // Risk rows — cap at 8 (sorted HIGH first). HIGH rows get a rose left-accent bar.
  const sorted = [...risks].sort((a, b) => {
    const ord: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (ord[a.severity || 'medium'] ?? 1) - (ord[b.severity || 'medium'] ?? 1);
  });
  const shown = sorted.slice(0, 8);
  let rowY = 2.05;
  const rowH = 0.57; // 8 rows × (0.57 + 0.04) = 4.88 — fits within 7.15 footer

  shown.forEach((risk, idx) => {
    const sev = risk.severity || 'medium';
    const isHigh = sev === 'high';
    const bg = isHigh ? 'FFF1F2' : (idx % 2 === 0 ? COLORS.slate100 : COLORS.white);
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: rowY, w: 9.2, h: rowH,
      fill: { color: bg },
      line: { color: COLORS.slate300 }
    });
    // Rose left-accent bar for HIGH risks
    if (isHigh) {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.4, y: rowY, w: 0.09, h: rowH,
        fill: { color: COLORS.red },
        line: { color: COLORS.red }
      });
    }

    // Severity pill
    const pillColor = SEVERITY_COLOR[sev];
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6, y: rowY + 0.16, w: 1.0, h: 0.3,
      fill: { color: pillColor },
      line: { color: pillColor }
    });
    slide.addText(sev.toUpperCase(), {
      x: 0.6, y: rowY + 0.16, w: 1.0, h: 0.3,
      fontFace: 'Arial', fontSize: 8, bold: true, color: COLORS.white,
      align: 'center', valign: 'middle', charSpacing: 2
    });

    // Flag text
    slide.addText(clamp(risk.flag || '', 200), {
      x: 1.75, y: rowY + 0.08, w: 5.45, h: rowH - 0.16,
      fontFace: 'Arial', fontSize: 10, color: COLORS.slate900, valign: 'middle'
    });

    // Source text
    slide.addText(clamp(risk.source || '', 80), {
      x: 7.25, y: rowY + 0.08, w: 2.25, h: rowH - 0.16,
      fontFace: 'Arial', fontSize: 9, color: COLORS.slate700, valign: 'middle'
    });

    rowY += rowH + 0.04;
  });

  if (risks.length > shown.length) {
    slide.addText(
      `+ ${risks.length - shown.length} additional risk${risks.length - shown.length === 1 ? '' : 's'} not shown — see AI Analysis tab for full list.`,
      {
        x: 0.4, y: rowY + 0.08, w: 9.2, h: 0.28,
        fontFace: 'Arial', fontSize: 9, italic: true, color: COLORS.slate500
      }
    );
  }

  addFooter(slide, project.name, pageLabel);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Project Health Snapshot deck for a project and trigger a browser
 * download. Returns the filename that was downloaded.
 *
 * Produces 5 slides when an AI analysis is present, 3 slides otherwise
 * (Overview + Scorecard + Timeline). Output is fully editable PowerPoint.
 */
export async function generateExecutiveSummary(
  project: DeepDiveProject,
  analysis: AIAnalysis | null,
  overallPercent: number,
  groupScores: Record<string, number> = {}
): Promise<string> {
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE' as any;
  pptx.defineLayout({ name: 'BRIDGEOPS_WIDE', width: 10, height: 7.5 });
  pptx.layout = 'BRIDGEOPS_WIDE';

  pptx.title = `${project.name} — Project Health Snapshot`;
  pptx.author = 'BridgeOps Engineering';
  pptx.company = 'BridgeOps Engineering';
  pptx.subject = 'Ramp Readiness — Project Health Snapshot';

  const score = overallScore(project, overallPercent);

  // Always emit all 5 slides. Slides 4 & 5 show a placeholder when AI hasn't run.
  buildOverviewSlide(pptx, project, analysis, score);
  buildScorecardSlide(pptx, project, groupScores, score, analysis, '2 / Scorecard');
  buildTimelineSlide(pptx, project, '3 / Timeline');
  buildDeliverablesSlide(pptx, project, analysis, '4 / Top Actions');
  buildRisksSlide(pptx, project, analysis, '5 / Risks');

  // Safe filename: strip path-hostile chars
  const safeName = (project.name || 'Project')
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'Project';
  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = `${safeName}_Health_Snapshot_${datePart}.pptx`;

  await pptx.writeFile({ fileName });
  return fileName;
}
