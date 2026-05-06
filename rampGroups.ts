// ---------------------------------------------------------------------------
// Ramp-up readiness is organized into 4 "father" parameter groups. Each group
// rolls up a small number of measurable sub-items (action items). The SaaS
// deep-dive view uses this schema to render group cards + per-item metrics.
//
// Each sub-item is either:
//   - kind: 'bar'   → 0-100 progress bar (% completion / coverage / readiness)
//   - kind: 'value' → raw numeric input (counts, hours, rates)
// For 'value' items, `valueToScore(n)` converts the raw number into a 0-100
// normalized score so the group + overall rollup remain comparable.
// ---------------------------------------------------------------------------

export type MetricKind = 'bar' | 'value';

// Stage-gate type — mirrors the same union used in ProjectDeepDive.tsx
// (kept as a string-literal union so the two definitions stay structurally
// identical). `MP` (Mass Production) marks the post-launch / sustaining stage.
// Legacy projects saved with 'Post-PRR' are normalized to 'MP' on read.
export type ProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

export const PRODUCT_GATE_ORDER: ProductGate[] = [
  'CR', 'PDR', 'CDR', 'TRR', 'PRR', 'MP'
];

// Numeric index used for "due by <= current gate" comparisons.
export const gateIndex = (g: ProductGate): number =>
  PRODUCT_GATE_ORDER.indexOf(g);

// Reference checklist item template. Every new project inherits the template;
// per-project state (checked / custom additions) lives on the project doc and
// does not affect the template.
export interface DeliverableTemplate {
  id: string;            // stable within the parent sub-item
  title: string;         // short actionable statement
  hint?: string;         // optional help text
  // Gate by which this deliverable should be complete. Cumulative — once
  // past the gate, the deliverable remains required. Optional for back-
  // compat; missing values are treated as "no gate assigned" and omitted
  // from gate-readiness rollups.
  dueBy?: ProductGate;
}

export interface RampSubItem {
  id: string;                 // unique within a group
  title: string;              // short action-item title
  question: string;           // help / full description
  tool?: string;              // referenced tool / methodology
  kind: MetricKind;
  unit?: string;              // for 'value' items (e.g. "ECOs / month")
  // Default value when a project is created.
  defaultValue: number;
  // For 'value' items: convert raw number into normalized 0-100 score.
  valueToScore?: (n: number) => number;
  // Whether "higher is better" — only affects label phrasing, not math.
  higherIsBetter?: boolean;
  // Weight within the parent group (default 1).
  weight?: number;
  // Curated reference checklist of deliverables required to satisfy this
  // sub-parameter. Purely informational — does NOT affect the score.
  deliverables?: DeliverableTemplate[];
}

export interface RampGroup {
  id: string;
  title: string;
  subtitle: string;
  // Tailwind accent color token — used for the group card.
  accent: 'blue' | 'emerald' | 'amber' | 'violet';
  items: RampSubItem[];
}

// --- Shared scoring helpers ------------------------------------------------

// "Lower is better" numeric → bucketed 0-100 score. Used for ECO rate, scrap, etc.
const lowerIsBetter = (thresholds: number[]) => (n: number): number => {
  if (!Number.isFinite(n) || n < 0) return 0;
  // thresholds = [<=t0 → 100, <=t1 → 80, <=t2 → 60, <=t3 → 40, else 20]
  const bands = [100, 85, 70, 50, 25];
  for (let i = 0; i < thresholds.length; i++) {
    if (n <= thresholds[i]) return bands[i];
  }
  return 10;
};

// "Higher is better" numeric → bucketed 0-100 score. Used for MTBF, volume, etc.
const higherIsBetterFn = (thresholds: number[]) => (n: number): number => {
  if (!Number.isFinite(n) || n < 0) return 0;
  const bands = [20, 45, 65, 80, 95];
  for (let i = 0; i < thresholds.length; i++) {
    if (n <= thresholds[i]) return bands[i];
  }
  return 100;
};

// ---------------------------------------------------------------------------
// The 4 parent parameter groups.
// Each sub-item maps directly to one of the legacy `READINESS_INDICATORS`
// sub-indicators but is now measurable (bar or numeric value).
// ---------------------------------------------------------------------------

