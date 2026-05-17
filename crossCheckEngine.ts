// ---------------------------------------------------------------------------
// crossCheckEngine.ts — Layer 2: Proactive cross-tool intelligence.
//
// Three async functions that detect conflicts between tools:
//
//   1. checkPfmeaVsBom   — high-RPN PFMEA risk vs. recently changed BOM parts
//   2. checkDecisionVsPfmea — reversed decision vs. active PFMEA risks
//   3. checkBomVsDecisions  — BOM supplier swap vs. active decisions
//
// All functions are fire-and-forget safe (non-fatal errors return null).
// Results drive CrossCheckBanner inside each tool — no AI calls, pure text
// matching so results are instant.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Firestore
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface CrossCheckMatch {
  /** Short identifier shown in the banner (part PN, risk title, decision title). */
  label: string;
  /** One-line reason why it matched. */
  snippet: string;
}

export interface CrossCheckResult {
  /** Short headline for the banner title. */
  headline: string;
  /** One-sentence detail. */
  detail: string;
  /** The specific conflicts found. */
  matches: CrossCheckMatch[];
}

// ---------------------------------------------------------------------------
// Text-matching utility
// Tokenises two strings to lowercase words ≥4 chars and counts shared tokens.
// Same approach as PFMEATool's decisionMatchScore — threshold ≥ 2 = match.
// ---------------------------------------------------------------------------

function tokenize(s: string): string[] {
  return (s ?? '').toLowerCase().match(/\b[a-z0-9]{4,}\b/g) ?? [];
}

function overlapScore(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  return tokenize(b).filter((w) => setA.has(w)).length;
}

const MATCH_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// 1. checkPfmeaVsBom
//
// Triggered: after PFMEATool saves and high-RPN risks (RPN > 100) exist.
// Logic: fetch the 2 most-recent BOM revisions, diff them by internalPn to
// find changed / swapped parts. Tokenise each risk's (cause + processStep +
// failureMode) against each changed part's (internalPn + description +
// manufacturer + mpn). Surface matches.
// ---------------------------------------------------------------------------

interface HighRisk {
  processStep: string;
  failureMode: string;
  cause: string;
  rpn: number;
}

interface PartRef {
  internalPn: string;
  description: string;
  manufacturer: string;
  mpn: string;
}

export async function checkPfmeaVsBom(
  db: Firestore,
  userId: string,
  projectId: string,
  highRisks: HighRisk[]
): Promise<CrossCheckResult | null> {
  if (highRisks.length === 0) return null;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'productBoms'),
        where('userId', '==', userId),
        where('projectId', '==', projectId),
        orderBy('uploadedAtMs', 'desc'),
        limit(2)
      )
    );
    if (snap.docs.length < 2) return null; // need at least 2 revisions to detect changes

    const newBom  = snap.docs[0].data() as any;
    const prevBom = snap.docs[1].data() as any;
    const newLines:  PartRef[] = (newBom.lines  ?? []).map(lineToPartRef);
    const prevLines: PartRef[] = (prevBom.lines ?? []).map(lineToPartRef);

    // Build a lookup of changed parts: appear in prev with different mfr/mpn/desc.
    const prevMap = new Map<string, PartRef>();
    for (const l of prevLines) {
      const key = l.internalPn || l.mpn;
      if (key) prevMap.set(key.toLowerCase(), l);
    }
    const changedParts: PartRef[] = [];
    for (const l of newLines) {
      const key = (l.internalPn || l.mpn)?.toLowerCase();
      if (!key) continue;
      const prev = prevMap.get(key);
      if (!prev) continue; // new part — not a "change" in the cross-check sense
      if (
        l.manufacturer !== prev.manufacturer ||
        l.mpn         !== prev.mpn         ||
        l.description  !== prev.description
      ) {
        changedParts.push(l);
      }
    }
    if (changedParts.length === 0) return null;

    // Match each high-risk against changed parts.
    const matches: CrossCheckMatch[] = [];
    for (const risk of highRisks) {
      const riskText = [risk.cause, risk.processStep, risk.failureMode].join(' ');
      for (const part of changedParts) {
        const partText = [part.internalPn, part.description, part.manufacturer, part.mpn].join(' ');
        if (overlapScore(riskText, partText) >= MATCH_THRESHOLD) {
          const label = part.internalPn || part.description || part.mpn || 'Unknown part';
          if (!matches.find((m) => m.label === label)) {
            matches.push({
              label,
              snippet: `Risk: "${(risk.failureMode || risk.processStep).slice(0, 60)}" — RPN ${risk.rpn}`
            });
          }
        }
      }
    }
    if (matches.length === 0) return null;

    return {
      headline: `BOM conflict — ${matches.length} recently changed part${matches.length === 1 ? '' : 's'} may relate to your high-RPN risks`,
      detail: `The latest BOM revision changed ${changedParts.length} part${changedParts.length === 1 ? '' : 's'}. ${matches.length} appear${matches.length === 1 ? 's' : ''} in your high-RPN risk causes — verify the changes don't invalidate your process controls.`,
      matches
    };
  } catch (e) {
    console.warn('[crossCheckEngine] checkPfmeaVsBom failed', e);
    return null;
  }
}

function lineToPartRef(l: any): PartRef {
  return {
    internalPn:   String(l.internalPn   ?? ''),
    description:  String(l.description  ?? ''),
    manufacturer: String(l.manufacturer ?? ''),
    mpn:          String(l.mpn          ?? '')
  };
}

// ---------------------------------------------------------------------------
// 2. checkDecisionVsPfmea
//
// Triggered: after DecisionLedgerTool saves with status = 'reversed'.
// Logic: fetch recent PFMEAs, flatten all risks. Tokenise the reversed
// decision's (title + description + relatedRisks) against each risk's
// (cause + processStep + failureMode). Surface matches.
// ---------------------------------------------------------------------------

