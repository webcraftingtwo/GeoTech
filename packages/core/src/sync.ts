/**
 * Synchronisation protocol (§5, §30).
 *
 * The contract between device and server, defined once and imported by both.
 *
 * Two invariants hold everywhere in this file:
 *
 *  1. **Nothing is ever discarded.** A failed sync returns the record to the
 *     queue. A conflicted record is parked for a human. There is no path from
 *     "captured underground" to "gone".
 *  2. **`localId` is the idempotency key.** Replaying a batch — after a dropped
 *     connection, a device restart, a cage ride through a dead zone — cannot
 *     create a second copy of a geological observation.
 */

import type { EntityType, SyncState } from './types.js';

export type SyncOperationType = 'CREATE' | 'UPDATE';

export interface SyncOperation {
  localId: string;
  entityType: EntityType;
  op: SyncOperationType;
  /** Device-side version at the time the operation was queued. */
  clientVersion: number;
  /** Server version the device last saw; absent for a create. */
  baseVersion?: number | null;
  payload: Record<string, unknown>;
  queuedAt: string;
}

export interface SyncBatch {
  batchId: string;
  deviceId: string;
  /** Device clock at send time — kept so drift can be measured, not trusted. */
  sentAt: string;
  operations: SyncOperation[];
}

export type SyncOperationStatus = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED' | 'FAILED';

export interface SyncOperationResult {
  localId: string;
  status: SyncOperationStatus;
  serverId?: string;
  /** Definitive record identifier, replacing any provisional one. */
  recordId?: string;
  serverVersion?: number;
  message?: string;
  conflict?: SyncConflict;
}

export interface SyncConflict {
  entityType: EntityType;
  localId: string;
  serverId: string;
  /** What the device believes. Preserved exactly. */
  localVersion: Record<string, unknown>;
  /** What the server holds. Preserved exactly. */
  serverVersion: Record<string, unknown>;
  /** Fields that differ, so a reviewer is not asked to diff two JSON blobs. */
  conflictingFields: string[];
  detectedAt: string;
}

export interface SyncBatchResult {
  batchId: string;
  receivedAt: string;
  results: SyncOperationResult[];
}

/* ── state machine (§5) ───────────────────────────────────────────────── */

const TRANSITIONS: Record<SyncState, SyncState[]> = {
  DRAFT: ['DRAFT', 'LOCAL_SAVED'],
  LOCAL_SAVED: ['LOCAL_SAVED', 'DRAFT', 'PENDING_SYNC'],
  PENDING_SYNC: ['SYNCING', 'PENDING_SYNC', 'LOCAL_SAVED'],
  SYNCING: ['SYNCED', 'SYNC_FAILED', 'REQUIRES_REVIEW'],
  SYNC_FAILED: ['PENDING_SYNC', 'SYNCING'],
  REQUIRES_REVIEW: ['PENDING_SYNC', 'SYNCED'],
  SYNCED: ['PENDING_SYNC'],
};

export function canTransition(from: SyncState, to: SyncState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextState(current: SyncState, outcome: SyncOperationStatus): SyncState {
  switch (outcome) {
    case 'APPLIED':
    case 'DUPLICATE':
      return 'SYNCED';
    case 'CONFLICT':
      return 'REQUIRES_REVIEW';
    case 'REJECTED':
    case 'FAILED':
      return 'SYNC_FAILED';
    default:
      return current;
  }
}

/** States whose records still owe the server something. */
export const OUTSTANDING_STATES: readonly SyncState[] = [
  'LOCAL_SAVED',
  'PENDING_SYNC',
  'SYNCING',
  'SYNC_FAILED',
  'REQUIRES_REVIEW',
];

export function isOutstanding(state: SyncState): boolean {
  return OUTSTANDING_STATES.includes(state);
}

/* ── retry policy ─────────────────────────────────────────────────────── */

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Jitter fraction, so a shaft full of devices does not retry in lockstep. */
  jitter?: number;
  random?: () => number;
}

/**
 * Exponential backoff, capped. There is deliberately **no attempt limit**: a
 * record that has failed a hundred times is still a geological observation
 * somebody walked underground to make, and it keeps trying until it lands or a
 * person intervenes.
 */
export function backoffDelayMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 2000;
  const max = opts.maxMs ?? 5 * 60 * 1000;
  const jitter = opts.jitter ?? 0.2;
  const rand = opts.random ?? Math.random;
  const raw = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
  const spread = raw * jitter;
  return Math.round(raw - spread + rand() * spread * 2);
}

/* ── conflict detection ───────────────────────────────────────────────── */

/**
 * A conflict exists when the device edited a record from a base version the
 * server has since moved past. The resolution is never automatic: geological
 * observations are not last-write-wins.
 */
export function detectConflict(args: {
  baseVersion?: number | null;
  serverVersion: number;
}): boolean {
  if (args.baseVersion === null || args.baseVersion === undefined) return false;
  return args.baseVersion !== args.serverVersion;
}

export function conflictingFields(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  ignore: string[] = ['updatedAt', 'version', 'syncState', 'syncAttempts', 'syncError'],
): string[] {
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const out: string[] = [];
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    if (JSON.stringify(local[key]) !== JSON.stringify(server[key])) out.push(key);
  }
  return out.sort();
}

/* ── the line the technician actually reads ───────────────────────────── */

export interface SyncSummary {
  online: boolean;
  pending: number;
  failed: number;
  conflicts: number;
  syncing: number;
  lastSyncedAt?: string | null;
}

/**
 * Produces the header text, e.g. `OFFLINE — 7 records waiting to sync`.
 * Deliberately plain: it must be readable at a glance, in a headlamp beam, by
 * someone who is not thinking about software.
 */
export function describeSyncStatus(s: SyncSummary): string {
  const outstanding = s.pending + s.failed + s.syncing;
  if (s.conflicts > 0) {
    const c = `${s.conflicts} record${s.conflicts === 1 ? '' : 's'} need${s.conflicts === 1 ? 's' : ''} review`;
    return outstanding > 0 ? `${c} · ${outstanding} waiting to sync` : c;
  }
  if (!s.online) {
    return outstanding > 0
      ? `OFFLINE — ${outstanding} record${outstanding === 1 ? '' : 's'} waiting to sync`
      : 'OFFLINE — everything saved';
  }
  if (s.syncing > 0) return `Syncing ${s.syncing} record${s.syncing === 1 ? '' : 's'}…`;
  if (outstanding > 0) return `${outstanding} record${outstanding === 1 ? '' : 's'} waiting to sync`;
  return 'All records synced';
}

/**
 * Failure text shown to the technician. Never "Something went wrong" — it says
 * what happened to their data and what will happen next (§42).
 */
export function describeSyncFailure(attempts: number, nextRetryMs: number): string {
  const mins = Math.round(nextRetryMs / 60000);
  const when = nextRetryMs < 60000 ? `in ${Math.round(nextRetryMs / 1000)} seconds` : `in about ${mins} minute${mins === 1 ? '' : 's'}`;
  return `Saved locally. Synchronisation will retry ${when}${attempts > 1 ? ` (attempt ${attempts})` : ''}. Nothing has been lost.`;
}
