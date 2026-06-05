// ---------------------------------------------------------------------------
// budgetXlsx — convert a ProjectBudget into a downloadable xlsx workbook.
//
// Two sheets:
//   Summary  — kickoff estimate, actual total, variance, spend by category,
//              notes.
//   Cost Lines — one row per entry, sorted most-recent first.
//
// Follows the same pattern as taktXlsx.ts / pfmeaXlsx.ts:
//   - pure module (no React imports)
//   - import-safe under ts-jest (typeof window guard on downloadBudgetXlsx)
//   - exported workbook builder for testability
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';
import type { ProjectBudget, CostCategory } from './ProjectBudgetTool.tsx';
import { COST_CATEGORY_LABELS } from './ProjectBudgetTool.tsx';

const fmtDate = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

export function budgetToWorkbook(budget: ProjectBudget, projectName: string): XLSX.WorkBook {
  const lines       = budget.lines ?? [];
  const actualTotal = lines.reduce((s, l) => s + l.amount, 0);
  const estimate    = budget.kickoffEstimate ?? 0;
  const variance    = actualTotal - estimate;
  const variancePct = estimate > 0 ? (variance / estimate) * 100 : 0;

  const categories: CostCategory[] = ['labor', 'material', 'test_equipment', 'capex', 'overhead', 'other'];
  const catPlans = budget.categoryPlans ?? {};
  const byCategory = categories
    .map((cat) => {
      const planned = catPlans[cat] ?? 0;
      const actual  = lines.filter((l) => l.category === cat).reduce((s, l) => s + l.amount, 0);
      return { label: COST_CATEGORY_LABELS[cat], planned, actual };
    })
    .filter((c) => c.planned > 0 || c.actual > 0);

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const summaryRows: (string | number)[][] = [
    ['Project',          projectName],
    ['Export Date',      fmtDate(Date.now())],
    ['Last Updated',     fmtDate(budget.updatedAtMs)],
    [],
    ['Kickoff Estimate ($)', estimate],
    ['Actual Spent ($)',     actualTotal],
    ['Variance ($)',         variance],
    ['Variance (%)',         Number(variancePct.toFixed(1))],
    [],
    ['Plan vs Actual by Category', '', ''],
    ['Category', 'Planned ($)', 'Actual ($)', 'Variance ($)'],
    ...byCategory.map((c) => [c.label, c.planned, c.actual, c.actual - c.planned]),
    [],
    ['Notes', budget.notes ?? ''],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 26 }, { wch: 20 }];

  // ── Cost Lines sheet ───────────────────────────────────────────────────────
  const header = ['Date', 'Category', 'Type', 'Description', 'Amount ($)', 'ECO / BOM Ref'];
  const lineRows = [...lines]
    .sort((a, b) => b.dateMs - a.dateMs)
    .map((l) => [
      fmtDate(l.dateMs),
      COST_CATEGORY_LABELS[l.category as CostCategory] ?? l.category,
      l.type,
      l.description,
      l.amount,
      l.linkedEcoId ?? '',
    ]);

  const linesSheet = XLSX.utils.aoa_to_sheet([header, ...lineRows]);
  linesSheet['!cols'] = [
    { wch: 12 },  // Date
    { wch: 20 },  // Category
    { wch: 10 },  // Type
    { wch: 52 },  // Description
    { wch: 14 },  // Amount
    { wch: 18 },  // ECO ref
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, linesSheet,   'Cost Lines');
  return wb;
}

export function downloadBudgetXlsx(budget: ProjectBudget, projectName: string): void {
  if (typeof window === 'undefined') return;
  const wb = budgetToWorkbook(budget, projectName);
  const safeName = projectName
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'project';
  XLSX.writeFile(wb, `${safeName}__budget.xlsx`);
}
