// ---------------------------------------------------------------------------
// pfmeaXlsx — convert one or more PFMEA docs into a downloadable xlsx
// workbook with two sheets:
//   Summary  — project / FMEA metadata + aggregate stats
//   Risks    — one row per risk line with all fields + revised scores
//
// Mirrors the taktXlsx.ts pattern: pure module, no React, directly testable.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

// Minimal shapes — decoupled from Firestore / React imports.
export interface PfmeaXlsxRisk {
  processStep: string;
  failureMode: string;
  failureEffect: string;
  severity: number;
  cause: string;
  occurrence: number;
  controls: string;
  detection: number;
  recommendedAction: string;
  responsible: string;
  actionsTaken: string;
  revisedSeverity?: number;
  revisedOccurrence?: number;
  revisedDetection?: number;
}

export interface PfmeaXlsxDoc {
  id?: string;
  title: string;        // process under analysis
  scope: string;
  participants: string;
  dateMs: number;
}

function computeRPN(s: number, o: number, d: number): number {
  return Math.max(0, Math.min(10, s)) * Math.max(0, Math.min(10, o)) * Math.max(0, Math.min(10, d));
}

function rpnTier(rpn: number): string {
  if (rpn > 100) return 'High';
  if (rpn >= 40) return 'Medium';
  return 'Low';
}

function actionPriority(s: number, o: number, d: number): string {
  // Published approximation of the AIAG-VDA 2019 3D AP table.
  if (s >= 9 && o >= 6) return 'H';
  if (s >= 9 && d >= 7) return 'H';
  if (s >= 9) return 'M';
  if (s >= 7 && o >= 6) return 'H';
  if (s >= 7 && d >= 7) return 'H';
  if (s >= 7 && o >= 4) return 'M';
  if (s >= 4 && o >= 7) return 'H';
  if (s >= 4 && o >= 4 && d >= 7) return 'M';
  if (s >= 4 && o >= 4) return 'L';
  return 'L';
}

function fmtDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

export function pfmeasToWorkbook(
  docs: PfmeaXlsxDoc[],
  risks: PfmeaXlsxRisk[][],   // parallel array — risks[i] belongs to docs[i]
  projectName: string
): XLSX.WorkBook {
  // ── Summary sheet ────────────────────────────────────────────────────────
  const allRisks = risks.flat();
  const rpns = allRisks.map(r => computeRPN(r.severity, r.occurrence, r.detection));
  const maxRpn = rpns.length ? Math.max(...rpns) : 0;
  const meanRpn = rpns.length ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0;
  const highCount   = rpns.filter(r => r > 100).length;
  const mediumCount = rpns.filter(r => r >= 40 && r <= 100).length;

  const summaryRows: (string | number)[][] = [
    ['Project', projectName],
    ['Exported', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
    [],
    ['FMEAs exported', docs.length],
    ['Total risks', allRisks.length],
    ['Max RPN', maxRpn],
    ['Mean RPN', meanRpn],
    ['High-RPN risks (>100)', highCount],
    ['Medium-RPN risks (40-100)', mediumCount],
    [],
    ...docs.map((d, i) => [
      `FMEA ${i + 1}`, d.title, `${risks[i].length} risks`, fmtDate(d.dateMs)
    ])
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 28 }, { wch: 40 }, { wch: 16 }, { wch: 16 }];

  // ── Risks sheet ───────────────────────────────────────────────────────────
  const header = [
    'FMEA', 'Process Step', 'Failure Mode', 'Failure Effect',
    'S', 'Cause', 'O', 'Controls', 'D',
    'RPN', 'Tier', 'AP',
    'Recommended Action', 'Responsible', 'Actions Taken',
    'Rev S', 'Rev O', 'Rev D', 'Rev RPN', 'Rev Tier', 'Rev AP'
  ];

  const rows: (string | number)[][] = [];
  docs.forEach((d, di) => {
    risks[di].forEach(r => {
      const rpn = computeRPN(r.severity, r.occurrence, r.detection);
      const ap  = actionPriority(r.severity, r.occurrence, r.detection);
      const hasRev =
        r.revisedSeverity !== undefined &&
        r.revisedOccurrence !== undefined &&
        r.revisedDetection !== undefined;
      const revRpn = hasRev
        ? computeRPN(r.revisedSeverity!, r.revisedOccurrence!, r.revisedDetection!)
        : '';
      const revAp = hasRev
        ? actionPriority(r.revisedSeverity!, r.revisedOccurrence!, r.revisedDetection!)
        : '';

      rows.push([
        d.title,
        r.processStep,
        r.failureMode,
        r.failureEffect,
        r.severity,
        r.cause,
        r.occurrence,
        r.controls,
        r.detection,
        rpn,
        rpnTier(rpn),
        ap,
        r.recommendedAction,
        r.responsible,
        r.actionsTaken,
        r.revisedSeverity ?? '',
        r.revisedOccurrence ?? '',
        r.revisedDetection ?? '',
        revRpn,
        revRpn !== '' ? rpnTier(revRpn as number) : '',
        revAp
      ]);
    });
  });

  const risksSheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  risksSheet['!cols'] = [
    { wch: 28 }, { wch: 24 }, { wch: 24 }, { wch: 28 },
    { wch: 4 }, { wch: 28 }, { wch: 4 }, { wch: 28 }, { wch: 4 },
    { wch: 6 }, { wch: 8 }, { wch: 4 },
    { wch: 32 }, { wch: 18 }, { wch: 32 },
    { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 6 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, risksSheet, 'Risks');
  return wb;
}

export function downloadPfmeaXlsx(
  docs: PfmeaXlsxDoc[],
  risks: PfmeaXlsxRisk[][],
  projectName: string
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const wb = pfmeasToWorkbook(docs, risks, projectName);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = (projectName || 'project')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.download = `PFMEA_${slug}_${dateTag}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
