// ---------------------------------------------------------------------------
// taktXlsx — convert a TaktStudy into a downloadable xlsx workbook with two
// sheets: Summary (study identity, takt inputs, verdict) and Steps
// (per-step rows including all cycle observations and standard time).
//
// Kept out of the React component so:
//   - the math + xlsx generation can be unit-tested headlessly
//   - lazy-loading the xlsx package is straightforward (it's heavy)
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';
import {
  computeTaktSec,
  bottleneckSec,
  totalCycleSec,
  lineBalanceLoss,
  capacityVerdict,
  stepMeanSec,
  stepStdDevSec,
  stepCv,
  stepStandardSec
} from './taktMath.ts';

// Avoid an import cycle by re-declaring the minimum shape we need from the
// study. The TaktStudy type lives in TaktStudyTool.tsx; using `import type`
// here would bring in React/Firestore through the file's other imports.
export interface TaktXlsxStep {
  id: string;
  name: string;
  description?: string;
  observations: number[];
  rating: number;
  allowance: number;
  vaType: 'va' | 'nva' | 'wait';
}

export interface TaktXlsxStudy {
  id?: string;
  name: string;
  productTitle: string;
  comment: string;
  status: 'draft' | 'completed';
  takt: { shiftMin: number; breakMin: number; demand: number };
  steps: TaktXlsxStep[];
  createdAtMs?: number;
  updatedAtMs?: number;
  completedAtMs?: number;
}

const fmtSec = (s: number): number =>
  Number.isFinite(s) ? Math.round(s * 100) / 100 : 0;

const fmtPct = (v: number): number =>
  Number.isFinite(v) ? Math.round(v * 1000) / 10 : 0; // 0.1234 → 12.3

const fmtDate = (ms?: number): string =>
  ms ? new Date(ms).toISOString().slice(0, 10) : '';

// Build the workbook in-memory. Returns a XLSX.WorkBook so callers can
// either stream it to disk via XLSX.writeFile (Node) or convert to a Blob
// + download via downloadStudyXlsx (browser).
export function studyToWorkbook(study: TaktXlsxStudy): XLSX.WorkBook {
  const taktSec = computeTaktSec(study.takt);
  const bottleneck = bottleneckSec(study.steps);
  const total = totalCycleSec(study.steps);
  const balanceLoss = lineBalanceLoss(study.steps);
  const verdict = capacityVerdict(bottleneck, taktSec);

  const summaryRows: (string | number)[][] = [
    ['Study name', study.name || ''],
    ['Product title', study.productTitle || ''],
    ['Comment', study.comment || ''],
    ['Status', study.status],
    ['Created', fmtDate(study.createdAtMs)],
    ['Last updated', fmtDate(study.updatedAtMs)],
    ['Completed', fmtDate(study.completedAtMs)],
    [],
    ['Takt inputs', ''],
    ['  Shift (min)', study.takt.shiftMin],
    ['  Breaks (min)', study.takt.breakMin],
    ['  Demand (units / shift)', study.takt.demand],
    [],
    ['Verdict', ''],
    ['  Takt time (sec/unit)', fmtSec(taktSec)],
    ['  Bottleneck standard time (sec)', fmtSec(bottleneck)],
    ['  Total cycle time (sec)', fmtSec(total)],
    ['  Line balance loss (%)', fmtPct(balanceLoss)],
    ['  Capacity status', verdict],
    [
      '  Bottleneck vs takt',
      taktSec > 0 ? `${fmtPct(bottleneck / taktSec)}%` : 'n/a'
    ],
    ['  Step count', study.steps.length]
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  // Widen the label column so summaries are readable when opened.
  summarySheet['!cols'] = [{ wch: 32 }, { wch: 60 }];

  // Steps sheet — one row per step. Cycle observations are joined into a
  // single comma-separated string column so a single row stays atomic and
  // sortable. Pivot tables in Excel can split it back out if needed.
  const stepsHeader = [
    '#',
    'Name',
    'Description',
    'Type',
    'Cycles (n)',
    'Observations (sec)',
    'Mean (sec)',
    'Std dev (sec)',
    'CV (%)',
    'Rating (%)',
    'Allowance (%)',
    'Standard time (sec)',
    'Over takt?'
  ];
  const stepsRows = study.steps.map((s, idx) => {
    const mean = stepMeanSec(s);
    const sd = stepStdDevSec(s);
    const c = stepCv(s);
    const std = stepStandardSec(s);
    return [
      idx + 1,
      s.name || '',
      s.description || '',
      s.vaType,
      s.observations.length,
      s.observations.map((o) => fmtSec(o)).join(', '),
      fmtSec(mean),
      fmtSec(sd),
      fmtPct(c),
      s.rating,
      s.allowance,
      fmtSec(std),
      taktSec > 0 && std > taktSec ? 'YES' : 'no'
    ];
  });
  const stepsSheet = XLSX.utils.aoa_to_sheet([stepsHeader, ...stepsRows]);
  stepsSheet['!cols'] = [
    { wch: 4 },
    { wch: 28 },
    { wch: 40 },
    { wch: 6 },
    { wch: 8 },
    { wch: 30 },
    { wch: 10 },
    { wch: 10 },
    { wch: 8 },
    { wch: 9 },
    { wch: 11 },
    { wch: 14 },
    { wch: 10 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, stepsSheet, 'Steps');
  return wb;
}

// Browser-only helper. Generates a Blob and triggers a <a download>. No-op
// in non-browser environments so this module remains import-safe under
// ts-jest (jsdom) without smashing the test runner.
export function downloadStudyXlsx(study: TaktXlsxStudy): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const wb = studyToWorkbook(study);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Build a sensible default filename: "TaktStudy_<slug>_<yyyymmdd>.xlsx"
  const slug =
    (study.productTitle || study.name || 'study')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'study';
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.download = `TaktStudy_${slug}_${dateTag}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the object URL — small but tidy.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
