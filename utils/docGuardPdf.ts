// ---------------------------------------------------------------------------
// DocGuard PDF annotation overlay.
//
// Takes the original PDF bytes + findings array and returns new PDF bytes
// with:
//   - Each annotated page widened by ~160pt on the right side; the sidebar
//     lists the page's findings (severity-color dot + short comment).
//     We never draw over original content — we extend the canvas.
//   - A summary page appended at the end with verdict + all findings.
//
// Pure function: takes bytes, returns bytes. No DOM, no React.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import {
  wrapText,
  groupByPage,
  sortFindingsForSummary,
  type Finding,
  type FindingCategory,
  type FindingSeverity,
  type AuditSummary
} from './docGuardPdfHelpers.ts';

export {
  wrapText,
  groupByPage,
  sortFindingsForSummary,
  type Finding,
  type FindingCategory,
  type FindingSeverity,
  type AuditSummary
};

const SIDEBAR_WIDTH = 170;
const SIDEBAR_PAD = 10;
const HEADER_FONT_SIZE = 9;
const NOTE_FONT_SIZE = 8;
const LINE_GAP = 2;

const SEVERITY_COLOR: Record<FindingSeverity, [number, number, number]> = {
  high: [0.86, 0.2, 0.2], // red
  medium: [0.95, 0.62, 0.07], // amber
  low: [0.4, 0.45, 0.55] // slate
};

const VERDICT_COLOR: Record<AuditSummary['overallVerdict'], [number, number, number]> = {
  pass: [0.13, 0.6, 0.34],
  minor_issues: [0.95, 0.62, 0.07],
  major_issues: [0.86, 0.2, 0.2]
};

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  grammar: 'GRAM',
  gmp: 'GMP',
  logic: 'LOGIC',
  image: 'IMAGE',
  numbering: 'NUM'
};

function drawSidebar(
  page: PDFPage,
  findings: Finding[],
  helv: PDFFont,
  helvBold: PDFFont,
  pageNum: number
) {
  const { width: origW, height } = page.getSize();
  // Grow canvas to make room for sidebar — content stays anchored bottom-left.
  page.setSize(origW + SIDEBAR_WIDTH, height);

  const sidebarX = origW;
  const innerX = sidebarX + SIDEBAR_PAD;
  const innerW = SIDEBAR_WIDTH - SIDEBAR_PAD * 2;
  let cursorY = height - SIDEBAR_PAD - HEADER_FONT_SIZE;

  // Faint background fill so the sidebar reads as a separate region.
  page.drawRectangle({
    x: sidebarX,
    y: 0,
    width: SIDEBAR_WIDTH,
    height,
    color: rgb(0.98, 0.98, 0.96)
  });
  // Hairline divider.
  page.drawRectangle({
    x: sidebarX,
    y: 0,
    width: 0.5,
    height,
    color: rgb(0.8, 0.8, 0.8)
  });

  // Header.
  page.drawText(`DocGuard — Page ${pageNum}`, {
    x: innerX,
    y: cursorY,
    size: HEADER_FONT_SIZE,
    font: helvBold,
    color: rgb(0.06, 0.09, 0.16)
  });
  cursorY -= HEADER_FONT_SIZE + 6;

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const [r, g, b] = SEVERITY_COLOR[f.severity];

    // Severity dot.
    page.drawCircle({
      x: innerX + 3,
      y: cursorY + 3,
      size: 3,
      color: rgb(r, g, b)
    });

    // Numbered category tag.
    const tag = `${i + 1}. ${CATEGORY_LABEL[f.category]}`;
    page.drawText(tag, {
      x: innerX + 10,
      y: cursorY,
      size: NOTE_FONT_SIZE,
      font: helvBold,
      color: rgb(r, g, b)
    });
    cursorY -= NOTE_FONT_SIZE + LINE_GAP;

    // Quote line (italic-ish: render in slate color).
    if (f.quote) {
      const quoteLines = wrapText(`"${f.quote}"`, helv, NOTE_FONT_SIZE, innerW);
      for (const line of quoteLines) {
        if (cursorY < 12) break;
        page.drawText(line, {
          x: innerX,
          y: cursorY,
          size: NOTE_FONT_SIZE,
          font: helv,
          color: rgb(0.45, 0.5, 0.58)
        });
        cursorY -= NOTE_FONT_SIZE + LINE_GAP;
      }
    }

    // Comment lines.
    const commentLines = wrapText(f.comment, helv, NOTE_FONT_SIZE, innerW);
    for (const line of commentLines) {
      if (cursorY < 12) break;
      page.drawText(line, {
        x: innerX,
        y: cursorY,
        size: NOTE_FONT_SIZE,
        font: helv,
        color: rgb(0.06, 0.09, 0.16)
      });
      cursorY -= NOTE_FONT_SIZE + LINE_GAP;
    }
    cursorY -= 6;

    if (cursorY < 12) break; // out of room
  }
}

