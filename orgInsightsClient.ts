// ---------------------------------------------------------------------------
// orgInsightsClient.ts
//
// Client-side wrapper for /api/org-insights.
// Reads all projectIntelligence docs for the user from Firestore, then POSTs
// them to the handler for cross-project Gemini analysis.
// ---------------------------------------------------------------------------

import { collection, query, where, getDocs, Firestore } from 'firebase/firestore';
import { User } from 'firebase/auth';

// ---------------------------------------------------------------------------
// Types — mirror api/org-insights.ts input + output shapes.
// ---------------------------------------------------------------------------

export interface ProjectSnapshot {
  projectId: string;
  projectName: string;
  analyzedAtMs: number;
  currentGate?: string;
  overallScore?: number;
  statusSnapshot?: string;
  risks?: Array<{ flag: string; source: string; severity: 'high' | 'medium' | 'low' }>;
  topActions?: Array<{ title: string; rationale: string; impact: 'high' | 'medium' | 'low' }>;
}

export interface OrgPattern {
  title: string;
  description: string;
  affectedProjects: string[];
  category: 'supplier' | 'process' | 'quality' | 'schedule' | 'design' | 'commercial';
  severity: 'high' | 'medium' | 'low';
}

export interface RecurringRisk {
  description: string;
  occurrences: number;
  affectedProjects: string[];
}

export interface OrgRecommendation {
  action: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

export interface OrgInsights {
  patterns: OrgPattern[];
  recurringRisks: RecurringRisk[];
  recommendations: OrgRecommendation[];
  summary: string;
}

export interface OrgInsightsResult {
  insights: OrgInsights;
  projectCount: number;
  generatedAtMs: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Load all projectIntelligence docs for the current user from Firestore.
// Single-field query (userId only) — no composite index required.
// ---------------------------------------------------------------------------

export async function loadProjectSnapshots(
  db: Firestore,
  userId: string
): Promise<ProjectSnapshot[]> {
  const q = query(
    collection(db, 'projectIntelligence'),
    where('userId', '==', userId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    const analysis = data.analysis ?? {};
    return {
      projectId:      d.id,
      projectName:    data.projectName ?? data.projectId ?? d.id,
      analyzedAtMs:   data.analyzedAtMs ?? 0,
      currentGate:    data.currentGate,
      overallScore:   data.overallScore,
      statusSnapshot: analysis.statusSnapshot,
      risks:          analysis.risks,
      topActions:     analysis.topActions
    } as ProjectSnapshot;
  }).filter((p) => p.analyzedAtMs > 0); // only docs from real Analyze runs
}

// ---------------------------------------------------------------------------
// Call /api/org-insights with the loaded snapshots.
// ---------------------------------------------------------------------------

export async function fetchOrgInsights(
  db: Firestore,
  user: User
): Promise<OrgInsightsResult> {
  const snapshots = await loadProjectSnapshots(db, user.uid);

  if (snapshots.length === 0) {
    throw new Error('No AI Analysis results found — run a full project scan on at least one project first.');
  }

  const idToken = await user.getIdToken(false);

  const res = await fetch('/api/org-insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ projects: snapshots })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ?? `org-insights ${res.status}`;
    throw new Error(msg);
  }

  return res.json() as Promise<OrgInsightsResult>;
}
