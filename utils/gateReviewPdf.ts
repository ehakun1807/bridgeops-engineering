// ---------------------------------------------------------------------------
// gateReviewPdf.ts — builds a formatted "Gate Review Report" PDF for one-click
// export from ProjectDeepDive. Pulls from already-in-memory project state;
// no Firestore reads at generation time.
//
// Sections:
//   1. Cover  — project name, gate, team, readiness score, deliverable summary
//   2. RAMP Readiness — overall % + 4 group bars + gate deliverable checklist
//   3. Program Health — AI statusSnapshot + top risks + top actions
//   4. Tool Signals  — takt, decisions, budget, and any available mirrors
//
// Uses pdf-lib (already a project dependency via Doc Guard / Decision Register).
// ---------------------------------------------------------------------------

import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Input shape — decoupled from Firestore / React so this helper is testable
// ---------------------------------------------------------------------------

export interface GateDeliverable {
  id: string;
  title: string;
  dueBy?: string;
  checked: boolean;
  waived: boolean;
}

export interface GateGroupScore {
  id: string;
  title: string;        // e.g. "Product & Design Readiness"
  score: number;        // 0–100
}

export interface GateReviewInput {
  projectName:   string;
  currentGate:   string;           // e.g. 'CDR'
  reportDate:    Date;
  assignees:     string;
  overall:       number;           // 0–100
  groupScores:   GateGroupScore[];
  deliverables:  GateDeliverable[]; // ALL deliverables — filtered inside
  // AI Analysis (from persisted projectIntelligence or in-memory aiAnalysis)
  statusSnapshot?: string;
  risks?:         Array<{ flag: string; source: string; severity: 'high' | 'medium' | 'low' }>;
  topActions?:    Array<{ title: string; rationale: string; impact: 'high' | 'medium' | 'low' }>;
  analyzedAtMs?:  number | null;
  // Tool signal mirrors (optional — omit if not yet populated)
  taktCapacity?:      'green' | 'yellow' | 'red';
  taktStudyName?:     string;
  taktSec?:           number;
  bottleneckSec?:     number;
  decisionActive?:    number;
  decisionReversed?:  number;
  budgetEstimate?:    number;
  budgetActual?:      number;
}

