// ---------------------------------------------------------------------------
// decisionRegisterPdf.ts — builds a formatted PDF "Decision Register" for
// export from the Decision Ledger tool. Output is a Uint8Array suitable for
// browser download. Layout: cover page + numbered decision entries.
//
// Uses pdf-lib (already a project dependency via Doc Guard).
// ---------------------------------------------------------------------------

import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Public shape — decoupled from the Firestore model so this helper stays
// importable without pulling in firebase.
// ---------------------------------------------------------------------------

export interface DecisionForPdf {
  id: string;
  dateMs: number;
  title: string;
  decisionMaker: string;
  category: string;
  gate?: string;
  description: string;
  rationale: string;
  relatedRisks: string;
  impact: string;
  status: 'active' | 'superseded' | 'reversed';
}

// ---------------------------------------------------------------------------
// Layout constants (US Letter — 612 × 792 pt)
// ---------------------------------------------------------------------------
const PW = 612;
const PH = 792;
const MX = 52;          // horizontal margin
const CW = PW - 2 * MX; // content width

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Wrap `text` into lines no wider than `maxW` at `fontSize`. */
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

function fmtDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

function statusLabel(s: string): string {
  return s === 'superseded' ? 'SUPERSEDED' : s === 'reversed' ? 'REVERSED' : 'ACTIVE';
}

function categoryLabel(c: string): string {
  const m: Record<string, string> = {
    design: 'Design', process: 'Process', supplier: 'Supplier',
    regulatory: 'Regulatory', commercial: 'Commercial', other: 'Other'
  };
  return m[c] ?? c;
}

// ---------------------------------------------------------------------------
// RGB shorthands
// ---------------------------------------------------------------------------
const INDIGO    = rgb(0.24, 0.22, 0.78);
const INDIGO_LT = rgb(0.96, 0.95, 1.00);
const INDIGO_BD = rgb(0.82, 0.80, 0.96);
const DARK      = rgb(0.12, 0.12, 0.12);
const MID       = rgb(0.45, 0.45, 0.45);
const LIGHT     = rgb(0.80, 0.78, 0.95);
const WHITE     = rgb(1, 1, 1);

const STATUS_STYLE: Record<string, { bg: ReturnType<typeof rgb>; text: ReturnType<typeof rgb> }> = {
  active:     { bg: rgb(0.90, 0.97, 0.94), text: rgb(0.05, 0.50, 0.30) },
  superseded: { bg: rgb(0.99, 0.95, 0.88), text: rgb(0.65, 0.42, 0.02) },
  reversed:   { bg: rgb(0.99, 0.92, 0.92), text: rgb(0.75, 0.15, 0.15) }
};

// ---------------------------------------------------------------------------
// Page factory + header
// ---------------------------------------------------------------------------