function appendSummaryPage(
  pdf: PDFDocument,
  findings: Finding[],
  summary: AuditSummary,
  helv: PDFFont,
  helvBold: PDFFont
) {
  // US Letter portrait.
  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 48;
  const innerW = PAGE_W - MARGIN * 2;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // Title.
  page.drawText('DocGuard Audit Summary', {
    x: MARGIN,
    y,
    size: 20,
    font: helvBold,
    color: rgb(0.06, 0.09, 0.16)
  });
  y -= 30;

  // Verdict pill.
  const [vr, vg, vb] = VERDICT_COLOR[summary.overallVerdict];
  const verdictText = summary.overallVerdict.replace('_', ' ').toUpperCase();
  const verdictW = helvBold.widthOfTextAtSize(verdictText, 10) + 16;
  page.drawRectangle({
    x: MARGIN,
    y: y - 4,
    width: verdictW,
    height: 18,
    color: rgb(vr, vg, vb)
  });
  page.drawText(verdictText, {
    x: MARGIN + 8,
    y: y,
    size: 10,
    font: helvBold,
    color: rgb(1, 1, 1)
  });
  y -= 28;

  // Headline.
  if (summary.headline) {
    const headlineLines = wrapText(summary.headline, helv, 11, innerW);
    for (const line of headlineLines) {
      page.drawText(line, {
        x: MARGIN,
        y,
        size: 11,
        font: helv,
        color: rgb(0.25, 0.3, 0.38)
      });
      y -= 14;
    }
    y -= 8;
  }

  // Counts row.
  const counts: Record<FindingSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  const countsLine = `${findings.length} finding${findings.length === 1 ? '' : 's'}  ·  ${counts.high} high  ·  ${counts.medium} medium  ·  ${counts.low} low`;
  page.drawText(countsLine, {
    x: MARGIN,
    y,
    size: 10,
    font: helv,
    color: rgb(0.4, 0.45, 0.55)
  });
  y -= 22;

  // Findings list.
  page.drawText('Findings', {
    x: MARGIN,
    y,
    size: 13,
    font: helvBold,
    color: rgb(0.06, 0.09, 0.16)
  });
  y -= 18;

  const sorted = sortFindingsForSummary(findings);

  for (const f of sorted) {
    const lineHeight = 11;
    const headerH = 13;
    // Estimate space needed; if too close to bottom, add a new page.
    const commentLines = wrapText(f.comment, helv, 10, innerW - 18);
    const blockH = headerH + commentLines.length * lineHeight + 6;
    if (y - blockH < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }

    const [r, g, b] = SEVERITY_COLOR[f.severity];
    page.drawCircle({
      x: MARGIN + 3,
      y: y + 4,
      size: 3,
      color: rgb(r, g, b)
    });
    const header = `Page ${f.page}  ·  ${CATEGORY_LABEL[f.category]}  ·  ${f.severity.toUpperCase()}`;
    page.drawText(header, {
      x: MARGIN + 12,
      y,
      size: 10,
      font: helvBold,
      color: rgb(r, g, b)
    });
    y -= headerH;

    for (const line of commentLines) {
      page.drawText(line, {
        x: MARGIN + 12,
        y,
        size: 10,
        font: helv,
        color: rgb(0.06, 0.09, 0.16)
      });
      y -= lineHeight;
    }
    y -= 6;
  }
}

/**
 * Build an annotated PDF.
 *
 * @param originalBytes raw bytes of the original PDF
 * @param findings array of findings (page is 1-indexed)
 * @param summary audit summary
 * @returns Uint8Array of the new PDF
 */
export async function buildAnnotatedPdf(
  originalBytes: ArrayBuffer | Uint8Array,
  findings: Finding[],
  summary: AuditSummary
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes, {
    // Some PDFs are slightly malformed; let pdf-lib repair instead of throwing.
    ignoreEncryption: true,
    throwOnInvalidObject: false
  });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const grouped = groupByPage(findings);
  const pages = pdf.getPages();

  for (const [pageNum, pageFindings] of grouped.entries()) {
    const idx = pageNum - 1;
    if (idx < 0 || idx >= pages.length) continue; // out of range — skip
    drawSidebar(pages[idx], pageFindings, helv, helvBold, pageNum);
  }

  appendSummaryPage(pdf, findings, summary, helv, helvBold);

  return pdf.save();
}