export const RAMP_GROUPS: RampGroup[] = [
  {
    id: 'product_design',
    title: 'Product & Design Readiness',
    subtitle: 'Design freeze, BOM stability, testability, and configuration control.',
    accent: 'blue',
    items: [
      {
        id: 'design_freeze',
        title: 'Design Freeze & BOM Structure',
        tool: 'CDR / DFMEA',
        question: 'Is the design frozen and the BOM fully structured?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.2,
        deliverables: [
          { id: 'cdr_signed', title: 'CDR (Critical Design Review) completed and signed', dueBy: 'CDR' },
          { id: 'bom_locked', title: 'BOM finalized and revision-locked in PLM', dueBy: 'CDR' },
          { id: 'dfmea_done', title: 'DFMEA workshop completed and risks scored', dueBy: 'CDR' },
          { id: 'baseline_tag', title: 'Design baseline tagged (drawings + schematics + firmware)', dueBy: 'CDR' },
          { id: 'drawings_released', title: 'All controlled drawings released to manufacturing', dueBy: 'CDR' },
          { id: 'labels_design', title: 'Labels design finalized (product / serial / regulatory)', dueBy: 'PRR' },
          { id: 'product_spec', title: 'Product spec / datasheet / MSDS released', dueBy: 'PDR' },
          { id: 'package_design', title: 'Shipping & retail package design finalized', dueBy: 'PRR' },
          { id: 'packaging_instr', title: 'Packaging instructions written and approved', dueBy: 'PRR' },
          { id: 'backward_compat', title: 'Backward / forward compatibility validated', dueBy: 'CDR' },
          { id: 'lifecycle_cutover', title: 'Lifecycle / cutover plan for the predecessor product', dueBy: 'PRR' }
        ]
      },
      {
        id: 'eco_rate',
        title: 'ECO Rate (Engineering Change Orders)',
        tool: '# R&D ECOs / month',
        question: 'Is the Engineering Change Order rate stable enough for production?',
        kind: 'value',
        unit: 'ECOs / month',
        defaultValue: 5,
        valueToScore: lowerIsBetter([1, 3, 6, 10]),
        higherIsBetter: false,
        weight: 1,
        deliverables: [
          { id: 'eco_process_doc', title: 'ECO process documented and approved', dueBy: 'PDR' },
          { id: 'ccb_active', title: 'Change Control Board (CCB) meeting cadence active', dueBy: 'PDR' },
          { id: 'eco_classes', title: 'ECO classification (Class I/II/III) defined', dueBy: 'PDR' },
          { id: 'eco_dashboard', title: 'ECO rate dashboard / report in place', dueBy: 'CDR' },
          { id: 'eco_to_production', title: 'ECO transfer-to-production milestone tracked', dueBy: 'PRR' }
        ]
      },
      {
        id: 'dfm_dfa',
        title: 'DFM / DFA Completion',
        tool: 'Subcontractor Reports',
        question: 'Has the design been optimized for assembly and fabrication?',
        kind: 'bar',
        defaultValue: 50,
        deliverables: [
          { id: 'dfm_review_cm', title: 'DFM review completed with Contract Manufacturer', dueBy: 'CDR' },
          { id: 'dfa_review', title: 'DFA review completed with assembly partner', dueBy: 'CDR' },
          { id: 'tolerance_stack', title: 'Tolerance stack-up analysis signed off', dueBy: 'CDR' },
          { id: 'preferred_parts', title: 'Manufacturer-preferred parts list locked', dueBy: 'PDR' },
          { id: 'dfx_actions', title: 'All DFx feedback closed or formally accepted', dueBy: 'CDR' }
        ]
      },
      {
        id: 'test_coverage',
        title: 'Production Test Coverage',
        tool: 'DFT',
        question: 'Does the test procedure cover critical quality requirements?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.2,
        deliverables: [
          { id: 'test_plan_ctq', title: 'Test plan covers all Critical-to-Quality features', dueBy: 'TRR' },
          { id: 'ict_coverage', title: 'ICT / flying-probe coverage defined and documented', dueBy: 'TRR' },
          { id: 'functional_test', title: 'Functional test procedure written and reviewed', dueBy: 'TRR' },
          { id: 'boundary_scan', title: 'Boundary-scan coverage assessed (where applicable)', dueBy: 'TRR' },
          { id: 'test_station', title: 'Test station hardware specification finalized', dueBy: 'TRR' },
          { id: 'tester_sw', title: 'Tester software developed, released, and version-locked', dueBy: 'TRR' },
          { id: 'test_equip_setup', title: 'Test equipment file & setup complete on the line', dueBy: 'TRR' }
        ]
      },
      {
        id: 'test_time',
        title: 'Production Test Cycle Time',
        tool: 'DFT',
        question: 'Is the test cycle time optimized for high volume?',
        kind: 'value',
        unit: 'seconds / unit',
        defaultValue: 120,
        valueToScore: lowerIsBetter([30, 60, 120, 240]),
        higherIsBetter: false,
        deliverables: [
          { id: 'test_time_budget', title: 'Test time budget per station defined', dueBy: 'TRR' },
          { id: 'parallel_test', title: 'Parallel-test strategy evaluated and decided', dueBy: 'TRR' },
          { id: 'test_automation', title: 'Test automation scripts complete and validated', dueBy: 'TRR' },
          { id: 'pilot_measured', title: 'Pilot-build cycle times measured and reviewed', dueBy: 'PRR' }
        ]
      },
      {
        id: 'config_control',
        title: 'Configuration Control (DMR / PLM)',
        tool: 'PLM Tool',
        question: 'Is the BOM version-controlled and is the DMR complete?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.1,
        deliverables: [
          { id: 'dmr_index', title: 'Device Master Record index complete', dueBy: 'CDR' },
          { id: 'plm_revctrl', title: 'PLM revision control active for all controlled docs', dueBy: 'PDR' },
          { id: 'doc_workflow', title: 'Document approval workflow live and used', dueBy: 'PDR' },
          { id: 'asbuilt_trace', title: 'As-built traceability links to BOM revision', dueBy: 'PRR' },
          { id: 'fw_mfg_version', title: 'Firmware manufacturing-build version locked', dueBy: 'CDR' },
          { id: 'final_bom_prod', title: 'Final BOM + production file package finalized', dueBy: 'CDR' }
        ]
      }
    ]
  },

  {
    id: 'manufacturing',
    title: 'Manufacturing & Operations',
    subtitle: 'Process definition, tooling, operator readiness, and ramp capacity.',
    accent: 'emerald',
    items: [
      {
        id: 'work_instructions',
        title: 'Work Instructions (WIs / SOPs)',
        tool: 'WIs',
        question: 'Are clear, documented work instructions available at every station?',
        kind: 'bar',
        defaultValue: 50,
        deliverables: [
          { id: 'wi_per_station', title: 'Work Instruction written for every assembly station', dueBy: 'PRR' },
          { id: 'wi_visuals', title: 'Photos / annotated diagrams included where helpful', dueBy: 'PRR' },
          { id: 'wi_language', title: 'WIs translated / leveled for shop-floor language', dueBy: 'PRR' },
          { id: 'wi_op_review', title: 'WIs reviewed and accepted by line operators', dueBy: 'PRR' },
          { id: 'wi_revctrl', title: 'WI revision control active in MES or PLM', dueBy: 'PRR' },
          { id: 'ops_plan', title: 'Operations plan published for the ramp window', dueBy: 'PRR' },
          { id: 'npi_kickoff', title: 'NPI kickoff completed with manufacturing partner', dueBy: 'PDR' },
          { id: 'install_instr', title: 'Installation instructions written for field deployment', dueBy: 'PRR' },
          { id: 'remediation_training', title: 'Remediation / rework training plan in place', dueBy: 'PRR' }
        ]
      },
      {
        id: 'process_flow_pfmea',
        title: 'Process Flow & PFMEA',
        tool: 'PFD / PFMEA',
        question: 'Is the manufacturing sequence mapped and failure-modes mitigated?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.1,
        deliverables: [
          { id: 'pfd_complete', title: 'Process Flow Diagram complete and approved', dueBy: 'CDR' },
          { id: 'pfmea_workshop', title: 'PFMEA workshop held with cross-functional team', dueBy: 'CDR' },
          { id: 'mitigations_assigned', title: 'Top-RPN mitigations assigned to owners', dueBy: 'CDR' },
          { id: 'control_plan', title: 'Control Plan derived from PFMEA', dueBy: 'CDR' },
          { id: 'pfmea_review', title: 'PFMEA review cadence established', dueBy: 'PRR' },
          { id: 'process_validation', title: 'Process validation runs executed and signed off', dueBy: 'PRR' },
          { id: 'env_testing', title: 'Environmental testing (HALT / HASS / drop) planned', dueBy: 'TRR' },
          { id: 'reconditioning', title: 'Reconditioning / rework procedure documented', dueBy: 'PRR' }
        ]
      },
      {
        id: 'tooling_qualification',
        title: 'Tooling Qualification (IQ / OQ / PQ)',
        tool: 'IQ/OQ/PQ',
        question: 'Have all machines completed IQ, OQ, and PQ qualification?',
        kind: 'bar',
        defaultValue: 40,
        weight: 1.2,
        deliverables: [
          { id: 'iq_executed', title: 'IQ protocol executed for all critical equipment', dueBy: 'PRR' },
          { id: 'oq_signed', title: 'OQ test data reviewed and signed', dueBy: 'PRR' },
          { id: 'pq_runs', title: 'PQ runs completed at nominal production rate', dueBy: 'PRR' },
          { id: 'calibration_plan', title: 'Calibration plan active for measurement equipment', dueBy: 'PRR' },
          { id: 'maint_plan', title: 'Preventive-maintenance plan documented', dueBy: 'PRR' }
        ]
      },
      {
        id: 'line_capacity',
        title: 'Line Capacity vs. Demand',
        tool: 'Capacity Analysis',
        question: 'Can the current tooling / line meet forecasted ramp demand?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.2,
        deliverables: [
          { id: 'takt_calc', title: 'Takt time calculated per ramp forecast', dueBy: 'PRR' },
          { id: 'station_capacity', title: 'Per-station capacity measured / modeled', dueBy: 'PRR' },
          { id: 'capacity_model', title: 'Capacity model matches forecasted volumes + headroom', dueBy: 'PRR' },
          { id: 'wip_strategy', title: 'WIP / buffer strategy defined', dueBy: 'PRR' },
          { id: 'sales_forecast', title: 'Sales forecast aligned with line capacity', dueBy: 'CDR' },
          { id: 'hw_availability', title: 'HW availability confirmed to support the ramp', dueBy: 'PRR' }
        ]
      },
      {
        id: 'trained_operators',
        title: 'Trained & Certified Operators',
        tool: 'Training Plan',
        question: 'Have all line operators been trained and certified for their tasks?',
        kind: 'bar',
        defaultValue: 50,
        deliverables: [
          { id: 'training_matrix', title: 'Training matrix (operator × station) complete', dueBy: 'PRR' },
          { id: 'all_certified', title: 'All operators certified for their assigned stations', dueBy: 'PRR' },
          { id: 'cert_records', title: 'Certification records on file and auditable', dueBy: 'PRR' },
          { id: 'cross_training', title: 'Cross-training plan in place for key stations', dueBy: 'PRR' },
          { id: 'install_training', title: 'Installation-team training delivered for field deployment', dueBy: 'PRR' }
        ]
      },
      {
        id: 'bottlenecks',
        title: 'Open Bottleneck Processes',
        tool: 'Throughput Study',
        question: 'How many bottleneck processes are still unresolved?',
        kind: 'value',
        unit: 'open bottlenecks',
        defaultValue: 3,
        valueToScore: lowerIsBetter([0, 1, 2, 4]),
        higherIsBetter: false,
        deliverables: [
          { id: 'bn_owners', title: 'Each bottleneck has a named owner', dueBy: 'PRR' },
          { id: 'bn_plan_due', title: 'Mitigation plan + due date for each bottleneck', dueBy: 'PRR' },
          { id: 'bn_review', title: 'Weekly bottleneck review meeting in place', dueBy: 'PRR' },
          { id: 'bn_priority', title: 'Data-driven prioritization (impact × effort)', dueBy: 'PRR' }
        ]
      }
    ]
  },

  {
    id: 'supply_chain',
    title: 'Supply Chain & Sourcing',
    subtitle: 'Supplier qualification, lead times, and dual-source coverage.',
    accent: 'amber',
    items: [
      {
        id: 'supplier_qualification',
        title: 'Tier-1 / Tier-2 Supplier Qualification',
        tool: 'Audits',
        question: 'Are all Tier-1 and Tier-2 suppliers audited and certified?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.1,
        deliverables: [
          { id: 'tier1_audited', title: 'All Tier-1 suppliers audited within audit window', dueBy: 'CDR' },
          { id: 'tier2_audited', title: 'Critical Tier-2 suppliers audited (where applicable)', dueBy: 'CDR' },
          { id: 'scorecards', title: 'Supplier scorecards in place and updated', dueBy: 'PRR' },
          { id: 'quality_agmt', title: 'Quality Agreements signed with each Tier-1', dueBy: 'CDR' },
          { id: 'capacity_commit', title: 'Capacity commitments secured in writing', dueBy: 'CDR' },
          { id: 'vendor_negotiation', title: 'Vendor price / terms negotiation closed', dueBy: 'CDR' },
          { id: 'third_parties_qual', title: '3rd-party services (calibration, logistics) qualified', dueBy: 'PRR' }
        ]
      },
      {
        id: 'lli_lead_time',
        title: 'Long-Lead-Item Buffer',
        tool: 'Lead Time Analysis',
        question: 'Longest critical-component lead time currently exposed.',
        kind: 'value',
        unit: 'weeks',
        defaultValue: 12,
        valueToScore: lowerIsBetter([4, 8, 12, 20]),
        higherIsBetter: false,
        deliverables: [
          { id: 'lli_list', title: 'LLI list identified and prioritized', dueBy: 'PDR' },
          { id: 'buffer_strategy', title: 'Buffer-stock / safety-stock strategy defined', dueBy: 'CDR' },
          { id: 'forecast_share', title: 'Forecast-sharing agreements with LLI suppliers', dueBy: 'CDR' },
          { id: 'alt_sources', title: 'Alternate sources evaluated for top LLIs', dueBy: 'CDR' }
        ]
      },
      {
        id: 'logistics_chain',
        title: 'Logistics Chain Established',
        tool: 'Incoterms / Shipping',
        question: 'Is the end-to-end logistics chain (components → FGI) established?',
        kind: 'bar',
        defaultValue: 50,
        deliverables: [
          { id: 'freight_fwd', title: 'Freight forwarder selected and contracted', dueBy: 'PRR' },
          { id: 'incoterms', title: 'Incoterms defined for every route', dueBy: 'PRR' },
          { id: 'customs', title: 'Customs / export classification validated', dueBy: 'PRR' },
          { id: 'transit_var', title: 'Transit-time variability measured', dueBy: 'PRR' },
          { id: 'master_part_list', title: 'Master Part List ready (COO, HS codes, weights)', dueBy: 'PRR' }
        ]
      },
      {
        id: 'single_source_pct',
        title: 'Single-Sourced Critical Components',
        tool: 'BOM Risk Review',
        question: 'What % of the critical BOM is still single-sourced?',
        kind: 'value',
        unit: '% of BOM',
        defaultValue: 40,
        valueToScore: lowerIsBetter([5, 15, 30, 50]),
        higherIsBetter: false,
        weight: 1.1,
        deliverables: [
          { id: 'risk_review', title: 'Critical-component risk review completed', dueBy: 'CDR' },
          { id: 'dual_roadmap', title: 'Dual-source roadmap for top-risk components', dueBy: 'CDR' },
          { id: 'strategic_stock', title: 'Strategic stock for hard-to-dual-source parts', dueBy: 'PRR' },
          { id: 'supplier_health', title: 'Supplier financial-health check completed', dueBy: 'CDR' }
        ]
      },
      {
        id: 'risk_components',
        title: 'Open Risk-Component Mitigations',
        tool: 'Risk Register',
        question: 'How many critical / rare components lack an active mitigation plan?',
        kind: 'value',
        unit: 'open items',
        defaultValue: 2,
        valueToScore: lowerIsBetter([0, 1, 3, 6]),
        higherIsBetter: false,
        deliverables: [
          { id: 'risk_register', title: 'Risk register maintained and current', dueBy: 'PDR' },
          { id: 'risk_owners', title: 'Every high-risk item has owner + action', dueBy: 'PDR' },
          { id: 'risk_cadence', title: 'Monthly risk-review cadence established', dueBy: 'PDR' },
          { id: 'escalation', title: 'Escalation process defined for red items', dueBy: 'PDR' }
        ]
      },
      {
        id: 'eol_process',
        title: 'EOL / Obsolescence Tracking',
        tool: 'Notification Process',
        question: 'Is there a process for tracking End-of-Life components?',
        kind: 'bar',
        defaultValue: 40,
        deliverables: [
          { id: 'eol_scan', title: 'BOM scanned for EOL / NRND alerts (e.g., Silicon Expert)', dueBy: 'CDR' },
          { id: 'pcn_process', title: 'PCN notification process with suppliers in place', dueBy: 'PDR' },
          { id: 'ltb_strategy', title: 'Last-Time-Buy (LTB) strategy defined', dueBy: 'CDR' },
          { id: 'redesign_plan', title: 'Redesign plan for any at-risk component', dueBy: 'CDR' }
        ]
      }
    ]
  },

  {
    id: 'quality_reliability',
    title: 'Quality & Reliability',
    subtitle: 'Yield, NC/CAPA, traceability, and field reliability.',
    accent: 'violet',
    items: [
      {
        id: 'fpy',
        title: 'First-Pass Yield (FPY)',
        tool: 'FAI',
        question: 'First-pass yield from the most recent pilot build.',
        kind: 'value',
        unit: '%',
        defaultValue: 70,
        valueToScore: (n) => Math.max(0, Math.min(100, n)),
        higherIsBetter: true,
        weight: 1.2,
        deliverables: [
          { id: 'pilot_measured', title: 'Pilot-build FPY measured and recorded', dueBy: 'PRR' },
          { id: 'fai_complete', title: 'First Article Inspection complete on first unit', dueBy: 'PRR' },
          { id: 'yield_pareto', title: 'Yield-failure Pareto chart produced', dueBy: 'PRR' },
          { id: 'yield_actions', title: 'Yield-improvement actions tracked to closure', dueBy: 'MP' }
        ]
      },
      {
        id: 'scrap_rate',
        title: 'Scrap Rate',
        tool: '# of scrap',
        question: 'Current scrap rate (% of units).',
        kind: 'value',
        unit: '% scrap',
        defaultValue: 4,
        valueToScore: lowerIsBetter([0.5, 1.5, 3, 6]),
        higherIsBetter: false,
        deliverables: [
          { id: 'scrap_def', title: 'Scrap definitions agreed across teams', dueBy: 'PRR' },
          { id: 'scrap_tracking', title: 'Scrap tracking system live (per cause / station)', dueBy: 'PRR' },
          { id: 'scrap_rca', title: 'RCA completed for top-3 scrap drivers', dueBy: 'MP' },
          { id: 'scrap_cost', title: 'Cost of scrap quantified and reported monthly', dueBy: 'MP' }
        ]
      },
      {
        id: 'iqc_nc_capa',
        title: 'IQC + NC / CAPA System',
        tool: 'NC / CAPA',
        question: 'Are incoming inspection and non-conformance workflows active?',
        kind: 'bar',
        defaultValue: 50,
        weight: 1.1,
        deliverables: [
          { id: 'iqc_plans', title: 'IQC inspection plans defined for critical parts', dueBy: 'PRR' },
          { id: 'ncr_workflow', title: 'Non-Conformance Report workflow live', dueBy: 'PRR' },
          { id: 'capa_doc', title: 'CAPA process documented and followed', dueBy: 'PRR' },
          { id: 'closed_loop', title: 'Closed-loop effectiveness checks tracked', dueBy: 'MP' },
          { id: 'incoming_accept_tests', title: 'Incoming acceptance tests defined and staffed', dueBy: 'PRR' }
        ]
      },
      {
        id: 'traceability',
        title: 'Serial / Lot Traceability',
        tool: 'Component Traceability',
        question: 'Is there serial-level traceability for critical components?',
        kind: 'bar',
        defaultValue: 50,
        deliverables: [
          { id: 'serial_plan', title: 'Serialization plan defined for end product', dueBy: 'PRR' },
          { id: 'lot_traceable', title: 'Critical components lot-traceable to supplier', dueBy: 'PRR' },
          { id: 'trace_mes', title: 'Traceability captured in MES / ERP', dueBy: 'PRR' },
          { id: 'recall_test', title: 'Recall / containment simulation completed', dueBy: 'PRR' }
        ]
      },
      {
        id: 'mtbf',
        title: 'MTBF / MTTF Validated',
        tool: 'Reliability Testing',
        question: 'Mean Time Between Failures from reliability testing (hours).',
        kind: 'value',
        unit: 'hours',
        defaultValue: 2000,
        valueToScore: higherIsBetterFn([500, 1500, 3000, 8000]),
        higherIsBetter: true,
        deliverables: [
          { id: 'rel_plan', title: 'Reliability test plan signed off', dueBy: 'TRR' },
          { id: 'halt_hass', title: 'HALT / HASS or accelerated-life test executed', dueBy: 'TRR' },
          { id: 'mtbf_calc', title: 'MTBF / MTTF calculation documented', dueBy: 'TRR' },
          { id: 'field_model', title: 'Field-reliability model assumptions reviewed', dueBy: 'PRR' },
          { id: 'drop_test', title: 'Drop / transit test executed and passed', dueBy: 'TRR' }
        ]
      },
      {
        id: 'rma_fru',
        title: 'RMA + FRU Readiness',
        tool: 'RMA Process',
        question: 'Are RMA workflows and Field Replaceable Units defined and stocked?',
        kind: 'bar',
        defaultValue: 40,
        deliverables: [
          { id: 'rma_doc', title: 'RMA process documented end-to-end', dueBy: 'PRR' },
          { id: 'fru_list', title: 'Field Replaceable Unit (FRU) list defined', dueBy: 'PRR' },
          { id: 'service_stock', title: 'Service-parts stocked per ramp forecast', dueBy: 'MP' },
          { id: 'warranty', title: 'Warranty terms agreed with customer / channel', dueBy: 'PRR' },
          { id: 'fru_kit', title: 'FRU kit contents defined and assembled', dueBy: 'MP' },
          { id: 'fru_inventory', title: 'FRU inventory strategy (regional stocking) set', dueBy: 'MP' },
          { id: 'fru_forecast', title: 'FRU demand forecast produced from ramp plan', dueBy: 'MP' },
          { id: 'fru_package', title: 'FRU packaging designed for field handling', dueBy: 'MP' },
          { id: 'ticketing_system', title: 'Ticketing system (e.g. Zendesk) configured for service', dueBy: 'PRR' },
          { id: 'pop_fsm', title: 'POP / FSM (Field Service Management) process live', dueBy: 'MP' },
          { id: 'regulatory_cert', title: 'Regulatory certification plan complete for launch markets', dueBy: 'PRR' }
        ]
      }
    ]
  }
];