function addContentPage(
  doc: PDFDocument,
  bold: PDFFont,
  reg: PDFFont,
  projectName: string
): { page: PDFPage; y: number } {
  const page = doc.addPage([PW, PH]);
  const y0 = PH - MX;

  page.drawText('DECISION REGISTER', {
    x: MX, y: y0, font: bold, size: 7.5, color: INDIGO
  });
  const pn = projectName.slice(0, 50);
  page.drawText(pn, {
    x: PW - MX - reg.widthOfTextAtSize(pn, 7.5),
    y: y0, font: reg, size: 7.5, color: MID
  });
  page.drawLine({
    start: { x: MX, y: y0 - 6 },
    end: { x: PW - MX, y: y0 - 6 },
    thickness: 0.4, color: INDIGO_BD
  });
  return { page, y: y0 - 22 };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildDecisionRegisterPdf(
  decisions: DecisionForPdf[],
  projectName: string
): Promise<Uint8Array> {
  const doc   = await PDFDocument.create();
  const bold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg   = await doc.embedFont(StandardFonts.Helvetica);

  // ── Cover page ─────────────────────────────────────────────────────────
  const cover = doc.addPage([PW, PH]);

  // top band
  cover.drawRectangle({ x: 0, y: PH - 116, width: PW, height: 116, color: INDIGO });
  cover.drawText('DECISION REGISTER', { x: MX, y: PH - 54, font: bold, size: 28, color: WHITE });
  cover.drawText('Engineering decision log — project record', {
    x: MX, y: PH - 78, font: reg, size: 11, color: LIGHT
  });
  cover.drawText('BridgeOps', { x: MX, y: PH - 98, font: bold, size: 9, color: LIGHT });

  // project block
  cover.drawText('PROJECT', { x: MX, y: PH - 160, font: bold, size: 8, color: MID });
  cover.drawText(projectName || 'Unnamed Project', {
    x: MX, y: PH - 178, font: bold, size: 18, color: DARK
  });
  cover.drawText('EXPORTED', { x: MX, y: PH - 214, font: bold, size: 8, color: MID });
  cover.drawText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: MX, y: PH - 230, font: reg, size: 12, color: DARK
  });

  // summary stats box
  const statY = PH - 300;
  const active     = decisions.filter(d => d.status === 'active').length;
  const superseded = decisions.filter(d => d.status === 'superseded').length;
  const reversed   = decisions.filter(d => d.status === 'reversed').length;

  cover.drawRectangle({
    x: MX, y: statY - 16, width: CW, height: 68,
    color: INDIGO_LT, borderColor: INDIGO_BD, borderWidth: 1
  });

  const stats = [
    { label: 'Total Decisions', val: String(decisions.length), color: INDIGO },
    { label: 'Active',          val: String(active),            color: rgb(0.05, 0.48, 0.28) },
    { label: 'Superseded',      val: String(superseded),        color: rgb(0.65, 0.42, 0.02) },
    { label: 'Reversed',        val: String(reversed),          color: rgb(0.72, 0.12, 0.12) }
  ];
  const cw = CW / stats.length;
  stats.forEach((s, i) => {
    const cx = MX + i * cw + cw / 2;
    const vw = bold.widthOfTextAtSize(s.val, 24);
    const lw = reg.widthOfTextAtSize(s.label, 8);
    cover.drawText(s.val,   { x: cx - vw / 2, y: statY + 24, font: bold, size: 24, color: s.color });
    cover.drawText(s.label, { x: cx - lw / 2, y: statY + 8,  font: reg,  size: 8,  color: MID });
  });

  // footer note
  cover.drawText(
    'This register was exported from BridgeOps and represents a point-in-time snapshot for engineering records (DHF, design history, compliance audits).',
    { x: MX, y: 60, font: reg, size: 7.5, color: rgb(0.65, 0.65, 0.65) }
  );
  cover.drawText('Decisions are listed most-recent first. Reversed and superseded decisions are retained for traceability.', {
    x: MX, y: 48, font: reg, size: 7.5, color: rgb(0.65, 0.65, 0.65)
  });

  // ── Decision entry pages ────────────────────────────────────────────────
  const sorted = [...decisions].sort((a, b) => b.dateMs - a.dateMs);

  let page: PDFPage | null = null;
  let y = 0;

  const needPage = () => {
    if (!page || y < MX + 100) {
      const np = addContentPage(doc, bold, reg, projectName);
      page = np.page;
      y    = np.y;
    }
  };

  for (let i = 0; i < sorted.length; i++) {
    const d  = sorted[i];
    const idx = sorted.length - i; // highest number = most recent
    needPage();

    // ── Entry header bar
    const hY = y;
    page!.drawRectangle({ x: MX, y: hY - 19, width: CW, height: 22, color: INDIGO });

    // Title (truncated to fit, leaving room for status badge)
    const titleText = `#${idx}  ${d.title}`;
    const titleLines = wrapText(titleText, CW - 85, bold, 9);
    page!.drawText(titleLines[0] ?? '', {
      x: MX + 8, y: hY - 12, font: bold, size: 9, color: WHITE
    });

    // Status badge
    const sl  = statusLabel(d.status);
    const sst = STATUS_STYLE[d.status] ?? STATUS_STYLE.active;
    const slW = bold.widthOfTextAtSize(sl, 7);
    page!.drawRectangle({
      x: PW - MX - slW - 12, y: hY - 16,
      width: slW + 12, height: 13,
      color: sst.bg
    });
    page!.drawText(sl, {
      x: PW - MX - slW - 6, y: hY - 12,
      font: bold, size: 7, color: sst.text
    });

    y = hY - 22;

    // ── Meta row (date | by | gate | category)
    const meta = [
      `Date: ${fmtDate(d.dateMs)}`,
      d.decisionMaker ? `By: ${d.decisionMaker}` : null,
      d.gate           ? `Gate: ${d.gate}`         : null,
      `Category: ${categoryLabel(d.category)}`
    ].filter(Boolean).join('   ·   ');

    page!.drawText(meta, {
      x: MX + 8, y: y - 11,
      font: reg, size: 8, color: MID, maxWidth: CW - 12
    });
    y -= 24;

    // ── Field renderer
    const renderField = (label: string, text: string) => {
      if (!text || !text.trim()) return;
      needPage();
      page!.drawText(label, {
        x: MX + 8, y, font: bold, size: 7.5, color: INDIGO
      });
      y -= 13;

      const lines = wrapText(text, CW - 18, reg, 9);
      for (const line of lines) {
        if (y < MX + 30) needPage();
        page!.drawText(line, { x: MX + 8, y, font: reg, size: 9, color: DARK });
        y -= 12;
      }
      y -= 5;
    };

    renderField('WHAT WAS DECIDED', d.description);
    renderField('RATIONALE (WHY)',   d.rationale);
    renderField('RELATED RISKS',     d.relatedRisks);
    renderField('POTENTIAL IMPACT',  d.impact);

    // Separator
    y -= 4;
    if (y > MX + 20) {
      page!.drawLine({
        start: { x: MX,        y },
        end:   { x: PW - MX,   y },
        thickness: 0.3, color: INDIGO_BD
      });
    }
    y -= 14;
  }

  return doc.save();
}
