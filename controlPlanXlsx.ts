// ---------------------------------------------------------------------------
// controlPlanXlsx — convert one or more Control Plan docs into a downloadable
// xlsx workbook with two sheets:
//   Summary — project / plan metadata + aggregate stats
//   Items   — one row per control item with all fields
//
// Mirrors the taktXlsx.ts pattern: pure module, no React.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

export interface ControlPlanXlsxItem {
  processStep: string;
  machineFixture?: string;
  charType: 'product' | 'process';
  productCharacteristic?: string;
  processCharacteristic?: string;
  specialClass: 'critical' | 'significant' | 'none';
  specificationTolerance?: string;
  measurementTechnique?: string;
  sampleSize?: string;
  sampleFrequency?: string;
  controlMethod?: string;
  reactionPlan?: string;
}

export interface ControlPlanXlsxDoc {
  id?: string;
  title: string;
  planType: 'prototype' | 'pre_launch' | 'production';
  partDescription?: string;
  revisionLevel?: string;
  dateMs: number;
  participants?: string;
  items: ControlPlanXlsxItem[];
}

const PLAN_TYPE_LABELS: Record<string, string> = {
  prototype: 'Prototype',
  pre_launch: 'Pre-Launch',
  production: 'Production'
};

const SPECIAL_CLASS_LABELS: Record<string, string> = {
  critical: 'Critical',
  significant: 'Significant',
  none: '—'
};

function fmtDate(ms: number): string {
  if (!ms || !isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

export function controlPlansToWorkbook(
  docs: ControlPlanXlsxDoc[],
  projectName: string
): XLSX.WorkBook {
  // ── Summary sheet ────────────────────────────────────────────────────────
  const allItems = docs.flatMap(d => d.items);
  const criticalCount   = allItems.filter(i => i.specialClass === 'critical').length;
  const significantCount = allItems.filter(i => i.specialClass === 'significant').length;

  const summaryRows: (string | number)[][] = [
    ['Project', projectName],
    ['Exported', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
    [],
    ['Plans exported', docs.length],
    ['Total control items', allItems.length],
    ['Critical characteristics', criticalCount],
    ['Significant characteristics', significantCount],
    [],
    ['#', 'Plan', 'Type', 'Rev', 'Date', 'Items', 'Critical', 'Significant'],
    ...docs.map((d, i) => [
      i + 1,
      d.title,
      PLAN_TYPE_LABELS[d.planType] ?? d.planType,
      d.revisionLevel ?? '',
      fmtDate(d.dateMs),
      d.items.length,
      d.items.filter(it => it.specialClass === 'critical').length,
      d.items.filter(it => it.specialClass === 'significant').length
    ])
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [
    { wch: 6 }, { wch: 36 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 12 }
  ];

  // ── Items sheet ───────────────────────────────────────────────────────────
  const header = [
    'Plan', 'Plan Type', 'Process Step', 'Machine / Fixture',
    'Char Type', 'Product Characteristic', 'Process Characteristic',
    'Special Class', 'Spec / Tolerance', 'Measurement Technique',
    'Sample Size', 'Sample Frequency', 'Control Method', 'Reaction Plan'
  ];

  const rows: (string | number)[][] = [];
  docs.forEach(d => {
    d.items.forEach(item => {
      rows.push([
        d.title,
        PLAN_TYPE_LABELS[d.planType] ?? d.planType,
        item.processStep,
        item.machineFixture ?? '',
        item.charType === 'product' ? 'Product' : 'Process',
        item.productCharacteristic ?? '',
        item.processCharacteristic ?? '',
        SPECIAL_CLASS_LABELS[item.specialClass] ?? item.specialClass,
        item.specificationTolerance ?? '',
        item.measurementTechnique ?? '',
        item.sampleSize ?? '',
        item.sampleFrequency ?? '',
        item.controlMethod ?? '',
        item.reactionPlan ?? ''
      ]);
    });
  });

  const itemsSheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  itemsSheet['!cols'] = [
    { wch: 28 }, { wch: 12 }, { wch: 28 }, { wch: 20 },
    { wch: 10 }, { wch: 28 }, { wch: 28 },
    { wch: 12 }, { wch: 24 }, { wch: 24 },
    { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 36 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, itemsSheet, 'Control Items');
  return wb;
}

export function downloadControlPlanXlsx(
  docs: ControlPlanXlsxDoc[],
  projectName: string
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const wb = controlPlansToWorkbook(docs, projectName);
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
  a.download = `ControlPlan_${slug}_${dateTag}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