// --- Scoring utilities -----------------------------------------------------

// `deliverablePct` is the 0..100 completion of an item's checklist (template +
// custom). When provided for a value-kind item, the score is a 50/50 blend of
// the numeric-derived score and the deliverable completion. This lets users
// add custom deliverables and see the bar move without divorcing the score
// from the underlying number entirely. Bar-kind items already get their value
// from deliverables (see ProjectDeepDive's metrics-rewrite useEffect), so
// blending again would double-count — they ignore deliverablePct here.
export const scoreForItem = (
  item: RampSubItem,
  value: number,
  deliverablePct?: number
): number => {
  if (item.kind === 'bar') return Math.max(0, Math.min(100, value || 0));
  const base = item.valueToScore ? item.valueToScore(value) : 0;
  if (typeof deliverablePct === 'number') {
    return Math.round((base + Math.max(0, Math.min(100, deliverablePct))) / 2);
  }
  return base;
};

// Set membership helper. `disabled` may be undefined (legacy projects) — in
// which case nothing is disabled and behaviour matches the original API.
const isDisabled = (id: string, disabled?: ReadonlyArray<string> | Set<string>): boolean => {
  if (!disabled) return false;
  if (disabled instanceof Set) return disabled.has(id);
  return disabled.indexOf(id) >= 0;
};

