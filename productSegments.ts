// ---------------------------------------------------------------------------
// Shared product-segment / industry list used across BridgeOps.
//
// Single source of truth for the industries we surface in:
//   - RampScoreTool intake form (Product Category dropdown)
//   - Dashboard "New Project" modal (Product Type dropdown)
//   - Coacher product-type caching (coachClient.normalizeProductTypeKey)
//
// Kept deliberately flat — a plain string[] — so adding/removing a segment
// is a one-line edit. If we ever need richer metadata (regulatory regime,
// default standards, etc.) we can promote this to an object array without
// rippling across callers (thanks to typeof-indexing below).
// ---------------------------------------------------------------------------

export const PRODUCT_SEGMENTS = [
  'Medical Device',
  'Agrotech',
  'Military / Defense',
  'Automotive',
  'Consumer Electronics',
  'Industrial Automation / Robotics',
  'Aerospace',
  'Telecommunications',
  'Energy / CleanTech',
  'IoT Devices',
  'Wearables',
  'Other Hardware'
] as const;

export type ProductSegment = (typeof PRODUCT_SEGMENTS)[number];

export const DEFAULT_PRODUCT_SEGMENT: ProductSegment = 'Medical Device';

// Sentinel for "let me type something else" in the Dashboard New Project
// flow. The dropdown shows this as the last option; selecting it reveals
// a free-text input. Keeping it as a distinct sentinel (not '') makes the
// select-vs-custom distinction unambiguous in component state.
export const PRODUCT_SEGMENT_OTHER = '__other__';