interface ReversedDecision {
  title: string;
  description: string;
  relatedRisks: string;
}

interface RiskRef {
  pfmeaTitle: string;
  processStep: string;
  failureMode: string;
  cause: string;
  rpn: number;
}

export async function checkDecisionVsPfmea(
  db: Firestore,
  userId: string,
  projectId: string,
  decision: ReversedDecision
): Promise<CrossCheckResult | null> {
  const decisionText = [decision.title, decision.description, decision.relatedRisks].join(' ');
  if (tokenize(decisionText).length < 2) return null;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'pfmeas'),
        where('userId', '==', userId),
        where('projectId', '==', projectId),
        orderBy('dateMs', 'desc'),
        limit(3)
      )
    );
    if (snap.empty) return null;

    // Flatten all risks across recent PFMEAs.
    const allRisks: RiskRef[] = [];
    for (const d of snap.docs) {
      const data = d.data() as any;
      const title = String(data.title ?? 'Untitled PFMEA');
      const risks: any[] = Array.isArray(data.risks) ? data.risks : [];
      for (const r of risks) {
        allRisks.push({
          pfmeaTitle:  title,
          processStep: String(r.processStep ?? ''),
          failureMode: String(r.failureMode ?? ''),
          cause:       String(r.cause ?? ''),
          rpn: (r.severity ?? 1) * (r.occurrence ?? 1) * (r.detection ?? 1)
        });
      }
    }
    if (allRisks.length === 0) return null;

    const matches: CrossCheckMatch[] = [];
    for (const risk of allRisks) {
      const riskText = [risk.cause, risk.processStep, risk.failureMode].join(' ');
      if (overlapScore(decisionText, riskText) >= MATCH_THRESHOLD) {
        const label = (risk.failureMode || risk.processStep || 'Risk').slice(0, 60);
        if (!matches.find((m) => m.label === label)) {
          matches.push({
            label,
            snippet: `In "${risk.pfmeaTitle}" · RPN ${risk.rpn}`
          });
        }
      }
    }
    if (matches.length === 0) return null;

    return {
      headline: `Decision reversal conflicts with ${matches.length} PFMEA risk${matches.length === 1 ? '' : 's'}`,
      detail: `The reversed decision "${decision.title.slice(0, 60)}" overlaps with ${matches.length} risk${matches.length === 1 ? '' : 's'} in your PFMEA. These risks may have been mitigated based on the now-reversed decision — review your controls.`,
      matches
    };
  } catch (e) {
    console.warn('[crossCheckEngine] checkDecisionVsPfmea failed', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. checkBomVsDecisions
//
// Triggered: after ProductBomTool saves a new revision that has supplier swaps
// (changed.kinds includes 'manufacturer').
// Logic: receive the swapped parts (after-state BomLine shape). Fetch active
// supplier + commercial decisions. Tokenise each swapped part's
// (internalPn + description + manufacturer + mpn) against each decision's
// (title + description + relatedRisks). Surface conflicts.
// ---------------------------------------------------------------------------

interface SwappedPart {
  internalPn?: string;
  description?: string;
  manufacturer?: string;
  mpn?: string;
}

interface ActiveDecision {
  id: string;
  title: string;
  description: string;
  relatedRisks: string;
  category: string;
}

export async function checkBomVsDecisions(
  db: Firestore,
  userId: string,
  projectId: string,
  swappedParts: SwappedPart[]
): Promise<CrossCheckResult | null> {
  if (swappedParts.length === 0) return null;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'decisions'),
        where('userId',    '==', userId),
        where('projectId', '==', projectId),
        where('status',    '==', 'active'),
        orderBy('dateMs', 'desc'),
        limit(20)
      )
    );
    if (snap.empty) return null;

    const decisions: ActiveDecision[] = snap.docs
      .map((d) => {
        const data = d.data() as any;
        return {
          id:           d.id,
          title:        String(data.title        ?? ''),
          description:  String(data.description  ?? ''),
          relatedRisks: String(data.relatedRisks ?? ''),
          category:     String(data.category     ?? 'other')
        };
      })
      // Prioritise supplier/commercial decisions for performance
      .sort((a, b) => {
        const score = (c: string) => (c === 'supplier' || c === 'commercial' ? 1 : 0);
        return score(b.category) - score(a.category);
      });

    const matches: CrossCheckMatch[] = [];
    for (const part of swappedParts) {
      const partText = [part.internalPn, part.description, part.manufacturer, part.mpn]
        .filter(Boolean)
        .join(' ');
      if (!partText.trim()) continue;

      for (const dec of decisions) {
        const decText = [dec.title, dec.description, dec.relatedRisks].join(' ');
        if (overlapScore(partText, decText) >= MATCH_THRESHOLD) {
          const partLabel = (part.internalPn || part.description || part.mpn || 'Unknown part').slice(0, 50);
          const key = `${partLabel}::${dec.title}`;
          if (!matches.find((m) => m.label === key)) {
            matches.push({
              label: partLabel,
              snippet: `May conflict with decision: "${dec.title.slice(0, 60)}"`
            });
          }
        }
      }
    }
    if (matches.length === 0) return null;

    return {
      headline: `Supplier swap may conflict with ${matches.length} active decision${matches.length === 1 ? '' : 's'}`,
      detail: `${swappedParts.length} supplier-swapped part${swappedParts.length === 1 ? '' : 's'} in this BOM revision overlap${swappedParts.length === 1 ? 's' : ''} with active decisions. Verify the swap doesn't contradict a locked-in supplier or qualification decision.`,
      matches
    };
  } catch (e) {
    console.warn('[crossCheckEngine] checkBomVsDecisions failed', e);
    return null;
  }
}
