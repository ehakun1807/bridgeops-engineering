// ---------------------------------------------------------------------------
// lessonsXlsx — convert Lessons & Learned docs into a downloadable xlsx
// workbook with two sheets:
//   Summary  — project metadata + aggregate stats
//   Actions  — one row per action item (flattened across all lessons)
//
// Mirrors the taktXlsx.ts pattern: pure module, no React.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

export interface LessonsXlsxAction {
  text: string;
  priority: 'must' | 'nice_to_have';
  owner: string;
  targetDateMs?: number;
  done: boolean;
}

export interface LessonsXlsxLesson {
  id?: string;
  dateMs: number;
  title: string;
  category: string;
  lessonType: 'problem' | 'improvement' | 'best_practice';
  gate?: string;
  description: string;
  rootCause: string;
  status: 'open' | 'in_progress' | 'closed';
  actionItems: LessonsXlsxAction[];
}

const LESSON_TYPE_LABELS: Record<string, string> = {
  problem:       'Problem',
  improvement:   'Improvement',
  best_practice: 'Best Practice'
};

const STATUS_LABELS: Record<string, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  closed:      'Closed'
};

function fmtDate(ms?: number): string {
  if (!ms || !isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

export function lessonsToWorkbook(
  lessons: LessonsXlsxLesson[],
  projectName: string
): XLSX.WorkBook {
  // ── Summary sheet ────────────────────────────────────────────────────────
  const allActions = lessons.flatMap(l => l.actionItems);
  const mustTotal    = allActions.filter(a => a.priority === 'must').length;
  const mustPending  = allActions.filter(a => a.priority === 'must' && !a.done).length;
  const openCount    = lessons.filter(l => l.status === 'open').length;
  const inProgCount  = lessons.filter(l => l.status === 'in_progress').length;
  const closedCount  = lessons.filter(l => l.status === 'closed').length;

  const summaryRows: (string | number)[][] = [
    ['Project', projectName],
    ['Exported', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
    [],
    ['Total lessons', lessons.length],
    ['Open', openCount],
    ['In Progress', inProgCount],
    ['Closed', closedCount],
    [],
    ['Total MUST actions', mustTotal],
    ['MUST actions pending', mustPending],
    ['Total action items', allActions.length],
    [],
    ['#', 'Title', 'Type', 'Category', 'Gate', 'Status', 'MUST done/total'],
    ...lessons.map((l, i) => {
      const must = l.actionItems.filter(a => a.priority === 'must');
      const mustDone = must.filter(a => a.done).length;
      return [
        i + 1,
        l.title,
        LESSON_TYPE_LABELS[l.lessonType] ?? l.lessonType,
        l.category,
        l.gate ?? '',
        STATUS_LABELS[l.status] ?? l.status,
        `${mustDone}/${must.length}`
      ];
    })
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [
    { wch: 6 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 14 }
  ];

  // ── Actions sheet — flattened ─────────────────────────────────────────────
  const actHeader = [
    'Lesson #', 'Lesson Title', 'Type', 'Category', 'Gate', 'Lesson Status',
    'Lesson Date', 'Root Cause Summary',
    'Action', 'Priority', 'Owner', 'Target Date', 'Done'
  ];

  const actRows: (string | number | boolean)[][] = [];
  lessons.forEach((l, li) => {
    if (l.actionItems.length === 0) {
      actRows.push([
        li + 1, l.title,
        LESSON_TYPE_LABELS[l.lessonType] ?? l.lessonType,
        l.category,
        l.gate ?? '',
        STATUS_LABELS[l.status] ?? l.status,
        fmtDate(l.dateMs),
        l.rootCause,
        '(no actions)', '', '', '', ''
      ]);
    } else {
      l.actionItems.forEach(a => {
        actRows.push([
          li + 1, l.title,
          LESSON_TYPE_LABELS[l.lessonType] ?? l.lessonType,
          l.category,
          l.gate ?? '',
          STATUS_LABELS[l.status] ?? l.status,
          fmtDate(l.dateMs),
          l.rootCause,
          a.text,
          a.priority === 'must' ? 'MUST' : 'NICE TO HAVE',
          a.owner,
          fmtDate(a.targetDateMs),
          a.done ? 'Yes' : 'No'
        ]);
      });
    }
  });

  const actionsSheet = XLSX.utils.aoa_to_sheet([actHeader, ...actRows]);
  actionsSheet['!cols'] = [
    { wch: 8 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 6 }, { wch: 12 },
    { wch: 14 }, { wch: 40 },
    { wch: 40 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 6 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, actionsSheet, 'Actions');
  return wb;
}

export function downloadLessonsXlsx(
  lessons: LessonsXlsxLesson[],
  projectName: string
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const wb = lessonsToWorkbook(lessons, projectName);
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
  a.download = `Lessons_${slug}_${dateTag}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
