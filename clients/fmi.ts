// FMI Operational Readiness Dashboard Data
// Edit this file to update status — push to GitHub → live in ~30s

export const FMI_CLIENT_KEY = 'fmi2026';

export interface Task {
  id: string;
  text: string;
  note?: string;
  status: 'done' | 'progress' | 'todo';
}

export interface Workstream {
  id: string;
  number: number;
  name: string;
  tasks: Task[];
}

export interface ActionItem {
  id: string;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  workstream: string;
  owner: string;
  target: string;
}

export interface Risk {
  id: string;
  level: 'high' | 'medium' | 'low';
  title: string;
  description: string;
}

export interface FMIData {
  clientName: string;
  subtitle: string;
  updatedAt: string;
  overallReadiness: number; // 0–100
  workstreams: Workstream[];
  actions: ActionItem[];
  risks: Risk[];
}

export const fmiData: FMIData = {
  clientName: 'Field Medical',
  subtitle: 'IDE & Commercial Launch Preparation',
  updatedAt: 'September 2026',
  overallReadiness: 32,

  workstreams: [
    {
      id: 'ws1',
      number: 1,
      name: 'Build Planning & Manufacturing Readiness',
      tasks: [
        { id: 'ws1-t1', text: 'Supply Chain Operating Model', note: 'Optimizing around KURO dependency & FMI warehouse build', status: 'done' },
        { id: 'ws1-t2', text: 'Master Parts List', note: 'Components identified for inventory management', status: 'done' },
        { id: 'ws1-t3', text: '12-Month Rolling Demand & Supply Plan', note: 'Template built; stakeholder conversations initiated', status: 'progress' },
        { id: 'ws1-t4', text: 'Manufacturing Readiness Assessment', note: 'Gap identification vs. IDE milestone requirements', status: 'todo' },
        { id: 'ws1-t5', text: 'Supply Risk Register & Mitigation Plan', note: 'Critical component lead-times & contingency plans', status: 'todo' },
      ],
    },
    {
      id: 'ws2',
      number: 2,
      name: 'Logistics & Supply Chain',
      tasks: [
        { id: 'ws2-t1', text: 'Inventory & Shipment Plan', note: 'Flowing from Master Parts List completion', status: 'progress' },
        { id: 'ws2-t2', text: 'Disposable Release Process', note: 'Part-release process for disposable products — QA/RA involvement required', status: 'todo' },
        { id: 'ws2-t3', text: 'IDE Shipment & Packaging Plan', note: 'Site-level requirements, labeling, cold-chain if applicable', status: 'todo' },
        { id: 'ws2-t4', text: 'Service Parts Strategy', note: 'Initial stocking levels & fulfillment model for field service', status: 'todo' },
      ],
    },
    {
      id: 'ws3',
      number: 3,
      name: 'Pricing & Cost Optimization',
      tasks: [
        { id: 'ws3-t1', text: 'KURO Cost Analysis & Reduction Roadmap', note: 'Evaluating FMI WH as alternative to reduce KURO-charged OPS costs', status: 'progress' },
        { id: 'ws3-t2', text: 'IDE Pricing Framework', note: 'Aligned with clinical site quotations — needed before first IDE site activation', status: 'todo' },
        { id: 'ws3-t3', text: 'Commercial Pricing Framework', note: 'Full cost-plus / market-based model for commercial launch', status: 'todo' },
      ],
    },
    {
      id: 'ws4',
      number: 4,
      name: 'Operations Infrastructure',
      tasks: [
        { id: 'ws4-t1', text: 'ERP Selection', note: 'Odoo identified as leading candidate — evaluating med-device traceability fit', status: 'progress' },
        { id: 'ws4-t2', text: 'FMI Warehouse Setup Plan', note: 'Defining footprint, equipment & material flow to reduce KURO dependency', status: 'progress' },
        { id: 'ws4-t3', text: 'ERP Implementation Roadmap', note: 'Scope, timeline, and QA/RA configuration requirements', status: 'todo' },
        { id: 'ws4-t4', text: 'Planning & Inventory Process Framework', note: 'Master data, BOM structures, and purchasing workflows', status: 'todo' },
      ],
    },
    {
      id: 'ws5',
      number: 5,
      name: 'Cross-Functional Operations Leadership',
      tasks: [
        { id: 'ws5-t1', text: 'Stakeholder Coordination', note: 'R&D, Clinical, QA/RA, Finance — weekly cadence established', status: 'progress' },
        { id: 'ws5-t2', text: 'Supplier Engagement', note: 'Key supplier conversations initiated around lead-times & coverage', status: 'progress' },
        { id: 'ws5-t3', text: 'Integrated Operations Readiness Dashboard', note: 'Formal shared tracker with leadership', status: 'progress' },
      ],
    },
  ],

  actions: [
    { id: 'a1', title: 'Finalize ERP selection & implementation plan', detail: 'Validate Odoo against QA/RA traceability requirements; define go/no-go', priority: 'high', workstream: 'WS 4', owner: 'Eran', target: "Oct '26" },
    { id: 'a2', title: 'Define IDE shipment & packaging requirements', detail: 'Engage QA/RA for site-level specs; long lead-time risk if delayed', priority: 'high', workstream: 'WS 2', owner: 'Eran', target: "Oct '26" },
    { id: 'a3', title: 'Develop IDE pricing framework', detail: 'Required before first clinical site can be quoted; align with leadership', priority: 'high', workstream: 'WS 3', owner: 'Eran', target: "Oct '26" },
    { id: 'a4', title: 'Complete manufacturing readiness assessment', detail: 'Gap analysis vs. IDE build milestones; identify critical path items', priority: 'high', workstream: 'WS 1', owner: 'Eran', target: "Nov '26" },
    { id: 'a5', title: 'Establish disposable release process', detail: 'QA/RA-approved part-release process for disposable products', priority: 'medium', workstream: 'WS 2', owner: 'Eran', target: "Nov '26" },
    { id: 'a6', title: 'Formalize supply risk register', detail: 'Critical component lead-times, PO coverage gaps, contingency plans', priority: 'medium', workstream: 'WS 1', owner: 'Eran', target: "Nov '26" },
    { id: 'a7', title: 'Finalize demand plan with all stakeholders', detail: 'Lock 12-month rolling forecast; align clinical, R&D, and ops', priority: 'medium', workstream: 'WS 1', owner: 'Eran', target: "Nov '26" },
    { id: 'a8', title: 'Service parts strategy', detail: 'Define initial stocking model and field service fulfillment process', priority: 'low', workstream: 'WS 2', owner: 'Eran', target: "Dec '26" },
  ],

  risks: [
    { id: 'r1', level: 'high', title: 'KURO Operational Dependency', description: 'High cost exposure and limited control over operations while FMI lacks its own warehouse capability. Mitigation: accelerate FMI WH setup plan.' },
    { id: 'r2', level: 'high', title: 'IDE Shipment Readiness Gap', description: 'Packaging and site shipment requirements not yet defined. QA/RA cycle times mean late start = IDE delay. Start conversations immediately.' },
    { id: 'r3', level: 'medium', title: 'ERP Implementation Timeline', description: 'Odoo configuration for med-device lot traceability takes longer than expected. Risk of operating manually through early IDE phase.' },
  ],
};
