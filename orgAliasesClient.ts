// ---------------------------------------------------------------------------
// orgAliasesClient.ts
//
// Manages user-defined entity aliases stored in orgSettings/{userId}.
// Used by org-insights to normalize supplier / component names across projects
// so "ACME Corp" and "Acme Electronics" are recognized as the same entity.
//
// Doc shape: { entityAliases: Record<canonical, string[]> }
//   canonical — the preferred display name
//   string[]  — other names that refer to the same entity
// ---------------------------------------------------------------------------

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Firestore
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map from canonical name → list of aliases (other names for the same entity). */
export type EntityAliasMap = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadEntityAliases(
  db: Firestore,
  userId: string
): Promise<EntityAliasMap> {
  try {
    const snap = await getDoc(doc(db, 'orgSettings', userId));
    if (!snap.exists()) return {};
    const data = snap.data();
    return (data?.entityAliases as EntityAliasMap) ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Save (full replace — always write the whole map)
// ---------------------------------------------------------------------------

export async function saveEntityAliases(
  db: Firestore,
  userId: string,
  aliases: EntityAliasMap
): Promise<void> {
  await setDoc(
    doc(db, 'orgSettings', userId),
    { entityAliases: aliases, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
