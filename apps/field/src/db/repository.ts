import { newLocalId, type SyncState } from '@geotech/core';
import {
  db,
  ENTITY_FOR_TABLE,
  type QueueItem,
  type RecordTable,
} from './database.js';

/**
 * All writes go through here.
 *
 * The contract is short and absolute: **a save never waits on a network, and a
 * save never fails silently.** The record lands in IndexedDB inside a
 * transaction; queueing for sync is a separate step that cannot lose the record
 * if it goes wrong.
 */

export interface Envelope {
  localId: string;
  deviceId: string;
  version: number;
  syncState: SyncState;
  createdAt: string;
  updatedAt: string;
}

export function newEnvelope(deviceId: string, syncState: SyncState = 'DRAFT'): Envelope {
  const now = new Date().toISOString();
  return { localId: newLocalId(), deviceId, version: 1, syncState, createdAt: now, updatedAt: now };
}

/** Saves a record locally. Returns immediately; nothing is sent yet. */
export async function saveLocal<T extends { localId: string; version: number; updatedAt: string; syncState: SyncState }>(
  table: RecordTable,
  record: T,
): Promise<T> {
  const updated = { ...record, updatedAt: new Date().toISOString() };
  await db.table(table).put(updated);
  return updated;
}

/**
 * Marks a record ready to sync and puts it in the queue.
 *
 * Queueing is idempotent: a record submitted twice does not produce two
 * outbound operations, because the queue is keyed on the record's localId.
 */
export async function queueForSync(
  table: RecordTable,
  localId: string,
  op: 'CREATE' | 'UPDATE' = 'CREATE',
): Promise<void> {
  await db.transaction('rw', db.table(table), db.queue, async () => {
    const record = (await db.table(table).get(localId)) as
      | { version: number; syncState: SyncState; serverId?: string | null }
      | undefined;
    if (!record) return;

    await db.table(table).update(localId, {
      syncState: 'PENDING_SYNC' satisfies SyncState,
      updatedAt: new Date().toISOString(),
    });

    const existing = await db.queue.where('localId').equals(localId).first();
    const item: QueueItem = {
      ...(existing?.id !== undefined ? { id: existing.id } : {}),
      entityType: ENTITY_FOR_TABLE[table],
      localId,
      op: record.serverId ? 'UPDATE' : op,
      clientVersion: record.version,
      baseVersion: record.serverId ? record.version - 1 : null,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      blocked: false,
    };
    await db.queue.put(item);
  });
}

export async function setSyncState(
  table: RecordTable,
  localId: string,
  syncState: SyncState,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await db.table(table).update(localId, { syncState, updatedAt: new Date().toISOString(), ...extra });
}

/** A face log plus everything captured against it. */
export async function loadFaceLogPackage(faceLogLocalId: string) {
  const [faceLog, observations, reefObservations, samples, hazards, photos, faceMeasurements] = await Promise.all([
    db.faceLogs.get(faceLogLocalId),
    db.observations.where('faceLogLocalId').equals(faceLogLocalId).toArray(),
    db.reefObservations.where('faceLogLocalId').equals(faceLogLocalId).toArray(),
    db.samples.where('faceLogLocalId').equals(faceLogLocalId).toArray(),
    db.hazards.where('faceLogLocalId').equals(faceLogLocalId).toArray(),
    db.photos.where('faceLogLocalId').equals(faceLogLocalId).toArray(),
    db.faceMeasurements.where('faceLogLocalId').equals(faceLogLocalId).toArray(),
  ]);

  const observationIds = observations.map((o) => o.localId);
  const structures = observationIds.length
    ? await db.structures.where('observationLocalId').anyOf(observationIds).toArray()
    : [];
  const structureIds = structures.map((s) => s.localId);
  const offsets = structureIds.length
    ? await db.offsets.where('structureLocalId').anyOf(structureIds).toArray()
    : [];

  return { faceLog, observations, reefObservations, structures, offsets, samples, hazards, photos, faceMeasurements };
}

/**
 * Submits a whole face-log package. Children are queued after their parent so
 * the batch arrives in a filable order even if the connection drops midway.
 */
export async function submitFaceLog(faceLogLocalId: string): Promise<void> {
  const pkg = await loadFaceLogPackage(faceLogLocalId);
  if (!pkg.faceLog) return;

  await db.faceLogs.update(faceLogLocalId, {
    status: 'SUBMITTED',
    submittedAt: new Date().toISOString(),
  });

  await queueForSync('faceLogs', faceLogLocalId);
  for (const o of pkg.observations) await queueForSync('observations', o.localId);
  for (const r of pkg.reefObservations) await queueForSync('reefObservations', r.localId);
  for (const s of pkg.structures) await queueForSync('structures', s.localId);
  for (const off of pkg.offsets) await queueForSync('offsets', off.localId);
  for (const s of pkg.samples) await queueForSync('samples', s.localId);
  for (const h of pkg.hazards) await queueForSync('hazards', h.localId);
  for (const m of pkg.faceMeasurements) await queueForSync('faceMeasurements', m.localId);
  // Photographs last: a 3 MB image must never hold up the observation it
  // illustrates.
  for (const p of pkg.photos) await queueForSync('photos', p.localId);
}

/** Sample numbers are checked here too, so a clash is caught at the face (§16). */
export async function sampleNumberExists(sampleNumber: string): Promise<boolean> {
  const target = sampleNumber.trim().toUpperCase();
  const all = await db.samples.toArray();
  return all.some((s) => s.sampleNumber.trim().toUpperCase() === target);
}

export async function getPreferences() {
  return (
    (await db.prefs.get('prefs')) ?? {
      key: 'prefs' as const,
      theme: 'dark' as const,
      contrast: 'normal' as const,
    }
  );
}

export async function savePreferences(patch: Partial<Awaited<ReturnType<typeof getPreferences>>>) {
  const current = await getPreferences();
  await db.prefs.put({ ...current, ...patch, key: 'prefs' });
}
