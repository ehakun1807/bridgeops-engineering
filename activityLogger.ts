// ---------------------------------------------------------------------------
// activityLogger.ts — shared utility for writing projectActivity events.
//
// Every meaningful tool action (save, complete, delete, AI run, etc.) calls
// logActivity(). The resulting docs feed the Activity Feed panel and the
// future projectIntelligence incremental-update layer.
//
// Events are immutable (create-only). Re-running or re-saving a tool writes a
// NEW event — not an update — so the feed is a true append-only audit trail.
// ---------------------------------------------------------------------------

import { db } from './firebase.ts';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Event type catalogue — extend as new tools or signals are added.
// ---------------------------------------------------------------------------
export type ActivityEventType =
  // Takt Studies
  | 'takt_study_created'
  | 'takt_study_updated'
  | 'takt_study_completed'
  | 'takt_study_deleted'
  // Meetings
  | 'meeting_created'
  | 'meeting_updated'
  | 'meeting_deleted'
  // PFMEA
  | 'pfmea_created'
  | 'pfmea_updated'
  | 'pfmea_deleted'
  | 'pfmea_risk_high'          // synthetic: emitted when a risk >= High threshold is saved
  // Process Map
  | 'process_map_created'
  | 'process_map_updated'
  | 'process_map_deleted'
  // BOM Pulse
  | 'bom_uploaded'
  | 'bom_impact_analyzed'
  // Decision Ledger
  | 'decision_created'
  | 'decision_updated'
  | 'decision_reversed'
  | 'decision_deleted'
  // Doc Guard
  | 'doc_guard_run'
  // AI Analysis
  | 'ai_analysis_run';

// Which tool emitted the event — used for color coding and filtering in the Feed.
export type ActivityTool =
  | 'takt'
  | 'meetings'
  | 'pfmea'
  | 'process_map'
  | 'bom_pulse'
  | 'decisions'
  | 'doc_guard'
  | 'ai_analysis';

// ---------------------------------------------------------------------------
// ActivityEvent — the shape written to Firestore and read by the Feed.
// ---------------------------------------------------------------------------
export interface ActivityEvent {
  userId: string;
  projectId: string;
  eventType: ActivityEventType;
  tool: ActivityTool;
  /** Short headline shown in the feed row (≤ 80 chars). */
  title: string;
  /** Optional supporting detail shown as a sub-line (≤ 200 chars). */
  detail?: string;
  /** Arbitrary lightweight metadata (IDs, counts, etc.) — not shown directly. */
  metadata?: Record<string, string | number | boolean>;
  /** Client-side ms timestamp for instant sorting before Firestore ack. */
  timestampMs: number;
  // createdAt: serverTimestamp() added by logActivity()
}

// ---------------------------------------------------------------------------
// logActivity — fire-and-forget. Errors are non-fatal (console.warn only).
// Never awaited by callers so tool saves never block on the activity write.
// ---------------------------------------------------------------------------
export async function logActivity(event: ActivityEvent): Promise<void> {
  try {
    await addDoc(collection(db, 'projectActivity'), {
      ...event,
      detail:   event.detail?.slice(0, 200)   ?? null,
      title:    event.title.slice(0, 80),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[activityLogger] non-fatal write failure', e);
  }
}
