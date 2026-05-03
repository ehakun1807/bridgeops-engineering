// ---------------------------------------------------------------------------
// DocGuard front-end client.
//   - auditPdf(): uploads PDF base64 to /api/docguard, returns findings.
//   - listAudits() / saveAudit() / deleteAudit(): Firestore CRUD on the
//     docGuardAudits collection (userId-scoped).
//
// Findings/Summary types live in utils/docGuardPdf.ts so the PDF builder
// and the API client share one shape.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './firebase.ts';
import type {
  Finding,
  AuditSummary,
  FindingCategory,
  FindingSeverity
} from './utils/docGuardPdfHelpers.ts';

export interface AuditResponse {
  findings: Finding[];
  summary: AuditSummary;
  generatedAt: number;
}

export interface SavedAudit extends AuditResponse {
  id: string;
  userId: string;
  fileName: string;
  fileSizeBytes: number;
  createdAtMs: number; // mirror of serverTimestamp for sorting before snapshot resolves
}

/** Convert a File to base64 (no data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:application/pdf;base64," prefix.
      const idx = result.indexOf('base64,');
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Audit a PDF via the serverless function. */
export async function auditPdf(file: File): Promise<AuditResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const idToken = await user.getIdToken(false);
  const pdfBase64 = await fileToBase64(file);

  const res = await fetch('/api/docguard', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ pdfBase64, fileName: file.name })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `DocGuard request failed (${res.status})`);
  }
  return (await res.json()) as AuditResponse;
}

/** Save an audit result to Firestore (userId-scoped). */
export async function saveAudit(
  fileName: string,
  fileSizeBytes: number,
  result: AuditResponse
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');

  const ref = await addDoc(collection(db, 'docGuardAudits'), {
    userId: user.uid,
    fileName,
    fileSizeBytes,
    findings: result.findings,
    summary: result.summary,
    generatedAtMs: result.generatedAt,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp()
  });
  return ref.id;
}

/** List all audits for the current user, newest first. */
export async function listAudits(): Promise<SavedAudit[]> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');

  // Per the firestore.rules pattern (see projects/scores/taktStudies):
  // list rule is authenticated-only because isAdmin() can't run on list
  // queries; client must include userId filter for isolation.
  const q = query(
    collection(db, 'docGuardAudits'),
    where('userId', '==', user.uid),
    orderBy('createdAtMs', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      userId: data.userId,
      fileName: data.fileName || 'document.pdf',
      fileSizeBytes: Number(data.fileSizeBytes) || 0,
      findings: normalizeFindings(data.findings),
      summary: normalizeSummary(data.summary),
      generatedAt: Number(data.generatedAtMs) || 0,
      createdAtMs: Number(data.createdAtMs) || 0
    };
  });
}

export async function deleteAudit(id: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  await deleteDoc(doc(db, 'docGuardAudits', id));
}

// ---------------------------------------------------------------------------
// Defensive normalizers — Firestore-stored data may have drifted.
// ---------------------------------------------------------------------------

const CATEGORIES: FindingCategory[] = ['grammar', 'gmp', 'logic', 'image', 'numbering'];
const SEVERITIES: FindingSeverity[] = ['high', 'medium', 'low'];

function normalizeFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      page: Math.max(1, Math.floor(Number(f.page) || 1)),
      category: CATEGORIES.includes(f.category as FindingCategory)
        ? (f.category as FindingCategory)
        : 'gmp',
      severity: SEVERITIES.includes(f.severity as FindingSeverity)
        ? (f.severity as FindingSeverity)
        : 'medium',
      comment: String(f.comment || '').slice(0, 200),
      quote: f.quote ? String(f.quote).slice(0, 80) : undefined
    }));
}

function normalizeSummary(raw: unknown): AuditSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const verdict = r.overallVerdict;
  return {
    pageCount: Math.max(1, Math.floor(Number(r.pageCount) || 1)),
    overallVerdict:
      verdict === 'pass' || verdict === 'minor_issues' || verdict === 'major_issues'
        ? verdict
        : 'minor_issues',
    headline: String(r.headline || '').slice(0, 200)
  };
}