// `deliverableScores` is an optional id→percent (0..100) map of per-item
// deliverable completion. When provided, value-kind items blend their numeric
// score with their deliverable %. See scoreForItem for the blend rule.
// Backward-compatible — callers that don't pass it get the legacy behaviour.
export const scoreForGroup = (
  group: RampGroup,
  values: Record<string, number>,
  disabledItemIds?: ReadonlyArray<string>,
  deliverableScores?: Record<string, number>
): number => {
  const disabledSet = disabledItemIds ? new Set(disabledItemIds) : undefined;
  let total = 0;
  let weights = 0;
  group.items.forEach((item) => {
    if (isDisabled(item.id, disabledSet)) return;
    const raw = values[item.id] ?? item.defaultValue;
    const s = scoreForItem(item, raw, deliverableScores?.[item.id]);
    const w = item.weight ?? 1;
    total += s * w;
    weights += w;
  });
  return weights > 0 ? Math.round(total / weights) : 0;
};

export const scoreForProject = (
  values: Record<string, number>,
  disabledItemIds?: ReadonlyArray<string>,
  deliverableScores?: Record<string, number>
): number => {
  const disabledSet = disabledItemIds ? new Set(disabledItemIds) : undefined;
  let total = 0;
  let count = 0;
  RAMP_GROUPS.forEach((g) => {
    // Skip groups where every item is disabled — averaging them in as 0
    // would unfairly drag the rollup.
    const anyEnabled = g.items.some((i) => !isDisabled(i.id, disabledSet));
    if (!anyEnabled) return;
    total += scoreForGroup(g, values, disabledItemIds, deliverableScores);
    count += 1;
  });
  return count > 0 ? Math.round(total / count) : 0;
};

