// ---------------------------------------------------------------------------
// Project Templates (a.k.a. Scope Profiles).
//
// At project creation the user picks a template. The template seeds the
// project's `disabledItemIds` array — every RAMP_GROUPS sub-item NOT listed
// in `enabledItemIds` is added to the disabled set. After creation the user
// can edit scope freely from the General Info tab. The chosen template id is
// kept on the project for display only ("Scope: PCBA Sub-Assembly · 12/24").
//
// New items added to RAMP_GROUPS in the future are enabled by default for
// every existing project (because they won't be in the disabled list), which
// is what we want — opt-out, not opt-in.
// ---------------------------------------------------------------------------

import { RAMP_GROUPS } from './rampGroups';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  // Sub-item IDs that this template enables. Items NOT in this list are
  // disabled by default for projects created from this template.
  // For 'full_ramp' this is computed dynamically (every item in RAMP_GROUPS).
  enabledItemIds: string[];
}

// All 24 currently-defined sub-item IDs, derived once at module load.
const ALL_ITEM_IDS = RAMP_GROUPS.flatMap((g) => g.items.map((i) => i.id));

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'full_ramp',
    name: 'Full Ramp',
    description: 'Complete hardware product going to mass production. All 24 metrics enabled.',
    enabledItemIds: ALL_ITEM_IDS
  },
  {
    id: 'pcba',
    name: 'PCBA / Sub-Assembly',
    description: 'A board or sub-assembly being qualified. Skips line capacity, FRU, single-source coverage.',
    enabledItemIds: [
      // Product & Design — full
      'design_freeze', 'eco_rate', 'dfm_dfa', 'test_coverage', 'test_time', 'config_control',
      // Manufacturing — process-level only
      'work_instructions', 'process_flow_pfmea', 'tooling_qualification',
      // Supply Chain — minimal
      'supplier_qualification',
      // Quality — board-level basics
      'fpy', 'iqc_nc_capa'
    ]
  },
  {
    id: 'mechanical',
    name: 'Mechanical Module',
    description: 'A mechanical assembly or housing. Skips electrical test, traceability, MTBF.',
    enabledItemIds: [
      'design_freeze', 'eco_rate', 'dfm_dfa', 'config_control',
      'work_instructions', 'tooling_qualification',
      'supplier_qualification',
      'scrap_rate'
    ]
  },
  {
    id: 'pilot',
    name: 'Pilot / Prototype',
    description: 'Early-stage build where ramp metrics are premature. Just the essentials.',
    enabledItemIds: [
      'design_freeze', 'dfm_dfa', 'test_coverage',
      'supplier_qualification',
      'fpy', 'iqc_nc_capa'
    ]
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Start with everything disabled and opt-in to the metrics you want to track.',
    enabledItemIds: []
  }
];

export const DEFAULT_TEMPLATE_ID = 'full_ramp';

export const getTemplate = (id?: string | null): ProjectTemplate => {
  if (!id) return PROJECT_TEMPLATES[0];
  return PROJECT_TEMPLATES.find((t) => t.id === id) || PROJECT_TEMPLATES[0];
};

// Compute the disabledItemIds array a fresh project gets when created from
// a template. Anything in RAMP_GROUPS that's NOT in template.enabledItemIds.
export const disabledIdsForTemplate = (templateId: string): string[] => {
  const tmpl = getTemplate(templateId);
  const enabled = new Set(tmpl.enabledItemIds);
  return ALL_ITEM_IDS.filter((id) => !enabled.has(id));
};

// Total number of items currently defined in RAMP_GROUPS.
export const TOTAL_ITEM_COUNT = ALL_ITEM_IDS.length;
