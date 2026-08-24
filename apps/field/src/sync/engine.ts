import {
  backoffDelayMs,
  describeSyncFailure,
  newLocalId,
  nextState,
  type SyncBatch,
  type SyncOperation,
  type SyncOperationStatus,
} from '@geotech/core';
import { ApiUnavailable, api } from '../api/client.js';
import { db, TABLE_FOR_ENTITY, type QueueItem } from '../db/database.js';
import { setSyncState } from '../db/repository.js';

/**
 * Background synchronisation.
 *
 * The rules this implements, in order of importance:
 *
 *  1. Data is never lost. A failure returns the record to the queue; a rejection
 *     parks it for the technician; neither deletes anything.
 *  2. The technician is never asked to sync. It happens when it can.
 *  3. A network failure and a server refusal are handled differently. Retrying
 *     a duplicate sample number forever would be pointless noise, so those
 *     records are marked as needing attention instead.
 */

export interface SyncStatus {
  online: boolean;
  running: boolean;
  pending: number;
  failed: number;
  blocked: number;
  conflicts: number;
  lastSyncedAt: string | null;
  lastMessage: string | null;
}

type Listener = (status: SyncStatus) => void;

const BATCH_SIZE = 50;

export class SyncEngine {
  private timer: number | null = null;
  private listeners = new Set<Listener>();
  private running = false;
  private status: SyncStatus = {
    online: navigator.onLine,
    running: false,
    pending: 0,
    failed: 0,
    blocked: 0,
    conflicts: 0,
    lastSyncedAt: null,
    lastMessage: null,
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<SyncStatus> = {}): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  start(): void {
    // Coming back into coverage is the moment that matters — sync immediately
    // rather than waiting for the next tick.
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    this.timer = window.setInterval(() => void this.syncNow(), 30_000);
    void this.refreshCounts();
    void this.syncNow();
  }