// ---------------------------------------------------------------------------
// Deliverable-blend helper (shared with Dashboard / PortfolioHeatmap /
// aiClient).
//
// ProjectDeepDive computes per-item deliverable completion from
// project.deliverables and passes the resulting id→pct map to scoreForGroup
// and scoreForProject so value-kind items blend their numeric reading with
// their deliverable progress (50/50, see scoreForItem). Without this map,
// list views and the AI prompt computed numeric-only scores → the dashboard
// row didn't match the project header. This helper centralises the
// derivation so every call site agrees.
//
// We deliberately type the input loosely (a minimal duck-typed shape) so
// rampGroups.ts stays UI-agnostic and doesn't have to import the full
// SubItemDeliverables / CustomDeliverable types from ProjectDeepDive.
// ---------------------------------------------------------------------------

interface DeliverableStateLike {
  checkedIds?: string[];
  hiddenTemplateIds?: string[];
  waivedTemplateIds?: string[];
  custom?: Array<{ done?: boolean; waived?: boolean }>;
}

export const deriveDeliverableScores = (
  deliverables?: Record<string, DeliverableStateLike> | null
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!deliverables) return out;
  for (const g of RAMP_GROUPS) {
    for (const item of g.items) {
      // Bar items already drive their score directly from deliverables via the
      // metrics-rewrite useEffect in ProjectDeepDive — blending again would
      // double-count. Only value-kind items participate in the blend.
      if (item.kind !== 'value') continue;
      const state = deliverables[item.id];
      if (!state) continue;
      const hidden = new Set(state.hiddenTemplateIds || []);
      const checked = new Set(state.checkedIds || []);
      const waived = new Set(state.waivedTemplateIds || []);
      const templateItems = (item.deliverables || []).filter((t) => !hidden.has(t.id));
      const customItems = state.custom || [];
      const total = templateItems.length + customItems.length;
      if (total === 0) continue;
      let done = 0;
      for (const t of templateItems) {
        if (waived.has(t.id) || checked.has(t.id)) done += 1;
      }
      for (const c of customItems) {
        if (c.waived || c.done) done += 1;
      }
      out[item.id] = Math.round((done / total) * 100);
    }
  }
  return out;
};

