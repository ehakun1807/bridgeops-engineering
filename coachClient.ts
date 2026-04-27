// ---------------------------------------------------------------------------
// Client-side helper for the Coacher feature.
//
// The Coach provides per-sub-parameter best-practice advice ("how to deliver
// Configuration Control optimally for a Medical Device"). Each combination of
// (subItemId, productType) is cached in Firestore to keep Gemini usage low —
// 99% of clicks hit Firestore, not Gemini.
//
// Flow:
//   1. Normalize productType → cache key.
//   2. Read Firestore doc coachAdvice/{subItemId}__{productTypeKey}.
//   3. If fresh (≤90 days) and not forceRefresh → return cached payload.
//   4. Otherwise call /api/ai-coach, persist the result, return it.
//
// Thumbs-up/down feedback is written to a sibling coachFeedback collection so
// the admin can review flagged outputs and hand-correct cache docs as needed.
// ---------------------------------------------------------------------------

import { auth, db } from './firebase.ts';
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { standardsCacheKey } from './productStandards.ts';

export interface CoachApproachStep {
  step: string;
  detail: string;
}

export type CoachProductGate = 'CR' | 'PDR' | 'CDR' | 'TRR' | 'PRR' | 'MP';

export interface CoachGateExpectation {
  gate: CoachProductGate;
  expectation: string;
}

export interface CoachAdvice {
  summary: string;
  rulesOfThumb: string[];
  recommendedApproach: CoachApproachStep[];
  commonPitfalls: string[];
  gateGuidance: CoachGateExpectation[];
  referenceStandards: string[];
  toolingExamples: string[];
  generatedAt: number;
  modelVersion: string;
}

export interface CoachFetchInput {
  subItemId: string;
  subItemTitle: string;
  subItemDefinition: string;
  subItemTool?: string;
  groupTitle?: string;
  productType: string;
  // Optional project-level standards (e.g. ISO 13485, IEC 62304). When present
  // we (a) include them in the Coacher prompt as a soft preference, and (b)
  // fold them into the cache doc id so different selections get distinct
  // cached advice for the same (subItem, productType) pair.
  standards?: string[];
  forceRefresh?: boolean;
}

// 30-day TTL. Coacher answers are grounded with Google Search on the server
// (see api/ai-coach.ts), so a newer ISO edition or a vendor sunset should
// surface within a month of someone revisiting the sub-parameter. Users can
// still force-refresh any card manually via the Regenerate control when they
// want the absolute latest without waiting for TTL.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Normalize free-text productType to a stable key: trimmed, lowercased,
// collapsed whitespace → hyphens, punctuation stripped. "Medical Device" and
// "  medical device " both resolve to "medical-device".
export function normalizeProductTypeKey(raw?: string | null): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return 'general-hardware';
  return (
    s
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'general-hardware'
  );
}

function docIdFor(
  subItemId: string,
  productTypeKey: string,
  standardsKey: string
): string {
  // standardsKey === 'none' for projects that opted out of picking standards,
  // so those projects share a single cache doc per (subItem, productType).
  return `${subItemId}__${productTypeKey}__${standardsKey}`;
}

export async function fetchCoachAdvice(
  input: CoachFetchInput
): Promise<CoachAdvice> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');

  const productTypeKey = normalizeProductTypeKey(input.productType);
  const standardsKey = standardsCacheKey(input.standards);
  const cacheId = docIdFor(input.subItemId, productTypeKey, standardsKey);
  const cacheRef = doc(db, 'coachAdvice', cacheId);

  // --- Cache read -----------------------------------------------------------
  if (!input.forceRefresh) {
    try {
      const snap = await getDoc(cacheRef);
      if (snap.exists()) {
        const data = snap.data() as any;
        const payload = data?.payload as CoachAdvice | undefined;
        const generatedAtMs =
          payload?.generatedAt ||
          (data?.generatedAt instanceof Timestamp
            ? data.generatedAt.toMillis()
            : 0);
        const fresh = Date.now() - generatedAtMs < CACHE_TTL_MS;
        if (payload && fresh) {
          return payload;
        }
      }
    } catch (err) {
      // Cache read failure is non-fatal — fall through to network fetch.
      console.warn('coach cache read failed:', err);
    }
  }

  // --- Network fetch --------------------------------------------------------
  const idToken = await user.getIdToken(false);
  const res = await fetch('/api/ai-coach', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      subItemId: input.subItemId,
      subItemTitle: input.subItemTitle,
      subItemDefinition: input.subItemDefinition,
      subItemTool: input.subItemTool,
      groupTitle: input.groupTitle,
      productType: input.productType || 'General Hardware',
      standards: Array.isArray(input.standards) ? input.standards : []
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({} as any));
    // Surface the upstream detail when the server returned one so errors like
    // 'model not found' or 'quota exceeded' reach the user instead of 'ai
    // service error'. The server already sanitized the string.
    const baseMsg = data?.error || `Coach request failed (${res.status})`;
    const combined = data?.detail ? `${baseMsg} — ${data.detail}` : baseMsg;
    throw new Error(combined);
  }

  const payload = (await res.json()) as CoachAdvice;

  // --- Cache write (best-effort; never block) -------------------------------
  try {
    await setDoc(cacheRef, {
      subItemId: input.subItemId,
      subItemTitle: input.subItemTitle,
      productType: input.productType,
      productTypeKey,
      standards: Array.isArray(input.standards) ? input.standards : [],
      standardsKey,
      payload,
      modelVersion: payload.modelVersion,
      generatedAt: serverTimestamp(),
      generatedBy: user.uid,
      refreshCount: input.forceRefresh ? 1 : 0
    });
  } catch (err) {
    console.warn('coach cache write failed:', err);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Feedback writes — append-only, no cache invalidation. Admin reviews these
// periodically and decides whether to hand-edit the cached advice doc.
// ---------------------------------------------------------------------------

export type CoachFeedbackKind = 'up' | 'down';

export async function submitCoachFeedback(args: {
  subItemId: string;
  productType: string;
  kind: CoachFeedbackKind;
  reason?: string;
  payload: CoachAdvice;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const productTypeKey = normalizeProductTypeKey(args.productType);
  await addDoc(collection(db, 'coachFeedback'), {
    subItemId: args.subItemId,
    productType: args.productType,
    productTypeKey,
    kind: args.kind,
    reason: args.reason || '',
    payload: args.payload,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
}
