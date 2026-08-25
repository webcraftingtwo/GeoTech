import { buildHandover, emptyRecords, type HandoverRecords } from '@geotech/core';
import { APP_VERSION } from '../deployment.js';
import { db, type StoredSession } from './database.js';

/**
 * Exporting a shift (standalone deployment).
 *
 * In the networked deployment records leave the device by synchronising. With
 * no server they leave as a file instead, and the same rule governs both: the
 * device keeps its copy until the records are known to have arrived. Export
 * therefore *marks* records as handed over; it never deletes them.
 */

export interface ExportResult {
  filename: string;
  json: string;
  counts: Record<string, number>;
  checksum: string;
  photosPending: number;
}

/** Everything captured on this device that has not yet been handed over. */
export async function collectOutstanding(): Promise<HandoverRecords> {
  const records = emptyRecords();
  const notHandedOver = <T extends { syncState: string }>(rows: T[]) =>
    rows.filter((r) => r.syncState !== 'SYNCED');

  records.faceLogs = notHandedOver(await db.faceLogs.toArray());
  records.observations = notHandedOver(await db.observations.toArray());
  records.reefObservations = notHandedOver(await db.reefObservations.toArray());
  records.structures = notHandedOver(await db.structures.toArray());
  records.offsets = notHandedOver(await db.offsets.toArray());
  records.samples = notHandedOver(await db.samples.toArray());
  records.hazards = notHandedOver(await db.hazards.toArray());
  records.photos = notHandedOver(await db.photos.toArray());

  return records;
}

export async function countOutstanding(): Promise<number> {
  const records = await collectOutstanding();
  return Object.values(records).reduce((total, list) => total + list.length, 0);
}

export async function buildShiftExport(session: StoredSession): Promise<ExportResult> {
  const records = await collectOutstanding();

  const file = await buildHandover({
    records,
    device: { deviceId: session.deviceId, appVersion: APP_VERSION },
    technician: { id: session.userId, name: session.name, employeeNo: session.employeeNo },
  });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return {
    filename: `geotech-${session.employeeNo}-${stamp}.json`,
    json: JSON.stringify(file, null, 2),
    counts: file.counts,
    checksum: file.checksum,
    photosPending: records.photos.length,
  };
}

/**
 * Marks the exported records as handed over.
 *
 * Called only once the file has actually been written, and never on its own:
 * a record marked as handed over when the file never reached anybody is a
 * record quietly lost, which is the one outcome this system exists to prevent.
 */
export async function markHandedOver(records: HandoverRecords): Promise<void> {
  const now = new Date().toISOString();
  const tables = {
    faceLogs: db.faceLogs,
    observations: db.observations,
    reefObservations: db.reefObservations,
    structures: db.structures,
    offsets: db.offsets,
    samples: db.samples,
    hazards: db.hazards,
    photos: db.photos,
  } as const;

  for (const [key, table] of Object.entries(tables)) {
    const list = records[key as keyof HandoverRecords];
    for (const record of list) {
      await table.update(record.localId, { syncState: 'SYNCED', updatedAt: now });
    }
  }

  await db.queue.clear();
}

/** Hands a blob to the browser to save. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoked on the next tick, once the download has taken the reference.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadFile(filename: string, contents: string, mime = 'application/json'): void {
  downloadBlob(filename, new Blob([contents], { type: mime }));
}

/**
 * Photographs are exported separately: the hand-over file carries their
 * metadata, and the images themselves are written out one by one so a shift
 * with forty photographs does not produce a single unusable file.
 */
export async function exportPhotographs(): Promise<number> {
  const blobs = await db.photoBlobs.toArray();
  let written = 0;

  for (const entry of blobs) {
    const photo = await db.photos.get(entry.localId);
    if (!photo) continue;

    // Named so the file sorts by capture time and still resolves back to its
    // record: the identifier here is the one carried in the hand-over file.
    const stamp = photo.capturedAt.slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(`geotech-photo-${stamp}-${photo.localId.slice(0, 8)}.jpg`, entry.blob);
    written += 1;
  }

  return written;
}
