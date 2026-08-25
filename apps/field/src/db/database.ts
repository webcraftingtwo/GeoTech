import Dexie, { type Table } from 'dexie';
import type {
  FaceLog,
  GeologicalOffset,
  Hazard,
  Observation,
  Photo,
  ReefObservation,
  Sample,
  Structure,
  SyncState,
} from '@geotech/core';

/**
 * The device database.
 *
 * Until a record syncs, **this is the system of record** — not a cache of the
 * server. That distinction drives everything here: writes are transactional and
 * synchronous, nothing is evicted, and photograph binaries live in their own
 * table so a large image never blocks the record it illustrates.
 */

/** An entry in the outbound queue. One per record mutation, retried forever. */
export interface QueueItem {
  id?: number;
  entityType: string;
  localId: string;
  op: 'CREATE' | 'UPDATE';
  clientVersion: number;
  baseVersion?: number | null;
  queuedAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string | null;
  /**
   * Set when the server rejected the record for a reason retrying cannot fix —
   * a duplicate sample number, a value the mine's rules refuse. The record is
   * never dropped; it waits for the technician to correct it.
   */
  blocked?: boolean;
}

export interface PhotoBlob {
  localId: string;
  blob: Blob;
  /** Kept until the upload is confirmed, then released to reclaim space. */
  uploaded: boolean;
}

export interface CachedReference {
  key: 'bundle';
  fetchedAt: string;
  payload: unknown;
}

export interface StoredSession {
  key: 'session';
  userId: string;
  name: string;
  employeeNo: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  /**
   * The sealed offline grant. This is the only credential that persists on the
   * device — never a password (§31).
   */
  offlineGrant: string | null;
  offlineGrantExpiresAt: string | null;
  deviceId: string;
  savedAt: string;
}

export interface Preferences {
  key: 'prefs';
  theme: 'dark' | 'light';
  contrast: 'normal' | 'high';
  /** Remembered so the next log opens where the technician already is (§2). */
  lastWorkplaceId?: string;
  lastShift?: string;
}

export class GeoTechDatabase extends Dexie {
  faceLogs!: Table<FaceLog, string>;
  observations!: Table<Observation, string>;
  reefObservations!: Table<ReefObservation, string>;
  structures!: Table<Structure, string>;
  offsets!: Table<GeologicalOffset, string>;
  samples!: Table<Sample, string>;
  hazards!: Table<Hazard, string>;
  photos!: Table<Photo, string>;
  photoBlobs!: Table<PhotoBlob, string>;
  queue!: Table<QueueItem, number>;
  reference!: Table<CachedReference, string>;
  session!: Table<StoredSession, string>;
  prefs!: Table<Preferences, string>;

  constructor() {
    super('unki-geotech');
    this.version(1).stores({
      faceLogs: 'localId, syncState, status, shiftDate, workplaceId',
      observations: 'localId, faceLogLocalId, syncState',
      reefObservations: 'localId, faceLogLocalId, syncState',
      structures: 'localId, observationLocalId, syncState',
      offsets: 'localId, structureLocalId, syncState',
      samples: 'localId, faceLogLocalId, sampleNumber, syncState',
      hazards: 'localId, faceLogLocalId, syncState, status',
      photos: 'localId, faceLogLocalId, observationLocalId, offsetLocalId, syncState',
      photoBlobs: 'localId, uploaded',
      queue: '++id, localId, entityType, nextAttemptAt, blocked',
      reference: 'key',
      session: 'key',
      prefs: 'key',
    });
  }
}

export const db = new GeoTechDatabase();

/** Every table a device-authored record can live in, in dependency order. */
export const RECORD_TABLES = [
  'faceLogs',
  'observations',
  'reefObservations',
  'structures',
  'offsets',
  'samples',
  'hazards',
  'photos',
] as const;

export type RecordTable = (typeof RECORD_TABLES)[number];

export const ENTITY_FOR_TABLE: Record<RecordTable, string> = {
  faceLogs: 'FACE_LOG',
  observations: 'OBSERVATION',
  reefObservations: 'REEF_OBSERVATION',
  structures: 'STRUCTURE',
  offsets: 'OFFSET',
  samples: 'SAMPLE',
  hazards: 'HAZARD',
  photos: 'PHOTO',
};

export const TABLE_FOR_ENTITY: Record<string, RecordTable> = Object.fromEntries(
  Object.entries(ENTITY_FOR_TABLE).map(([table, entity]) => [entity, table as RecordTable]),
) as Record<string, RecordTable>;

export async function countBySyncState(): Promise<Record<SyncState, number>> {
  const counts = {
    DRAFT: 0,
    LOCAL_SAVED: 0,
    PENDING_SYNC: 0,
    SYNCING: 0,
    SYNCED: 0,
    SYNC_FAILED: 0,
    REQUIRES_REVIEW: 0,
  } as Record<SyncState, number>;

  for (const table of RECORD_TABLES) {
    const rows = await db.table(table).toArray();
    for (const row of rows as { syncState: SyncState }[]) {
      counts[row.syncState] = (counts[row.syncState] ?? 0) + 1;
    }
  }
  return counts;
}