  stop(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private handleOnline = () => {
    this.emit({ online: true });
    void this.syncNow();
  };

  private handleOffline = () => {
    this.emit({ online: false, lastMessage: null });
  };

  async refreshCounts(): Promise<void> {
    const items = await db.queue.toArray();
    this.emit({
      pending: items.filter((i) => !i.blocked && i.attempts === 0).length,
      failed: items.filter((i) => !i.blocked && i.attempts > 0).length,
      blocked: items.filter((i) => i.blocked).length,
      conflicts: await db.faceLogs.where('syncState').equals('REQUIRES_REVIEW').count(),
    });
  }

  /** Safe to call at any time. Concurrent calls collapse into one. */
  async syncNow(): Promise<void> {
    if (this.running) return;
    const session = await db.session.get('session');
    if (!session) return;

    this.running = true;
    this.emit({ running: true });

    try {
      const now = Date.now();
      const due = (await db.queue.toArray())
        .filter((i) => !i.blocked && i.nextAttemptAt <= now)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
        .slice(0, BATCH_SIZE);

      if (due.length > 0) await this.sendBatch(due, session.deviceId);
      await this.uploadPhotos();
    } finally {
      this.running = false;
      this.emit({ running: false });
      await this.refreshCounts();
    }
  }

  private async sendBatch(items: QueueItem[], deviceId: string): Promise<void> {
    const operations: SyncOperation[] = [];
    const included: QueueItem[] = [];

    for (const item of items) {
      const table = TABLE_FOR_ENTITY[item.entityType];
      if (!table) continue;
      const record = await db.table(table).get(item.localId);
      if (!record) {
        // The record is gone but the queue entry survived — drop the orphan
        // rather than retrying an empty operation forever.
        if (item.id !== undefined) await db.queue.delete(item.id);
        continue;
      }
      await setSyncState(table, item.localId, 'SYNCING');
      operations.push({
        localId: item.localId,
        entityType: item.entityType as SyncOperation['entityType'],
        op: item.op,
        clientVersion: item.clientVersion,
        baseVersion: item.baseVersion ?? null,
        payload: record as Record<string, unknown>,
        queuedAt: item.queuedAt,
      });
      included.push(item);
    }

    if (operations.length === 0) return;

    const batch: SyncBatch = {
      batchId: newLocalId(),
      deviceId,
      sentAt: new Date().toISOString(),
      operations,
    };

    try {
      const result = await api.syncBatch(batch);
      for (const item of included) {
        const outcome = result.results.find((r) => r.localId === item.localId);
        await this.applyResult(item, outcome?.status ?? 'FAILED', outcome);
      }
      this.emit({ online: true, lastSyncedAt: new Date().toISOString(), lastMessage: null });
    } catch (err) {
      // No connection, or the server is unreachable. Everything goes back in
      // the queue with a longer wait; nothing is discarded.
      const unavailable = err instanceof ApiUnavailable;
      for (const item of included) {
        const table = TABLE_FOR_ENTITY[item.entityType]!;
        const attempts = item.attempts + 1;
        const delay = backoffDelayMs(attempts);
        await setSyncState(table, item.localId, 'SYNC_FAILED', {
          syncError: unavailable ? 'Waiting for a connection.' : (err as Error).message,
        });
        if (item.id !== undefined) {
          await db.queue.update(item.id, {
            attempts,
            nextAttemptAt: Date.now() + delay,
            lastError: (err as Error).message,
          });
        }
      }
      this.emit({
        online: !unavailable && navigator.onLine,
        lastMessage: describeSyncFailure(included[0]!.attempts + 1, backoffDelayMs(included[0]!.attempts + 1)),
      });
    }
  }

  private async applyResult(
    item: QueueItem,
    status: SyncOperationStatus,
    outcome?: { serverId?: string; recordId?: string; serverVersion?: number; message?: string; conflict?: unknown },
  ): Promise<void> {
    const table = TABLE_FOR_ENTITY[item.entityType]!;
    const state = nextState('SYNCING', status);

    if (status === 'APPLIED' || status === 'DUPLICATE') {
      await setSyncState(table, item.localId, state, {
        serverId: outcome?.serverId ?? null,
        // The definitive identifier replaces the provisional one minted offline.
        ...(outcome?.recordId ? { recordId: outcome.recordId } : {}),
        syncError: null,
      });
      if (item.id !== undefined) await db.queue.delete(item.id);
      return;
    }

    if (status === 'CONFLICT') {
      await setSyncState(table, item.localId, 'REQUIRES_REVIEW', {
        serverId: outcome?.serverId ?? null,
        syncError: outcome?.message ?? 'This record needs review before it can sync.',
        conflict: outcome?.conflict ?? null,
      });
      if (item.id !== undefined) await db.queue.update(item.id, { blocked: true, lastError: outcome?.message ?? null });
      return;
    }

    if (status === 'REJECTED') {
      // Retrying will not change the answer. The record stays on the device,
      // visibly needing a correction, rather than cycling silently forever.
      await setSyncState(table, item.localId, 'SYNC_FAILED', {
        syncError: outcome?.message ?? 'The server could not accept this record.',
      });
      if (item.id !== undefined) await db.queue.update(item.id, { blocked: true, lastError: outcome?.message ?? null });
      return;
    }

    const attempts = item.attempts + 1;
    await setSyncState(table, item.localId, 'SYNC_FAILED', { syncError: outcome?.message ?? 'Will retry.' });
    if (item.id !== undefined) {
      await db.queue.update(item.id, { attempts, nextAttemptAt: Date.now() + backoffDelayMs(attempts) });
    }
  }

  /** Photographs upload after their records, largest last. */
  private async uploadPhotos(): Promise<void> {
    const pending = await db.photoBlobs.filter((b) => !b.uploaded).toArray();
    for (const entry of pending) {
      const photo = await db.photos.get(entry.localId);
      if (!photo || photo.syncState !== 'SYNCED') continue;
      try {
        await api.uploadPhoto(entry.localId, entry.blob);
        await db.photoBlobs.update(entry.localId, { uploaded: true });
      } catch (err) {
        if (err instanceof ApiUnavailable) return; // try the whole set again later
      }
    }
  }

  /** Releases confirmed photograph binaries to reclaim device storage. */
  async pruneUploadedPhotos(): Promise<number> {
    const uploaded = await db.photoBlobs.filter((b) => b.uploaded).toArray();
    for (const entry of uploaded) await db.photoBlobs.delete(entry.localId);
    return uploaded.length;
  }

  /** Clears a block after the technician corrects the record. */
  async retryBlocked(localId: string): Promise<void> {
    const item = await db.queue.where('localId').equals(localId).first();
    if (item?.id !== undefined) {
      await db.queue.update(item.id, { blocked: false, attempts: 0, nextAttemptAt: Date.now(), lastError: null });
    }
    await this.syncNow();
  }
}

export const syncEngine = new SyncEngine();
