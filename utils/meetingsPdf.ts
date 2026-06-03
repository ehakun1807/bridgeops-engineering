// ---------------------------------------------------------------------------
// meetingsPdf.ts — build a formatted "Meeting Minutes" PDF for export from
// MeetingsTool. Layout: cover page + one section per meeting.
//
// Uses pdf-lib (already a project dependency via Doc Guard + Decision Ledger).
// Mirrors the decisionRegisterPdf.ts pattern.
// ---------------------------------------------------------------------------

import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Public shape — decoupled from Firestore / React imports.
// ---------------------------------------------------------------------------

export interface MeetingForPdf {
  id: string;
  dateMs: number;
  title: string;
  attendees: string;
  kind: 'internal' | 'external';
  notes: string;
  actionItems: string;
}

// ---------------------------------------------------------------------------
// Layout constants (US Letter — 612 × 792 pt)
// ---------------------------------------------------------------------------
const PW = 612;
const PH = 792;
const MX = 52;
const CW = PW - 2 * MX;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
const SLATE     = rgb(0.25, 0.33, 0.44);
const SLATE_LT  = rgb(0.94, 0.96, 0.98);
const SLATE_BD  = rgb(0.80, 0.85, 0.90);
const DARK      = rgb(0.10, 0.12, 0.15);
const MID       = rgb(0.42, 0.48, 0.55);
const LIGHT     = rgb(0.75, 0.82, 0.90);
const WHITE     = rgb(1, 1, 1);
const AMBER     = rgb(0.87, 0.56, 0.04);
const AMBER_LT  = rgb(1.00, 0.96, 0.86);
const EMERALD   = rgb(0.05, 0.50, 0.32);
const EMERALD_LT = rgb(0.88, 0.97, 0.93);

// ---------------------------------------------------------------------------
// Text helpers
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

function fmtDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

// ---------------------------------------------------------------------------
// Page factory — adds running header to each content page
// ---------------------------------------------------------------------------

function addContentPage(
  doc: PDFDocument,
  bold: PDFFont,
  reg: PDFFont,
  projectName: string
): { page: PDFPage; y: number } {
  const page = doc.addPage([PW, PH]);
  const y0 = PH - MX;

  page.drawText('MEETING MINUTES', {
    x: MX, y: y0, font: bold, size: 7.5, color: SLATE
  });
  const pn = projectName.slice(0, 55);
  page.drawText(pn, {
    x: PW - MX - reg.widthOfTextAtSize(pn, 7.5),
    y: y0, font: reg, size: 7.5, color: MID
  });
  page.drawLine({
    start: { x: MX, y: y0 - 6 },
    end: { x: PW - MX, y: y0 - 6 },
    thickness: 0.4, color: SLATE_BD
  });
  return { page, y: y0 - 22 };
}

// ---------------------------------------------------------------------------
// Draw a labelled section block (e.g. "DISCUSSION NOTES")
// Returns the y position after the block.
// ---------------------------------------------------------------------------