// ---------------------------------------------------------------------------
// Layout constants (US Letter — 612 × 792 pt)
// ---------------------------------------------------------------------------
const PW = 612;
const PH = 792;
const MX = 52;
const CW = PW - 2 * MX;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const BLUE      = rgb(0.13, 0.35, 0.84);
const BLUE_LT   = rgb(0.93, 0.96, 1.00);
const BLUE_BD   = rgb(0.75, 0.86, 0.98);
const DARK      = rgb(0.10, 0.10, 0.10);
const MID       = rgb(0.44, 0.44, 0.44);
const LIGHT_TXT = rgb(0.80, 0.88, 0.98);
const WHITE     = rgb(1, 1, 1);
const EMERALD   = rgb(0.05, 0.50, 0.30);
const AMBER     = rgb(0.65, 0.42, 0.02);
const ROSE      = rgb(0.72, 0.12, 0.12);
const SLATE     = rgb(0.55, 0.55, 0.60);
const ROSE_LT   = rgb(0.99, 0.92, 0.92);
const AMBER_LT  = rgb(0.99, 0.95, 0.88);
const GREEN_LT  = rgb(0.90, 0.97, 0.94);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapText(text: string, maxW: number, font: PDFFont, fontSize: number): string[] {
  if (!text.trim()) return [];
  const words = text.replace(/\r?\n/g, ' ').split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const probe = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(probe, fontSize) <= maxW) {
      cur = probe;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtMs(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

function scoreBandLabel(score: number): string {
  if (score >= 80) return 'GREEN — Ready';
  if (score >= 60) return 'AMBER — At Risk';
  return 'RED — Not Ready';
}

function scoreBandColor(score: number): ReturnType<typeof rgb> {
  if (score >= 80) return EMERALD;
  if (score >= 60) return AMBER;
  return ROSE;
}

function currency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const GATE_FULL: Record<string, string> = {
  CR: 'Concept Review', PDR: 'Preliminary Design Review',
  CDR: 'Critical Design Review', TRR: 'Test Readiness Review',
  PRR: 'Production Readiness Review', MP: 'Mass Production'
};

// ---------------------------------------------------------------------------
// Page factory — adds running header + returns starting y
// ---------------------------------------------------------------------------

function addPage(
  doc: PDFDocument,
  bold: PDFFont,
  reg: PDFFont,
  projectName: string,
  gate: string
): { page: PDFPage; y: number } {
  const page = doc.addPage([PW, PH]);
  const y0   = PH - MX;

  page.drawText(`GATE REVIEW REPORT  ·  ${gate}`, {
    x: MX, y: y0, font: bold, size: 7, color: BLUE
  });
  const pn = projectName.slice(0, 52);
  page.drawText(pn, {
    x: PW - MX - reg.widthOfTextAtSize(pn, 7),
    y: y0, font: reg, size: 7, color: MID
  });
  page.drawLine({
    start: { x: MX, y: y0 - 6 }, end: { x: PW - MX, y: y0 - 6 },
    thickness: 0.4, color: BLUE_BD
  });

  return { page, y: y0 - 22 };
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------
function drawSection(
  page: PDFPage, bold: PDFFont, label: string, y: number
): number {
  page.drawText(label.toUpperCase(), {
    x: MX, y, font: bold, size: 7.5, color: BLUE
  });
  page.drawLine({
    start: { x: MX, y: y - 4 }, end: { x: PW - MX, y: y - 4 },
    thickness: 0.4, color: BLUE_BD
  });
  return y - 16;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildGateReviewPdf(input: GateReviewInput): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  const gateFull = GATE_FULL[input.currentGate] ?? input.currentGate;

  // Gate-scoped deliverables
  const gateDels = input.deliverables.filter(d => d.dueBy === input.currentGate);
  const gateDone = gateDels.filter(d => d.checked || d.waived).length;
  const gateTotal = gateDels.length;
  const gateIncomplete = gateDels.filter(d => !d.checked && !d.waived);

  // ── COVER PAGE ─────────────────────────────────────────────────────────────
  const cover = doc.addPage([PW, PH]);

  // Top band
  cover.drawRectangle({ x: 0, y: PH - 130, width: PW, height: 130, color: BLUE });
  cover.drawText('GATE REVIEW REPORT', {
    x: MX, y: PH - 52, font: bold, size: 26, color: WHITE
  });
  cover.drawText(gateFull, {
    x: MX, y: PH - 78, font: reg, size: 13, color: LIGHT_TXT
  });
  cover.drawText('BridgeOps Intelligence', {
    x: MX, y: PH - 102, font: bold, size: 8.5, color: LIGHT_TXT
  });
  // Gate badge in top-right
  const badgeW = 56;
  cover.drawRectangle({
    x: PW - MX - badgeW, y: PH - 102, width: badgeW, height: 36,
    color: WHITE
  });
  const gateW = bold.widthOfTextAtSize(input.currentGate, 22);
  cover.drawText(input.currentGate, {
    x: PW - MX - badgeW / 2 - gateW / 2,
    y: PH - 92,
    font: bold, size: 22, color: BLUE
  });

  // Project block
  cover.drawText('PROJECT', { x: MX, y: PH - 172, font: bold, size: 7.5, color: MID });
  const pnLines = wrapText(input.projectName || 'Unnamed Project', CW, bold, 20);
  cover.drawText(pnLines[0] ?? '', { x: MX, y: PH - 190, font: bold, size: 20, color: DARK });

  cover.drawText('REPORT DATE', { x: MX, y: PH - 226, font: bold, size: 7.5, color: MID });
  cover.drawText(fmtDate(input.reportDate), { x: MX, y: PH - 242, font: reg, size: 12, color: DARK });

  if (input.assignees?.trim()) {
    cover.drawText('TEAM', { x: MX + 200, y: PH - 226, font: bold, size: 7.5, color: MID });
    const aLines = wrapText(input.assignees.trim(), CW - 200, reg, 9);
    let ay = PH - 242;
    for (const line of aLines.slice(0, 4)) {
      cover.drawText(line, { x: MX + 200, y: ay, font: reg, size: 9, color: DARK });
      ay -= 12;
    }
  }

  // Stats box
  const statY = PH - 330;
  const bandColor = scoreBandColor(input.overall);
  const bandLabel = scoreBandLabel(input.overall);

  cover.drawRectangle({
    x: MX, y: statY - 16, width: CW, height: 78,
    color: BLUE_LT, borderColor: BLUE_BD, borderWidth: 1
  });

  // Overall score
  const scoreStr = `${input.overall}%`;
  const scoreW = bold.widthOfTextAtSize(scoreStr, 36);
  cover.drawText(scoreStr, {
    x: MX + 20, y: statY + 32, font: bold, size: 36, color: bandColor
  });
  cover.drawText('OVERALL READINESS', {
    x: MX + 20, y: statY + 14, font: bold, size: 7.5, color: MID
  });
  cover.drawText(bandLabel, {
    x: MX + 20, y: statY + 3, font: bold, size: 8, color: bandColor
  });

  // Divider
  cover.drawLine({
    start: { x: MX + 140, y: statY + 48 },
    end:   { x: MX + 140, y: statY - 10 },
    thickness: 0.5, color: BLUE_BD
  });

  // Gate deliverables stat
  const delPct = gateTotal > 0 ? Math.round((gateDone / gateTotal) * 100) : 0;
  const delStr = `${gateDone}/${gateTotal}`;
  const delW = bold.widthOfTextAtSize(delStr, 26);
  cover.drawText(delStr, {
    x: MX + 160, y: statY + 28, font: bold, size: 26,
    color: delPct === 100 ? EMERALD : delPct >= 70 ? AMBER : ROSE
  });
  cover.drawText('GATE DELIVERABLES', {
    x: MX + 160, y: statY + 12, font: bold, size: 7.5, color: MID
  });
  cover.drawText(`${delPct}% complete at ${input.currentGate}`, {
    x: MX + 160, y: statY + 1, font: reg, size: 8, color: MID
  });

  // Divider
  cover.drawLine({
    start: { x: MX + 310, y: statY + 48 },
    end:   { x: MX + 310, y: statY - 10 },
    thickness: 0.5, color: BLUE_BD
  });

  // Gaps stat
  const gapsStr = String(gateIncomplete.length);
  cover.drawText(gapsStr, {
    x: MX + 330, y: statY + 28, font: bold, size: 26,
    color: gateIncomplete.length === 0 ? EMERALD : ROSE
  });
  cover.drawText('OPEN ITEMS AT GATE', {
    x: MX + 330, y: statY + 12, font: bold, size: 7.5, color: MID
  });
  cover.drawText(gateIncomplete.length === 0 ? 'All items closed' : 'Not yet complete', {
    x: MX + 330, y: statY + 1, font: reg, size: 8, color: MID
  });

  // Footer note
  cover.drawText(
    'This report was generated by BridgeOps Intelligence and represents a point-in-time snapshot for gate readiness review.',
    { x: MX, y: 52, font: reg, size: 7.5, color: rgb(0.65, 0.65, 0.65) }
  );
  cover.drawText(`Gate: ${gateFull}  ·  Generated: ${fmtDate(input.reportDate)}`, {
    x: MX, y: 40, font: reg, size: 7.5, color: rgb(0.65, 0.65, 0.65)
  });

  // ── PAGE 2: RAMP READINESS ─────────────────────────────────────────────────
  {
    const { page, y: y0 } = addPage(doc, bold, reg, input.projectName, input.currentGate);
    let y = y0;

    y = drawSection(page, bold, 'RAMP Readiness', y);

    // Overall bar
    page.drawText('OVERALL', { x: MX, y, font: bold, size: 8, color: MID });
    page.drawText(`${input.overall}%`, {
      x: PW - MX - bold.widthOfTextAtSize(`${input.overall}%`, 10),
      y, font: bold, size: 10, color: scoreBandColor(input.overall)
    });
    y -= 13;
    page.drawRectangle({ x: MX, y: y - 2, width: CW, height: 7, color: BLUE_BD });
    page.drawRectangle({
      x: MX, y: y - 2,
      width: Math.round(CW * input.overall / 100), height: 7,
      color: scoreBandColor(input.overall)
    });
    y -= 20;

    // Per-group rows
    for (const g of input.groupScores) {
      if (y < 120) break;
      const shortTitle = g.title.replace(' Readiness', '').replace(' & ', '/');
      page.drawText(shortTitle, { x: MX, y, font: reg, size: 8.5, color: DARK });
      page.drawText(`${g.score}%`, {
        x: PW - MX - bold.widthOfTextAtSize(`${g.score}%`, 8.5),
        y, font: bold, size: 8.5, color: scoreBandColor(g.score)
      });
      y -= 12;
      const barBg = BLUE_LT;
      page.drawRectangle({ x: MX, y: y - 2, width: CW, height: 5, color: barBg });
      page.drawRectangle({
        x: MX, y: y - 2,
        width: Math.round(CW * g.score / 100), height: 5,
        color: scoreBandColor(g.score)
      });
      y -= 16;
    }

    y -= 8;
    y = drawSection(page, bold, `Gate ${input.currentGate} Deliverables`, y);

    // Summary line
    const delSummary = `${gateDone} of ${gateTotal} deliverables complete or waived at ${input.currentGate}`;
    page.drawText(delSummary, { x: MX, y, font: reg, size: 9, color: DARK });
    y -= 18;

    // Open items list
    if (gateIncomplete.length > 0) {
      page.drawText('OPEN (not yet done)', { x: MX, y, font: bold, size: 7.5, color: ROSE });
      y -= 13;

      for (const d of gateIncomplete.slice(0, 20)) {
        if (y < 80) break;
        page.drawRectangle({ x: MX, y: y - 1, width: 4, height: 4, color: ROSE });
        const lines = wrapText(d.title, CW - 14, reg, 8.5);
        page.drawText(lines[0] ?? '', { x: MX + 10, y, font: reg, size: 8.5, color: DARK });
        y -= 13;
      }
      if (gateIncomplete.length > 20) {
        page.drawText(`… and ${gateIncomplete.length - 20} more open items`, {
          x: MX + 10, y, font: reg, size: 8, color: MID
        });
        y -= 13;
      }
    } else {
      page.drawRectangle({
        x: MX, y: y - 14, width: CW, height: 26,
        color: GREEN_LT, borderColor: EMERALD, borderWidth: 0.5
      });
      page.drawText('✓  All deliverables at this gate are complete or waived', {
        x: MX + 10, y, font: bold, size: 9, color: EMERALD
      });
      y -= 30;
    }
  }

  // ── PAGE 3: PROGRAM HEALTH ─────────────────────────────────────────────────
  if (input.statusSnapshot || (input.risks?.length ?? 0) > 0 || (input.topActions?.length ?? 0) > 0) {
    const { page, y: y0 } = addPage(doc, bold, reg, input.projectName, input.currentGate);
    let y = y0;

    y = drawSection(page, bold, 'Program Health', y);

    // AI analysis freshness note
    if (input.analyzedAtMs) {
      const diffDays = Math.floor((Date.now() - input.analyzedAtMs) / 86400000);
      const freshness = diffDays === 0 ? 'today' : diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
      page.drawText(`Based on AI full-project scan from ${freshness} (${fmtMs(input.analyzedAtMs)})`, {
        x: MX, y, font: reg, size: 7.5, color: MID
      });
      y -= 14;
    } else {
      page.drawText('No AI scan recorded — run AI Analysis in the project to populate this section.', {
        x: MX, y, font: reg, size: 7.5, color: AMBER
      });
      y -= 14;
    }

    // Status snapshot callout
    if (input.statusSnapshot) {
      page.drawRectangle({
        x: MX, y: y - 20, width: CW, height: 32,
        color: BLUE_LT, borderColor: BLUE_BD, borderWidth: 1
      });
      page.drawText('STATUS', { x: MX + 10, y: y + 2, font: bold, size: 7, color: BLUE });
      const snapLines = wrapText(input.statusSnapshot, CW - 20, reg, 9.5);
      page.drawText(snapLines[0] ?? '', { x: MX + 10, y: y - 10, font: reg, size: 9.5, color: DARK });
      y -= 38;
    }

    y -= 4;

    // Risks
    if (input.risks && input.risks.length > 0) {
      y = drawSection(page, bold, 'Key Risks', y);

      const sev = { high: ROSE, medium: AMBER, low: EMERALD };
      const sevBg = { high: ROSE_LT, medium: AMBER_LT, low: GREEN_LT };

      for (const r of input.risks.slice(0, 8)) {
        if (y < 80) break;
        const sevLabel = r.severity.toUpperCase();
        const sevW = bold.widthOfTextAtSize(sevLabel, 7);
        page.drawRectangle({
          x: MX, y: y - 12, width: sevW + 10, height: 15,
          color: sevBg[r.severity] ?? BLUE_LT
        });
        page.drawText(sevLabel, {
          x: MX + 5, y: y - 8,
          font: bold, size: 7, color: sev[r.severity] ?? BLUE
        });
        const flagLines = wrapText(r.flag, CW - sevW - 20, reg, 8.5);
        page.drawText(flagLines[0] ?? '', {
          x: MX + sevW + 16, y: y - 7,
          font: reg, size: 8.5, color: DARK
        });
        if (r.source) {
          page.drawText(r.source, {
            x: MX + sevW + 16, y: y - 18,
            font: reg, size: 7, color: MID
          });
          y -= 26;
        } else {
          y -= 20;
        }
      }
      y -= 4;
    }

    // Top Actions
    if (input.topActions && input.topActions.length > 0) {
      y = drawSection(page, bold, 'Top Actions', y);

      for (let i = 0; i < Math.min(input.topActions.length, 5); i++) {
        if (y < 80) break;
        const a = input.topActions[i];
        page.drawText(`${i + 1}.`, { x: MX, y, font: bold, size: 9, color: BLUE });
        const titleLines = wrapText(a.title, CW - 16, bold, 9);
        page.drawText(titleLines[0] ?? '', { x: MX + 14, y, font: bold, size: 9, color: DARK });
        y -= 12;
        if (a.rationale) {
          const ratLines = wrapText(a.rationale, CW - 16, reg, 8);
          for (const line of ratLines.slice(0, 2)) {
            if (y < 80) break;
            page.drawText(line, { x: MX + 14, y, font: reg, size: 8, color: MID });
            y -= 11;
          }
        }
        y -= 6;
      }
    }
  }

  // ── PAGE 4: TOOL SIGNALS ───────────────────────────────────────────────────
  const hasSignals = input.taktCapacity ||
    input.decisionActive !== undefined ||
    input.budgetEstimate !== undefined;

  if (hasSignals) {
    const { page, y: y0 } = addPage(doc, bold, reg, input.projectName, input.currentGate);
    let y = y0;

    y = drawSection(page, bold, 'Tool Signals', y);
    page.drawText('Snapshot from the most recent data captured in each project tool.', {
      x: MX, y, font: reg, size: 7.5, color: MID
    });
    y -= 18;

    const drawSignalRow = (
      label: string, value: string, subtext: string,
      valueColor: ReturnType<typeof rgb>
    ) => {
      if (y < 80) return;
      page.drawRectangle({
        x: MX, y: y - 24, width: CW, height: 32,
        color: BLUE_LT, borderColor: BLUE_BD, borderWidth: 0.5
      });
      page.drawText(label, { x: MX + 10, y: y + 1, font: bold, size: 7.5, color: MID });
      page.drawText(value, { x: MX + 10, y: y - 11, font: bold, size: 11, color: valueColor });
      if (subtext) {
        page.drawText(subtext, {
          x: MX + 10 + bold.widthOfTextAtSize(value, 11) + 8,
          y: y - 9, font: reg, size: 8, color: MID
        });
      }
      y -= 42;
    };

    // Takt / Capacity
    if (input.taktCapacity) {
      const capLabel = input.taktCapacity === 'green' ? 'GREEN — On Track'
        : input.taktCapacity === 'yellow' ? 'AMBER — At Risk' : 'RED — Bottleneck';
      const capColor = input.taktCapacity === 'green' ? EMERALD
        : input.taktCapacity === 'yellow' ? AMBER : ROSE;
      const sub = [
        input.taktStudyName ? `Study: ${input.taktStudyName}` : '',
        input.taktSec ? `Takt ${input.taktSec.toFixed(1)}s` : '',
        input.bottleneckSec ? `Bottleneck ${input.bottleneckSec.toFixed(1)}s` : ''
      ].filter(Boolean).join('  ·  ');
      drawSignalRow('TAKT / CAPACITY', capLabel, sub, capColor);
    }

    // Decisions
    if (input.decisionActive !== undefined) {
      const decStr = `${input.decisionActive} active`;
      const decSub = input.decisionReversed
        ? `${input.decisionReversed} reversed (design churn signal)` : '';
      const decColor = (input.decisionReversed ?? 0) > 0 ? ROSE : EMERALD;
      drawSignalRow('DECISION LEDGER', decStr, decSub, decColor);
    }

    // Budget
    if (input.budgetEstimate !== undefined && input.budgetActual !== undefined) {
      const variance = input.budgetEstimate > 0
        ? Math.round(((input.budgetActual - input.budgetEstimate) / input.budgetEstimate) * 100)
        : 0;
      const budStr = variance >= 0 ? `+${variance}% over plan` : `${Math.abs(variance)}% under plan`;
      const budSub = `Estimate ${currency(input.budgetEstimate)}  ·  Actual ${currency(input.budgetActual)}`;
      const budColor = variance > 20 ? ROSE : variance > 5 ? AMBER : EMERALD;
      drawSignalRow('BUDGET', budStr, budSub, budColor);
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Browser download helper (mirrors downloadDecisionRegisterPdf)
// ---------------------------------------------------------------------------

export async function downloadGateReviewPdf(input: GateReviewInput): Promise<void> {
  if (typeof window === 'undefined') return;
  const bytes = await buildGateReviewPdf(input);
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  const safeName = input.projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
  a.href     = url;
  a.download = `${safeName}__gate_${input.currentGate}_review.pdf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
