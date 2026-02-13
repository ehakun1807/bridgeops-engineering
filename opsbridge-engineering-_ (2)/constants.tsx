import React from 'react';
import { 
  Building2, 
  Settings2, 
  Database, 
  Rocket, 
  TrendingDown, 
  Workflow, 
  ShieldCheck, 
  Users, 
  Wrench, 
  LineChart,
  ClipboardCheck,
  LifeBuoy
} from 'lucide-react';
import { ServiceItem, Achievement } from './types';

export interface DetailedServiceItem extends ServiceItem {
  code: string;
}

export const SERVICES: DetailedServiceItem[] = [
  {
    id: 'infrastructure',
    code: 'OPS-STR-01',
    title: 'Engineering Infrastructure',
    description: 'Establishing the foundational disciplines, standards, and technical methodologies and tools required for a scalable engineering department.',
    addedValue: 'Prevents "technical debt" in operations, ensuring the company can scale without structural bottlenecks.',
    image: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&q=80&w=800',
    icon: 'Building2'
  },
  {
    id: 'config-management',
    code: 'OPS-CFG-02',
    title: 'Configuration Management',
    description: 'Full ownership of BOM structures, ECR/ECO processes, and Doc Control using Good Documentation Practices (GDP).',
    addedValue: 'Ensures data integrity across R&D and Production, eliminating costly manufacturing errors and revision mismatches.',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800',
    icon: 'Settings2'
  },
  {
    id: 'plm-implementation',
    code: 'OPS-SYS-03',
    title: 'PLM Systems Implementation',
    description: 'Expert deployment and optimization of PLM tools tailored to organizational KPIs and ERP integration.',
    addedValue: 'Centralizes product data, accelerating collaborative development and streamlining regulatory audits.',
    image: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=800',
    icon: 'Database'
  },
  {
    id: 'npi',
    code: 'OPS-NPI-04',
    title: 'NPI: Development to Mass Production',
    description: 'Bridging the gap from prototypes to mass production through DFX (DFM/DFA/DFT) methodologies and pilot run management.',
    addedValue: 'Significant reduction in Time-to-Market (TTM) with stable production yields from the first batch.',
    image: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=800',
    icon: 'Rocket'
  },
  {
    id: 'cost-reduction',
    code: 'OPS-OPT-05',
    title: 'Operational Excellence & Savings',
    description: 'Leading strategic projects to reduce COGS, optimize supply chains, and implement FMEA-driven process improvements.',
    addedValue: 'Directly improves gross margins and operational efficiency through data-driven optimization.',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800',
    icon: 'TrendingDown'
  },
  {
    id: 'workflows',
    code: 'OPS-WFL-06',
    title: 'Cross-Organizational Workflows',
    description: 'Designing and implementing seamless business processes between Operations, R&D, Quality, and Product Management.',
    addedValue: 'Breaks down organizational silos, fostering a culture of synchronization and project transparency.',
    image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&q=80&w=800',
    icon: 'Workflow'
  },
  {
    id: 'quality-regulatory',
    code: 'OPS-QLT-07',
    title: 'Quality & Regulatory Interface',
    description: 'Specialized support for ISO 9001, ISO 13485 (Medical), and ATEX standards, building the bridge between engineering and compliance.',
    addedValue: 'Mitigates regulatory risks and ensures the product meets global safety and quality benchmarks.',
    image: 'https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?auto=format&fit=crop&q=80&w=800',
    icon: 'ShieldCheck'
  },
  {
    id: 'manufacturing-support',
    code: 'OPS-ENG-08',
    title: 'Manufacturing Engineering Support',
    description: 'Direct on-site support for production lines, yield improvement, and End-to-End Engineering support for Local/Global Sub-contractors/Suppliers.',
    addedValue: 'Ensures production line stability and maintains high professional standards for manufacturing personnel.',
    image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&q=80&w=800',
    icon: 'Wrench'
  },
  {
    id: 'sustainment',
    code: 'OPS-SUS-09',
    title: 'Sustainment Engineering',
    description: 'Post-release engineering support, handling component obsolescence, design changes, and continuous product lifecycle maintenance.',
    addedValue: 'Extends product profitability and prevents production stops due to supply chain or technical aging.',
    image: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&q=80&w=800',
    icon: 'LifeBuoy'
  }
];

export const ICON_MAP: Record<string, any> = {
  Building2, Settings2, Database, Rocket, TrendingDown, Workflow, ShieldCheck, Users, Wrench, LineChart, ClipboardCheck, LifeBuoy
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: '1', title: 'Patent Award for Innovative Design', company: 'Medical Device Leader', year: '2017' },
  { id: '2', title: 'GM Award for Outstanding Collaboration', company: 'Global Tech Leader', year: '2015' },
  { id: '3', title: 'Achieved >95% Yield in Mass Production', company: 'Industrial Tech Scale-up', year: '2023' }
];