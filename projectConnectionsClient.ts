// ---------------------------------------------------------------------------
// projectConnectionsClient — CRUD for directed project connections.
//
// Data model: `projectConnections` collection, one doc per directed edge.
//   { sourceProjectId, targetProjectId, userId, label?, connectedAtMs }
//
// One-way  (A → B):  one doc: source=A, target=B
// Both-ways (A ↔ B): two docs: source=A,target=B  +  source=B,target=A
//
// Queries used:
//   - loadOutboundConnections(projectId): sourceProjectId == projectId
//     → "which projects does this one connect TO?"
//   - connectedProjectIds(projectId):  helper that returns just the IDs
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from './firebase.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectConnection {
  id: string;           // Firestore doc ID
  sourceProjectId: string;
  targetProjectId: string;
  userId: string;
  label?: string;       // e.g. "Parent Program", "Supplier Project"
  connectedAtMs: number;
}

/** Minimal project info for the picker dropdown. */
export interface ProjectStub {
  id: string;
  name: string;
  productType?: string;
  currentGate?: string;
  templateId?: string;
  status: 'active' | 'archived';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Returns all outbound connections from `sourceProjectId` (A → ?). */
export async function loadOutboundConnections(
  sourceProjectId: string
): Promise<ProjectConnection[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(
    query(
      collection(db, 'projectConnections'),
      where('userId', '==', uid),
      where('sourceProjectId', '==', sourceProjectId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProjectConnection, 'id'>) }));
}

/** Returns the set of projectIds this project connects TO. */
export async function connectedProjectIds(sourceProjectId: string): Promise<string[]> {
  const conns = await loadOutboundConnections(sourceProjectId);
  return conns.map((c) => c.targetProjectId);
}

/** Returns all projects owned by the current user (for the picker). */
export async function loadUserProjects(): Promise<ProjectStub[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(
    query(
      collection(db, 'projects'),
      where('userId', '==', uid)
    )
  );
  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      name: String(data.name || 'Untitled'),
      productType: data.productType || undefined,
      currentGate: data.currentGate || undefined,
      templateId: data.templateId || undefined,
      status: data.status || 'active'
    };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Add a one-way connection (source → target).
 * Returns the new connection object.
 */
export async function addConnection(
  sourceProjectId: string,
  targetProjectId: string,
  label?: string
): Promise<ProjectConnection> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const payload = {
    sourceProjectId,
    targetProjectId,
    userId: uid,
    connectedAtMs: Date.now(),
    ...(label ? { label } : {}),
    createdAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, 'projectConnections'), payload);
  return { id: ref.id, sourceProjectId, targetProjectId, userId: uid, label, connectedAtMs: payload.connectedAtMs };
}

/**
 * Add a both-ways connection (A ↔ B) atomically.
 * Creates two docs in a single batch.
 */
export async function addBidirectionalConnection(
  projectIdA: string,
  projectIdB: string,
  label?: string
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  const now = Date.now();
  const batch = writeBatch(db);
  const basePayload = {
    userId: uid,
    connectedAtMs: now,
    ...(label ? { label } : {}),
    createdAt: serverTimestamp()
  };
  batch.set(doc(collection(db, 'projectConnections')), {
    ...basePayload,
    sourceProjectId: projectIdA,
    targetProjectId: projectIdB
  });
  batch.set(doc(collection(db, 'projectConnections')), {
    ...basePayload,
    sourceProjectId: projectIdB,
    targetProjectId: projectIdA
  });
  await batch.commit();
}

/**
 * Remove a connection by its doc ID.
 * For both-ways connections, call removeConnection for the reverse edge too,
 * or use removeBidirectionalConnection() below.
 */
export async function removeConnection(connectionId: string): Promise<void> {
  await deleteDoc(doc(db, 'projectConnections', connectionId));
}

/**
 * Remove all edges between two projects in both directions.
 * Safe to call even if only one direction exists.
 */
export async function removeBidirectionalConnection(
  projectIdA: string,
  projectIdB: string
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  // Find docs in both directions
  const [fwd, rev] = await Promise.all([
    getDocs(query(
      collection(db, 'projectConnections'),
      where('userId', '==', uid),
      where('sourceProjectId', '==', projectIdA),
      where('targetProjectId', '==', projectIdB)
    )),
    getDocs(query(
      collection(db, 'projectConnections'),
      where('userId', '==', uid),
      where('sourceProjectId', '==', projectIdB),
      where('targetProjectId', '==', projectIdA)
    ))
  ]);
  const batch = writeBatch(db);
  [...fwd.docs, ...rev.docs].forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
