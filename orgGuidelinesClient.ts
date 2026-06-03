// ---------------------------------------------------------------------------
// orgGuidelinesClient — CRUD for company guidelines stored in Firestore.
// Each doc represents one uploaded SOP/guideline PDF after extraction.
//
// Collection: orgGuidelines
// Doc shape: { userId, fileName, summary, requirements[], uploadedAtMs, active }
//
// Extraction flow:
//   1. Client uploads PDF to Vercel Blob via /api/guidelines-upload-token
//   2. Client calls /api/guidelines-extract with the Blob URL
//   3. Server returns { requirements[], summary }
//   4. Client saves the extracted data here (Blob is deleted server-side)
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
  serverTimestamp,
  Firestore
} from 'firebase/firestore';
import { upload } from '@vercel/blob/client';
import { auth } from './firebase.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuidelineCategory =
  | 'design_control'
  | 'process_control'
  | 'quality'
  | 'supplier'
  | 'documentation'
  | 'regulatory'
  | 'safety'
  | 'validation'
  | 'other';

export type GuidelineSeverity = 'critical' | 'major' | 'standard';

export interface GuidelineRequirement {
  id: string;
  text: string;                // ≤120 chars — the actionable requirement
  category: GuidelineCategory;
  severity: GuidelineSeverity;
}

export interface OrgGuideline {
  id: string;                  // Firestore doc id
  userId: string;
  fileName: string;            // original PDF filename
  summary: string;             // ≤200 chars — what the doc covers
  requirements: GuidelineRequirement[];
  uploadedAtMs: number;
}

// ---------------------------------------------------------------------------
// Load all guidelines for the current user (for AI Analysis)
// ---------------------------------------------------------------------------

export async function loadOrgGuidelines(db: Firestore, userId: string): Promise<OrgGuideline[]> {
  if (!userId) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'orgGuidelines'),
      where('userId', '==', userId),
      orderBy('uploadedAtMs', 'desc')
    ));
    return snap.docs.map(d => ({ ...d.data() as Omit<OrgGuideline, 'id'>, id: d.id }));
  } catch (e) {
    console.warn('[orgGuidelinesClient] load failed', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Save extracted guideline to Firestore
// ---------------------------------------------------------------------------

export async function saveOrgGuideline(
  db: Firestore,
  userId: string,
  fileName: string,
  summary: string,
  requirements: GuidelineRequirement[]
): Promise<string> {
  const ref = await addDoc(collection(db, 'orgGuidelines'), {
    userId,
    fileName,
    summary,
    requirements,
    uploadedAtMs: Date.now(),
    createdAt: serverTimestamp()
  });
  return ref.id;
}

// ---------------------------------------------------------------------------
// Delete a guideline
// ---------------------------------------------------------------------------

export async function deleteOrgGuideline(db: Firestore, docId: string): Promise<void> {
  await deleteDoc(doc(db, 'orgGuidelines', docId));
}

// ---------------------------------------------------------------------------
// Upload PDF → extract requirements → save to Firestore.
// Returns the saved guideline id.
// ---------------------------------------------------------------------------

export async function uploadAndExtractGuideline(
  db: Firestore,
  file: File
): Promise<OrgGuideline> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const idToken = await user.getIdToken();

  // Step 1: Upload PDF to Vercel Blob via client upload
  const blobResult = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/guidelines-upload-token',
    clientPayload: idToken
  });

  // Step 2: Extract requirements from PDF
  const extractRes = await fetch('/api/guidelines-extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ blobUrl: blobResult.url, fileName: file.name })
  });

  if (!extractRes.ok) {
    const err = await extractRes.json().catch(() => ({ error: 'extraction failed' }));
    throw new Error(err.error ?? 'extraction failed');
  }

  const { requirements, summary } = await extractRes.json() as {
    requirements: GuidelineRequirement[];
    summary: string;
  };

  // Step 3: Save to Firestore
  const docId = await saveOrgGuideline(db, user.uid, file.name, summary, requirements);

  return {
    id: docId,
    userId: user.uid,
    fileName: file.name,
    summary,
    requirements,
    uploadedAtMs: Date.now()
  };
}
