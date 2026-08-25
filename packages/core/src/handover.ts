/**
 * Shift hand-over file (standalone deployment).
 *
 * When the system runs without a central server, a device still has to get a
 * shift's geology to the geologist. It does so by exporting a hand-over file
 * that the dashboard reads back.
 *
 * This is deliberately the *same* record shapes the sync protocol carries, so
 * a mine that pilots the standalone pair and later stands up the server can
 * replay its hand-over files through the normal ingest without a conversion
 * step, and without reinterpreting a single measurement.
 *
 * The trade-off is stated in the file itself and must not be glossed over: a
 * hand-over file is exactly as trustworthy as the device that wrote it. There
 * is no server-side authorisation behind it and no central audit trail. It is
 * suitable for a pilot; the networked deployment is what a permanent
 * geological record needs.
 */

import type {
  FaceLog,
  GeologicalOffset,
  Hazard,
  Observation,
  Photo,
  ReefObservation,
  Sample,
  Structure,
} from './types.js';

export const HANDOVER_FORMAT = 'unki-geotech-handover';
export const HANDOVER_VERSION = 1;

export interface HandoverRecords {
  faceLogs: FaceLog[];
  observations: Observation[];
  reefObservations: ReefObservation[];
  structures: Structure[];
  offsets: GeologicalOffset[];
  samples: Sample[];
  hazards: Hazard[];
  /** Metadata only — the binaries stay on the device (see `photoNote`). */
  photos: Photo[];
}

export interface HandoverFile {
  format: typeof HANDOVER_FORMAT;
  version: number;
  exportedAt: string;
  device: { deviceId: string; appVersion?: string };
  technician: { id: string; name: string; employeeNo: string };
  /** Inclusive shift dates covered by the records, for the receiving end. */
  covering: { from: string | null; to: string | null };
  counts: Record<keyof HandoverRecords, number>;
  records: HandoverRecords;
  /** SHA-256 over the canonical serialisation of `records`. */
  checksum: string;
  photoNote: string;
  notice: string;
}

export const emptyRecords = (): HandoverRecords => ({
  faceLogs: [],
  observations: [],
  reefObservations: [],
  structures: [],
  offsets: [],
  samples: [],
  hazards: [],
  photos: [],
});

/**
 * Canonical serialisation: keys sorted at every level, so the same records
 * always produce the same bytes and therefore the same checksum, whatever
 * order they came out of the database in.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

export async function checksumOf(records: HandoverRecords): Promise<string> {
  const text = canonicalise(records);
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCryptoLike } }).crypto?.subtle;
  if (!subtle) return `len-${text.length}`;
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface SubtleCryptoLike {
  digest(algorithm: string, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer>;
}

export async function buildHandover(args: {
  records: HandoverRecords;
  device: { deviceId: string; appVersion?: string };
  technician: { id: string; name: string; employeeNo: string };
  now?: Date;
}): Promise<HandoverFile> {
  const dates = args.records.faceLogs
    .map((l) => l.shiftDate)
    .filter((d): d is string => Boolean(d))
    .sort();

  return {
    format: HANDOVER_FORMAT,
    version: HANDOVER_VERSION,
    exportedAt: (args.now ?? new Date()).toISOString(),
    device: args.device,
    technician: args.technician,
    covering: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    counts: Object.fromEntries(
      Object.entries(args.records).map(([key, list]) => [key, (list as unknown[]).length]),
    ) as Record<keyof HandoverRecords, number>,
    records: args.records,
    checksum: await checksumOf(args.records),
    photoNote:
      'Photographs are listed by reference only. The image files remain on the capturing device and must be transferred separately.',
    notice:
      'Captured with Unki GeoTech in standalone mode. This file carries no server-side authorisation and no central audit trail: it is exactly as trustworthy as the device that produced it. Geological interpretation remains subject to competent-person review under the mine approved procedures.',
  };
}

export interface HandoverCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
  file?: HandoverFile;
}

/**
 * Validates a file before a geologist is shown anything from it. A hand-over
 * file arrives from outside the application, so it is checked rather than
 * trusted — a corrupted or truncated transfer must be caught here, not
 * discovered later in a report.
 */
export async function readHandover(raw: unknown): Promise<HandoverCheck> {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, problems: ['This file is not a hand-over file — it could not be read as data.'], warnings };
  }
  const file = raw as Partial<HandoverFile>;

  if (file.format !== HANDOVER_FORMAT) {
    problems.push('This is not an Unki GeoTech hand-over file.');
    return { ok: false, problems, warnings };
  }
  if (typeof file.version !== 'number' || file.version > HANDOVER_VERSION) {
    problems.push(
      `This file was written by a newer version of the application (format ${String(file.version)}). Update the dashboard before opening it.`,
    );
    return { ok: false, problems, warnings };
  }
  if (!file.records || typeof file.records !== 'object') {
    problems.push('The file contains no records.');
    return { ok: false, problems, warnings };
  }

  const records = { ...emptyRecords(), ...file.records };

  if (file.checksum) {
    const actual = await checksumOf(records);
    if (actual !== file.checksum) {
      problems.push(
        'The contents do not match the checksum written when this file was exported. It has been altered or damaged in transfer — ask for a fresh export rather than working from this copy.',
      );
    }
  } else {
    warnings.push('This file carries no checksum, so its contents cannot be verified.');
  }

  // Structural integrity: a child whose parent is missing would silently
  // disappear from every view, which is worse than refusing to load it.
  const faceLogIds = new Set(records.faceLogs.map((l) => l.localId));
  const observationIds = new Set(records.observations.map((o) => o.localId));
  const structureIds = new Set(records.structures.map((s) => s.localId));

  const orphans =
    records.observations.filter((o) => !faceLogIds.has(o.faceLogLocalId)).length +
    records.structures.filter((s) => !observationIds.has(s.observationLocalId)).length +
    records.offsets.filter((o) => !structureIds.has(o.structureLocalId)).length;

  if (orphans > 0) {
    warnings.push(
      `${orphans} record${orphans === 1 ? '' : 's'} in this file reference a parent that is not present. They are shown, but their working place may be unknown.`,
    );
  }

  if (records.faceLogs.length === 0) warnings.push('This file contains no face logs.');

  return { ok: problems.length === 0, problems, warnings, file: { ...(file as HandoverFile), records } };
}

/** Merges files from several devices, keeping the newest version of a record. */
export function mergeHandovers(files: HandoverFile[]): HandoverRecords {
  const merged = emptyRecords();
  const keys = Object.keys(merged) as (keyof HandoverRecords)[];

  for (const key of keys) {
    const byLocalId = new Map<string, { localId: string; version?: number; updatedAt?: string }>();
    for (const file of files) {
      for (const record of file.records[key] as { localId: string; version?: number; updatedAt?: string }[]) {
        const existing = byLocalId.get(record.localId);
        if (!existing) {
          byLocalId.set(record.localId, record);
          continue;
        }
        // Higher version wins; equal versions fall back to the later timestamp.
        const newer =
          (record.version ?? 0) > (existing.version ?? 0) ||
          ((record.version ?? 0) === (existing.version ?? 0) &&
            (record.updatedAt ?? '') > (existing.updatedAt ?? ''));
        if (newer) byLocalId.set(record.localId, record);
      }
    }
    (merged[key] as unknown[]) = [...byLocalId.values()];
  }

  return merged;
}
