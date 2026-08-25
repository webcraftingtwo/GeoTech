/**
 * Record identifiers.
 *
 * Two identifiers exist for every device-authored record and they do different
 * jobs:
 *
 *  - `localId`  — an opaque UUID minted on the device the instant a record is
 *                 created. It never changes, never repeats, and is the
 *                 idempotency key at sync. Photographs taken seconds after a
 *                 face log is started already have something to belong to.
 *
 *  - `recordId` — the human-readable identifier a technician reads aloud
 *                 underground and writes on a sample bag, e.g.
 *                 `UNK-FL-2026-000124`. Minted from a server sequence, or
 *                 provisionally on the device with a device-scoped suffix when
 *                 offline.
 */

export type RecordPrefix = 'FL' | 'GEO' | 'OFS' | 'STR' | 'SMP' | 'HAZ' | 'PHO';

export const RECORD_PREFIXES: Record<string, RecordPrefix> = {
  FACE_LOG: 'FL',
  OBSERVATION: 'GEO',
  OFFSET: 'OFS',
  STRUCTURE: 'STR',
  SAMPLE: 'SMP',
  HAZARD: 'HAZ',
  PHOTO: 'PHO',
};

export interface RecordIdParts {
  /** Site prefix, configurable per deployment. */
  site: string;
  prefix: RecordPrefix;
  year: number;
  sequence: number;
  /** Present only while the identifier is provisional (minted offline). */
  deviceSuffix?: string;
}

export function newLocalId(): string {
  // Typed narrowly rather than pulling the DOM lib into a platform-neutral
  // package: this runs on a phone, in Node and in a service worker.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // Deterministic fallback for environments without WebCrypto (older runtimes).
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`;
}

/** `UNK-FL-2026-000124`, or `UNK-FL-2026-000124-D7A2` while provisional. */
export function formatRecordId(parts: RecordIdParts): string {
  const seq = String(parts.sequence).padStart(6, '0');
  const base = `${parts.site}-${parts.prefix}-${parts.year}-${seq}`;
  return parts.deviceSuffix ? `${base}-${parts.deviceSuffix}` : base;
}

const RECORD_ID_RE = /^([A-Z0-9]{2,6})-([A-Z]{2,4})-(\d{4})-(\d{6})(?:-([A-Z0-9]{4}))?$/;

export function parseRecordId(recordId: string): RecordIdParts | null {
  const m = RECORD_ID_RE.exec(recordId);
  if (!m) return null;
  const [, site, prefix, year, seq, suffix] = m;
  return {
    site: site!,
    prefix: prefix! as RecordPrefix,
    year: Number(year),
    sequence: Number(seq),
    ...(suffix ? { deviceSuffix: suffix } : {}),
  };
}

export function isProvisional(recordId: string): boolean {
  return parseRecordId(recordId)?.deviceSuffix !== undefined;
}

/**
 * Mints a provisional identifier on the device. The device-scoped suffix means
 * two technicians working offline in different sections cannot collide, and the
 * server can recognise the identifier as provisional and issue the definitive
 * sequence number at ingest.
 */
export function mintProvisionalRecordId(opts: {
  site: string;
  prefix: RecordPrefix;
  deviceId: string;
  localSequence: number;
  now?: Date;
}): string {
  const year = (opts.now ?? new Date()).getUTCFullYear();
  return formatRecordId({
    site: opts.site,
    prefix: opts.prefix,
    year,
    sequence: opts.localSequence,
    deviceSuffix: deviceSuffix(opts.deviceId),
  });
}

/** Four stable uppercase alphanumerics derived from the device identifier. */
export function deviceSuffix(deviceId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < deviceId.length; i++) {
    h ^= deviceId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/** Sample numbers are checked for uniqueness on the device and in the database (§16). */
export function normaliseSampleNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