function drawSection(
  page: PDFPage,
  bold: PDFFont,
  reg: PDFFont,
  label: string,
  text: string,
  y: number
): number {
  if (!text.trim()) return y;
  page.drawText(label, { x: MX, y, font: bold, size: 7, color: MID });
  y -= 11;
  const lines = wrapText(text, CW, reg, 9);
  for (const line of lines) {
    if (y < 60) break; // safety — caller should check and add a new page before calling
    page.drawText(line, { x: MX, y, font: reg, size: 9, color: DARK });
    y -= 13;
  }
  return y - 6;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildMeetingsPdf(
  meetings: MeetingForPdf[],
  projectName: string
): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  // ── Cover page ────────────────────────────────────────────────────────────
  const cover = doc.addPage([PW, PH]);
  cover.drawRectangle({ x: 0, y: PH - 116, width: PW, height: 116, color: SLATE });
  cover.drawText('MEETING MINUTES', { x: MX, y: PH - 54, font: bold, size: 28, color: WHITE });
  cover.drawText('Project meeting log — engineering record', {
    x: MX, y: PH - 78, font: reg, size: 11, color: LIGHT
  });
  cover.drawText('BridgeOps Intelligence', { x: MX, y: PH - 98, font: bold, size: 9, color: LIGHT });

  cover.drawText('PROJECT', { x: MX, y: PH - 160, font: bold, size: 8, color: MID });
  cover.drawText(projectName || 'Unnamed Project', {
    x: MX, y: PH - 178, font: bold, size: 18, color: DARK
  });
  cover.drawText('EXPORTED', { x: MX, y: PH - 214, font: bold, size: 8, color: MID });
  cover.drawText(
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    { x: MX, y: PH - 230, font: reg, size: 12, color: DARK }
  );

  // Summary stats box
  const internal = meetings.filter(m => m.kind === 'internal').length;
  const external = meetings.filter(m => m.kind === 'external').length;
  const hasActions = meetings.filter(m => m.actionItems.trim()).length;
  const BOX_Y = PH - 316;
  cover.drawRectangle({ x: MX, y: BOX_Y, width: CW, height: 72, color: SLATE_LT });
  cover.drawRectangle({ x: MX, y: BOX_Y, width: CW, height: 72, borderColor: SLATE_BD, borderWidth: 0.5 });

  const stats = [
    { label: 'TOTAL', val: String(meetings.length) },
    { label: 'INTERNAL', val: String(internal) },
    { label: 'EXTERNAL', val: String(external) },
    { label: 'WITH ACTIONS', val: String(hasActions) }
  ];
  const cellW = CW / stats.length;
  stats.forEach((s, i) => {
    const cx = MX + i * cellW + cellW / 2;
    cover.drawText(s.val, {
      x: cx - bold.widthOfTextAtSize(s.val, 22) / 2,
      y: BOX_Y + 36, font: bold, size: 22, color: SLATE
    });
    cover.drawText(s.label, {
      x: cx - reg.widthOfTextAtSize(s.label, 7) / 2,
      y: BOX_Y + 16, font: bold, size: 7, color: MID
    });
  });

  // ── Meeting entries ───────────────────────────────────────────────────────
  // Sort meetings by date desc (most recent first, matching the list-view order)
  const sorted = [...meetings].sort((a, b) => b.dateMs - a.dateMs);

  let { page, y } = addContentPage(doc, bold, reg, projectName);

  for (let mi = 0; mi < sorted.length; mi++) {
    const m = sorted[mi];

    // Ensure enough room to start a meeting block; if not, new page.
    if (y < 200) {
      ({ page, y } = addContentPage(doc, bold, reg, projectName));
    }

    // ── Meeting header bar ──────────────────────────────────────────────────
    const kindBg   = m.kind === 'external' ? AMBER_LT  : EMERALD_LT;
    const kindText = m.kind === 'external' ? AMBER      : EMERALD;
    const kindLabel = m.kind === 'external' ? 'EXTERNAL' : 'INTERNAL';

    page.drawRectangle({ x: MX, y: y - 30, width: CW, height: 34, color: SLATE_LT });
    page.drawRectangle({ x: MX, y: y - 30, width: CW, height: 34, borderColor: SLATE_BD, borderWidth: 0.5 });

    // Index
    const idxStr = `#${mi + 1}`;
    page.drawText(idxStr, { x: MX + 8, y: y - 10, font: bold, size: 9, color: MID });

    // Kind chip
    const chipW = bold.widthOfTextAtSize(kindLabel, 7) + 10;
    page.drawRectangle({ x: MX + 30, y: y - 18, width: chipW, height: 14, color: kindBg });
    page.drawText(kindLabel, { x: MX + 35, y: y - 14, font: bold, size: 7, color: kindText });

    // Title (truncated to fit)
    const titleX = MX + 30 + chipW + 8;
    const titleMaxW = CW - 30 - chipW - 8 - 70;
    let titleStr = m.title;
    while (titleStr.length > 4 && bold.widthOfTextAtSize(titleStr, 10) > titleMaxW) {
      titleStr = titleStr.slice(0, -2);
    }
    if (titleStr !== m.title) titleStr += '…';
    page.drawText(titleStr, { x: titleX, y: y - 10, font: bold, size: 10, color: DARK });

    // Date (right-aligned)
    const dateStr = fmtDate(m.dateMs);
    page.drawText(dateStr, {
      x: PW - MX - reg.widthOfTextAtSize(dateStr, 8) - 4,
      y: y - 10, font: reg, size: 8, color: MID
    });

    y -= 38;

    // ── Attendees ─────────────────────────────────────────────────────────
    if (m.attendees.trim()) {
      page.drawText('ATTENDEES', { x: MX, y, font: bold, size: 7, color: MID });
      y -= 11;
      const attLines = wrapText(m.attendees, CW, reg, 9);
      for (const line of attLines) {
        if (y < 60) break;
        page.drawText(line, { x: MX, y, font: reg, size: 9, color: DARK });
        y -= 13;
      }
      y -= 6;
    }

    // ── Discussion notes ─────────────────────────────────────────────────
    if (m.notes.trim()) {
      // Check if we need a new page mid-meeting
      if (y < 120) {
        ({ page, y } = addContentPage(doc, bold, reg, projectName));
      }
      y = drawSection(page, bold, reg, 'DISCUSSION NOTES', m.notes, y);
    }

    // ── Action items ─────────────────────────────────────────────────────
    if (m.actionItems.trim()) {
      if (y < 120) {
        ({ page, y } = addContentPage(doc, bold, reg, projectName));
      }
      y = drawSection(page, bold, reg, 'ACTION ITEMS', m.actionItems, y);
    }

    // Divider between meetings
    if (mi < sorted.length - 1) {
      if (y < 60) {
        ({ page, y } = addContentPage(doc, bold, reg, projectName));
      } else {
        page.drawLine({
          start: { x: MX, y: y - 8 },
          end: { x: PW - MX, y: y - 8 },
          thickness: 0.3, color: SLATE_BD
        });
        y -= 24;
      }
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Browser download helper
// ---------------------------------------------------------------------------

export async function downloadMeetingsPdf(
  meetings: MeetingForPdf[],
  projectName: string
): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const bytes = await buildMeetingsPdf(meetings, projectName);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = (projectName || 'project')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.download = `Meetings_${slug}_${dateTag}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