// How many sub-items in this group are currently enabled.
export const enabledCountForGroup = (
  group: RampGroup,
  disabledItemIds?: ReadonlyArray<string>
): number => {
  if (!disabledItemIds || disabledItemIds.length === 0) return group.items.length;
  const disabledSet = new Set(disabledItemIds);
  return group.items.reduce((acc, i) => acc + (disabledSet.has(i.id) ? 0 : 1), 0);
};

// Total enabled items across the whole project.
export const enabledCountForProject = (
  disabledItemIds?: ReadonlyArray<string>
): number => {
  let total = 0;
  RAMP_GROUPS.forEach((g) => {
    total += enabledCountForGroup(g, disabledItemIds);
  });
  return total;
};

// Returns a flat default-value map, keyed by item ID, for a fresh project.
export const defaultMetricValues = (): Record<string, number> => {
  const out: Record<string, number> = {};
  RAMP_GROUPS.forEach((g) => {
    g.items.forEach((item) => {
      out[item.id] = item.defaultValue;
    });
  });
  return out;
};

// Accent → concrete Tailwind color tokens used by the deep-dive cards.
export const accentTokens: Record<
  RampGroup['accent'],
  { bg: string; text: string; border: string; soft: string; stroke: string; fill: string }
> = {
  blue:    { bg: 'bg-blue-600',    text: 'text-blue-600',    border: 'border-blue-500',    soft: 'bg-blue-50',    stroke: '#2563eb', fill: '#3b82f6' },
  emerald: { bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-500', soft: 'bg-emerald-50', stroke: '#059669', fill: '#10b981' },
  amber:   { bg: 'bg-amber-500',   text: 'text-amber-600',   border: 'border-amber-500',   soft: 'bg-amber-50',   stroke: '#d97706', fill: '#f59e0b' },
  violet:  { bg: 'bg-violet-600',  text: 'text-violet-600',  border: 'border-violet-500',  soft: 'bg-violet-50',  stroke: '#7c3aed', fill: '#8b5cf6' }
};

// Score → color band (same palette as the Ramp Score tool)
export const scoreBand = (v: number) => {
  if (v >= 80) return { text: 'text-emerald-600', bg: 'bg-emerald-600', label: 'STRONG',    fill: '#10b981', stroke: '#059669' };
  if (v >= 60) return { text: 'text-blue-600',    bg: 'bg-blue-600',    label: 'ON TRACK',  fill: '#3b82f6', stroke: '#2563eb' };
  if (v >= 40) return { text: 'text-amber-600',   bg: 'bg-amber-500',   label: 'WARNING',   fill: '#f59e0b', stroke: '#d97706' };
  return          { text: 'text-red-600',     bg: 'bg-red-600',     label: 'CRITICAL',  fill: '#ef4444', stroke: '#dc2626' };
};
