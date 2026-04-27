// ---------------------------------------------------------------------------
// Shared product-standards catalog used across BridgeOps.
//
// Maps each product segment (from productSegments.ts) to the list of
// ISO / FDA / IEC / industry standards most commonly applicable. Selected
// codes from this catalog are persisted on the Project and flow into:
//   - The Coacher prompt (so referenceStandards prioritize the user's picks)
//   - The AI risk-analysis prompt (compliance-weighted findings)
//   - Display surfaces (Dashboard card pill, Coacher header chips)
//
// The list is intentionally conservative — only widely-cited, vendor-neutral
// standards per segment. We avoid fabricated clause numbers; the AI prompts
// instruct the model to cite clauses only when highly confident.
// ---------------------------------------------------------------------------

export interface Standard {
  code: string;
  name: string;
}

export const STANDARDS_BY_SEGMENT: Record<string, Standard[]> = {
  'Medical Device': [
    { code: 'ISO 13485', name: 'Medical Devices — Quality Management Systems' },
    { code: 'ISO 14971', name: 'Medical Devices — Risk Management' },
    { code: 'IEC 62304', name: 'Medical Device Software — Software Lifecycle' },
    { code: 'IEC 60601-1', name: 'Medical Electrical Equipment — General Safety' },
    { code: 'IEC 62366-1', name: 'Medical Devices — Usability Engineering' },
    { code: 'ISO 10993', name: 'Biological Evaluation of Medical Devices' },
    { code: 'ISO 15223-1', name: 'Symbols for Medical Device Labeling' },
    { code: 'FDA 21 CFR Part 820', name: 'US Quality System Regulation (QSR)' },
    { code: 'EU MDR 2017/745', name: 'European Medical Device Regulation' },
    { code: 'ISO 11607', name: 'Packaging for Terminally Sterilized Devices' }
  ],
  Agrotech: [
    { code: 'ISO 11783', name: 'ISOBUS — Tractors & Agricultural Machinery' },
    { code: 'ISO 14001', name: 'Environmental Management Systems' },
    { code: 'ISO 22000', name: 'Food Safety Management Systems' },
    { code: 'ISO 9001', name: 'Quality Management Systems' },
    { code: 'GLOBALG.A.P.', name: 'Good Agricultural Practice Certification' },
    { code: 'ISO 17025', name: 'Testing & Calibration Laboratories' },
    { code: 'ISO 50001', name: 'Energy Management Systems' },
    { code: 'EN 16005', name: 'Power Operated Agricultural Equipment Safety' }
  ],
  'Military / Defense': [
    { code: 'MIL-STD-810', name: 'Environmental Engineering Considerations' },
    { code: 'MIL-STD-461', name: 'EMI/EMC Requirements' },
    { code: 'MIL-STD-882', name: 'System Safety Program' },
    { code: 'MIL-STD-883', name: 'Microcircuit Test Methods' },
    { code: 'AS9100', name: 'Aerospace & Defense Quality Management' },
    { code: 'AQAP 2110', name: 'NATO Quality Assurance Requirements' },
    { code: 'ITAR', name: 'International Traffic in Arms Regulations' },
    { code: 'CMMC', name: 'Cybersecurity Maturity Model Certification' },
    { code: 'MIL-HDBK-217', name: 'Reliability Prediction of Electronic Equipment' }
  ],
  Automotive: [
    { code: 'IATF 16949', name: 'Automotive Quality Management Systems' },
    { code: 'ISO 26262', name: 'Functional Safety — Road Vehicles' },
    { code: 'ISO 21434', name: 'Automotive Cybersecurity Engineering' },
    { code: 'AEC-Q100', name: 'Integrated Circuit Qualification' },
    { code: 'AEC-Q200', name: 'Passive Component Qualification' },
    { code: 'VDA 6.3', name: 'Process Audit Standard' },
    { code: 'Automotive SPICE', name: 'Software Process Improvement' },
    { code: 'ISO/SAE 21448 (SOTIF)', name: 'Safety of the Intended Functionality' },
    { code: 'UNECE R155/R156', name: 'Cybersecurity & Software Update Management' }
  ],
  'Consumer Electronics': [
    { code: 'IEC 62368-1', name: 'Audio/Video & IT Equipment Safety' },
    { code: 'IEC 60950-1', name: 'IT Equipment Safety (legacy)' },
    { code: 'FCC Part 15', name: 'US Radio Frequency Device Regulations' },
    { code: 'CE Marking', name: 'European Conformity Declaration' },
    { code: 'EN 55032', name: 'EMC Emissions — Multimedia Equipment' },
    { code: 'EN 55035', name: 'EMC Immunity — Multimedia Equipment' },
    { code: 'RoHS Directive', name: 'Restriction of Hazardous Substances' },
    { code: 'REACH', name: 'EU Chemicals Regulation' },
    { code: 'ENERGY STAR', name: 'Energy Efficiency Certification' },
    { code: 'UL 62368-1', name: 'North American Safety Certification' }
  ],
  'Industrial Automation / Robotics': [
    { code: 'ISO 10218-1/2', name: 'Robot & Robotic Device Safety' },
    { code: 'ISO/TS 15066', name: 'Collaborative Robots Safety' },
    { code: 'ISO 13849-1', name: 'Safety-Related Parts of Control Systems' },
    { code: 'IEC 61508', name: 'Functional Safety of E/E/PE Systems' },
    { code: 'IEC 62061', name: 'Functional Safety of Machinery' },
    { code: 'ISO 12100', name: 'Safety of Machinery — Risk Assessment' },
    { code: 'IEC 61131-3', name: 'Programmable Controllers — Languages' },
    { code: 'IEC 62443', name: 'Industrial Communication Network Security' },
    { code: 'OSHA 1910.212', name: 'Machine Guarding Requirements' }
  ],
  Aerospace: [
    { code: 'AS9100D', name: 'Aerospace Quality Management Systems' },
    { code: 'DO-178C', name: 'Airborne Software Considerations' },
    { code: 'DO-254', name: 'Airborne Electronic Hardware' },
    { code: 'DO-160G', name: 'Environmental Conditions & Test Procedures' },
    { code: 'FAR Part 25', name: 'FAA Transport Category Airworthiness' },
    { code: 'EASA CS-25', name: 'European Large Aeroplane Certification' },
    { code: 'ARP4754A', name: 'Civil Aircraft & Systems Development' },
    { code: 'ARP4761', name: 'Safety Assessment Process Guidelines' },
    { code: 'NAS 410', name: 'NDT Personnel Qualification' }
  ],
  Telecommunications: [
    { code: '3GPP (5G/LTE)', name: 'Cellular Network Specifications' },
    { code: 'ITU-T', name: 'Telecommunication Standardization' },
    { code: 'IEEE 802.11', name: 'Wireless LAN (Wi-Fi)' },
    { code: 'IEEE 802.3', name: 'Ethernet Standards' },
    { code: 'ETSI EN 300 328', name: '2.4 GHz Wideband Transmission' },
    { code: 'FCC Part 22/24/27', name: 'US Wireless Spectrum Regulations' },
    { code: 'GCF / PTCRB', name: 'Device Certification for Cellular' },
    { code: 'ISO/IEC 27001', name: 'Information Security Management' },
    { code: 'RED 2014/53/EU', name: 'EU Radio Equipment Directive' }
  ],
  'Energy / CleanTech': [
    { code: 'IEC 61215', name: 'Crystalline Silicon PV Module Qualification' },
    { code: 'IEC 61730', name: 'Photovoltaic Module Safety' },
    { code: 'IEC 62109', name: 'Power Converter Safety for PV' },
    { code: 'IEC 61400', name: 'Wind Turbine Design Requirements' },
    { code: 'IEEE 1547', name: 'Distributed Energy Resource Interconnection' },
    { code: 'UL 1741', name: 'Inverters & Converters for DER' },
    { code: 'UL 9540', name: 'Energy Storage Systems Safety' },
    { code: 'ISO 50001', name: 'Energy Management Systems' },
    { code: 'IEC 62133', name: 'Secondary Cell & Battery Safety' }
  ],
  'IoT Devices': [
    { code: 'ETSI EN 303 645', name: 'Cybersecurity for Consumer IoT' },
    { code: 'ISO/IEC 27001', name: 'Information Security Management' },
    { code: 'NIST IR 8259', name: 'IoT Device Cybersecurity Baseline' },
    { code: 'Matter (CSA)', name: 'Smart Home Interoperability Standard' },
    { code: 'IEEE 802.15.4', name: 'Low-Rate Wireless (Zigbee/Thread)' },
    { code: 'Bluetooth SIG', name: 'Bluetooth Core & Profile Qualification' },
    { code: 'FCC Part 15', name: 'US Radio Frequency Regulations' },
    { code: 'RED 2014/53/EU', name: 'EU Radio Equipment Directive' },
    { code: 'EU Cyber Resilience Act', name: 'Digital Product Cybersecurity' }
  ],
  Wearables: [
    { code: 'ISO 10993', name: 'Biocompatibility / Skin Contact' },
    { code: 'IEC 62368-1', name: 'Audio/Video & IT Equipment Safety' },
    { code: 'IEEE 11073', name: 'Personal Health Device Communication' },
    { code: 'IEC 60529 (IP Rating)', name: 'Ingress Protection — Dust & Water' },
    { code: 'FCC Part 15', name: 'US Radio Frequency Regulations' },
    { code: 'Bluetooth SIG', name: 'Bluetooth LE Qualification' },
    { code: 'FDA 21 CFR Part 820', name: 'Medical Wearables — US QSR' },
    { code: 'IEC 62304', name: 'Medical Device Software Lifecycle' },
    { code: 'GDPR / HIPAA', name: 'Personal & Health Data Protection' }
  ],
  'Other Hardware': [
    { code: 'ISO 9001', name: 'Quality Management Systems' },
    { code: 'ISO 14001', name: 'Environmental Management Systems' },
    { code: 'IEC 61508', name: 'Functional Safety of E/E/PE Systems' },
    { code: 'IPC-A-610', name: 'Acceptability of Electronic Assemblies' },
    { code: 'IPC-2221', name: 'Generic PCB Design Standard' },
    { code: 'RoHS Directive', name: 'Restriction of Hazardous Substances' },
    { code: 'REACH', name: 'EU Chemicals Regulation' },
    { code: 'CE Marking', name: 'European Conformity Declaration' },
    { code: 'UL Certification', name: 'North American Product Safety' }
  ]
};

// Lookup helper — returns the catalog entries for a given product segment,
// or an empty list for unknown/custom types. Callers that need a hardcoded
// fallback can wire "Other Hardware" themselves when appropriate.
export function standardsForSegment(segment?: string | null): Standard[] {
  if (!segment) return [];
  return STANDARDS_BY_SEGMENT[segment] || [];
}

// Stable, URL-safe fingerprint of a set of selected standard codes. Used in
// the Coacher cache key so that different standard selections produce
// distinct cached advice. Sorted + normalized so order doesn't matter.
//
// Empty / undefined selection → 'none' (so the cache doc id stays fixed for
// projects that opt out of picking standards).
export function standardsCacheKey(codes?: string[] | null): string {
  if (!codes || codes.length === 0) return 'none';
  const normalized = [...codes]
    .map((c) => c.trim())
    .filter(Boolean)
    .sort();
  if (normalized.length === 0) return 'none';
  // Collapse each code to a short slug so we can concatenate without
  // exploding the doc-id length for long lists.
  const slugs = normalized.map((c) =>
    c
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
  );
  return slugs.join('_').slice(0, 120) || 'none';
}
