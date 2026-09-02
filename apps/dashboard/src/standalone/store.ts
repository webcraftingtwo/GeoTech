import {
  emptyRecords,
  mergeHandovers,
  readHandover,
  summariseFaceMeasurement,
  type Confidence,
  type HandoverFile,
  type HandoverRecords,
  type StoredFaceMeasurement,
} from '@geotech/core';

/**
 * Standalone dashboard store.
 *
 * The networked dashboard reads from a database that enforces the rules. With
 * no server, this holds the same shapes in the browser and keeps the one rule
 * that cannot be given up: **an interpretation is written beside an
 * observation, never over it.** Nothing in this file mutates a captured value.
 *
 * What is genuinely lost without a server is stated in the interface, not
 * hidden: no server-side authorisation, and an audit trail that lives on one
 * machine rather than centrally.
 */

const STORAGE_KEY = 'geotech.standalone.v1';

export interface LocalInterpretation {
  id: string;
  entityId: string;
  field: 'throw' | 'heave';
  value: number;
  confidence: Confidence;
  comment: string;
  interpretedBy: string;
  interpretedAt: string;
  supersededById: string | null;
}

export interface LocalReview {
  id: string;
  entityId: string;
  status: 'ACCEPTED' | 'CLARIFICATION_REQUESTED' | 'REJECTED' | 'VALIDATED';
  comment: string;
  reviewer: string;
  reviewedAt: string;
}

export interface LoadedFile {
  filename: string;
  exportedAt: string;
  technician: string;
  deviceId: string;
  counts: Record<string, number>;
  checksumVerified: boolean;
  warnings: string[];
}

export interface StoreState {
  reviewer: string;
  files: LoadedFile[];
  records: HandoverRecords;
  interpretations: LocalInterpretation[];
  reviews: LocalReview[];
}

const emptyState = (): StoreState => ({
  reviewer: '',
  files: [],
  records: emptyRecords(),
  interpretations: [],
  reviews: [],
});

let state: StoreState = emptyState();
const listeners = new Set<() => void>();

function emit(): void {
  persist();
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or disabled store must not break the session in progress. The
    // work stays in memory; the interface warns that it will not survive a
    // reload.
    persistFailed = true;
  }
}

let persistFailed = false;
export const persistenceWorking = (): boolean => !persistFailed;

export function restore(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...emptyState(), ...(JSON.parse(raw) as StoreState) };
  } catch {
    state = emptyState();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getState = (): StoreState => state;

export function setReviewer(name: string): void {
  state = { ...state, reviewer: name };
  emit();
}

export interface OpenResult {
  ok: boolean;
  filename: string;
  problems: string[];
  warnings: string[];
  added: number;
}

/**
 * Opens a hand-over file.
 *
 * The file is verified before any of it reaches the interface: a geologist
 * must never be shown a measurement from a file that failed its checksum, and
 * must be told plainly rather than quietly given fewer records.
 */
export async function openFile(filename: string, text: string): Promise<OpenResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      filename,
      problems: ['This file is not readable as data. Check it was not opened and re-saved by another program.'],
      warnings: [],
      added: 0,
    };
  }

  const check = await readHandover(parsed);
  if (!check.ok || !check.file) {
    return { ok: false, filename, problems: check.problems, warnings: check.warnings, added: 0 };
  }

  const file = check.file;
  if (state.files.some((f) => f.filename === filename && f.exportedAt === file.exportedAt)) {
    return {
      ok: false,
      filename,
      problems: ['This exact file is already open. Opening it twice would not add anything.'],
      warnings: [],
      added: 0,
    };
  }

  const before = countRecords(state.records);
  const asFile: HandoverFile[] = [
    { records: state.records } as HandoverFile,
    file,
  ];

  state = {
    ...state,
    records: mergeHandovers(asFile),
    files: [
      ...state.files,
      {
        filename,
        exportedAt: file.exportedAt,
        technician: `${file.technician.name} (${file.technician.employeeNo})`,
        deviceId: file.device.deviceId,
        counts: file.counts as Record<string, number>,
        checksumVerified: Boolean(file.checksum),
        warnings: check.warnings,
      },
    ],
  };
  emit();

  return {
    ok: true,
    filename,
    problems: [],
    warnings: check.warnings,
    added: countRecords(state.records) - before,
  };
}

export function countRecords(records: HandoverRecords): number {
  return Object.values(records).reduce((total, list) => total + (list as unknown[]).length, 0);
}

export function clearAll(): void {
  state = { ...emptyState(), reviewer: state.reviewer };
  emit();
}

/* ── interpretation (§13) ─────────────────────────────────────────────── */

/**
 * Records an interpretation. The previous one for the same field is marked
 * superseded and kept, exactly as the server does — the reasoning history is
 * part of the geological record.
 */
export function addInterpretation(args: {
  entityId: string;
  field: 'throw' | 'heave';
  value: number;
  confidence: Confidence;
  comment: string;
}): void {
  const id = `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const previous = state.interpretations.find(
    (i) => i.entityId === args.entityId && i.field === args.field && !i.supersededById,
  );

  const interpretations = state.interpretations.map((i) =>
    i === previous ? { ...i, supersededById: id } : i,
  );

  interpretations.push({
    id,
    entityId: args.entityId,
    field: args.field,
    value: args.value,
    confidence: args.confidence,
    comment: args.comment,
    interpretedBy: state.reviewer || 'Unnamed reviewer',
    interpretedAt: new Date().toISOString(),
    supersededById: null,
  });

  state = { ...state, interpretations };
  emit();
}

export function currentInterpretation(
  entityId: string,
  field: 'throw' | 'heave',
): LocalInterpretation | undefined {
  return state.interpretations.find((i) => i.entityId === entityId && i.field === field && !i.supersededById);
}

export function interpretationsFor(entityId: string): LocalInterpretation[] {
  return state.interpretations
    .filter((i) => i.entityId === entityId)
    .sort((a, b) => b.interpretedAt.localeCompare(a.interpretedAt));
}

export function addReview(args: {
  entityId: string;
  status: LocalReview['status'];
  comment: string;
}): void {
  state = {
    ...state,
    reviews: [
      ...state.reviews,
      {
        id: `rev-${Date.now()}`,
        entityId: args.entityId,
        status: args.status,
        comment: args.comment,
        reviewer: state.reviewer || 'Unnamed reviewer',
        reviewedAt: new Date().toISOString(),
      },
    ],
  };
  emit();
}

export function reviewsFor(entityId: string): LocalReview[] {
  return state.reviews
    .filter((r) => r.entityId === entityId)
    .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
}

export const latestReview = (entityId: string): LocalReview | undefined => reviewsFor(entityId)[0];

/* ── export ───────────────────────────────────────────────────────────── */

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export function download(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Offsets with observed and interpreted values in separate columns (§13). */
export function offsetRows(): Record<string, unknown>[] {
  const { records } = state;
  const structures = new Map(records.structures.map((s) => [s.localId, s]));
  const observations = new Map(records.observations.map((o) => [o.localId, o]));
  const faceLogs = new Map(records.faceLogs.map((l) => [l.localId, l]));

  return records.offsets.map((offset) => {
    const structure = structures.get(offset.structureLocalId);
    const observation = structure ? observations.get(structure.observationLocalId) : undefined;
    const faceLog = observation ? faceLogs.get(observation.faceLogLocalId) : undefined;
    const throwValue = currentInterpretation(offset.localId, 'throw');
    const heaveValue = currentInterpretation(offset.localId, 'heave');
    const review = latestReview(faceLog?.localId ?? '');

    return {
      recordId: offset.recordId,
      shiftDate: faceLog?.shiftDate?.slice(0, 10) ?? '',
      workplace: faceLog?.workplaceId ?? '',
      surveyReference: faceLog?.surveyReference ?? '',
      structureType: structure?.structureType ?? '',
      structureRef: structure?.structureRef ?? '',
      marker: offset.markerType,
      apparentOffsetObserved: offset.apparentOffset,
      unit: offset.unit,
      verticalSense: offset.verticalSense ?? '',
      lateralSense: offset.lateralSense ?? '',
      strike: structure?.strike ?? '',
      dip: structure?.dip ?? '',
      dipDirection: structure?.dipDirection ?? '',
      measurementSource: offset.measurementSource ?? '',
      observationConfidence: offset.confidence ?? '',
      throwInterpreted: throwValue?.value ?? '',
      heaveInterpreted: heaveValue?.value ?? '',
      interpretationConfidence: throwValue?.confidence ?? '',
      interpretedBy: throwValue?.interpretedBy ?? '',
      reviewStatus: review?.status ?? '',
    };
  });
}

export function sampleRows(): Record<string, unknown>[] {
  const faceLogs = new Map(state.records.faceLogs.map((l) => [l.localId, l]));
  return state.records.samples.map((sample) => {
    const faceLog = faceLogs.get(sample.faceLogLocalId);
    return {
      sampleNumber: sample.sampleNumber,
      sampleType: sample.sampleType,
      shiftDate: faceLog?.shiftDate?.slice(0, 10) ?? '',
      workplace: faceLog?.workplaceId ?? '',
      fromPosition: sample.fromPosition ?? '',
      toPosition: sample.toPosition ?? '',
      length: sample.length ?? '',
      classification: sample.reefClassification ?? '',
      collectedAt: sample.collectedAt,
      status: sample.status,
    };
  });
}

/**
 * Face measurements, one row per station (§9.8).
 *
 * A row per station rather than per face: width control is argued over
 * individual readings, and a summary line cannot be checked back against the
 * marking sheet. The limits each station was judged against are carried on the
 * row, because they were snapshotted at capture and must not be re-derived by
 * whoever opens the spreadsheet.
 */
export function faceMeasurementRows(): Record<string, unknown>[] {
  const faceLogs = new Map(state.records.faceLogs.map((l) => [l.localId, l]));
  const rows: Record<string, unknown>[] = [];

  for (const m of state.records.faceMeasurements) {
    const faceLog = faceLogs.get(m.faceLogLocalId);
    const summary = summariseFaceMeasurement(m);

    for (const station of summary.stations) {
      rows.push({
        recordId: m.recordId,
        shiftDate: faceLog?.shiftDate?.slice(0, 10) ?? '',
        workplace: faceLog?.workplaceId ?? '',
        surveyReference: faceLog?.surveyReference ?? '',
        blastNumber: m.blastNumber ?? '',
        distanceFromPeg: m.distanceFromPeg ?? '',
        faceLength: m.faceLength ?? '',
        stationInterval: m.stationInterval,
        traverseDirection: m.traverseDirection,
        method: m.measurementMethod ?? '',
        limitSet: m.limits.code,
        limitHangingwall: m.limits.hangingwall,
        limitFootwall: m.limits.footwall,
        station: station.distance,
        hangingwall: station.hangingwall ?? '',
        footwall: station.footwall ?? '',
        stopeWidth: station.stopeWidth ?? '',
        hangingwallBreach: station.hangingwallBreach ? 'YES' : '',
        footwallBreach: station.footwallBreach ? 'YES' : '',
        hangingwallOverbreak: station.hangingwallOverbreak || '',
        footwallOverbreak: station.footwallOverbreak || '',
        reason: m.stations[station.index]?.reason ?? '',
        measuredAt: m.measuredAt,
      });
    }
  }

  return rows;
}

/** Face measurements for one log, newest first. */
export function faceMeasurementsFor(faceLogLocalId: string): StoredFaceMeasurement[] {
  return state.records.faceMeasurements
    .filter((m) => m.faceLogLocalId === faceLogLocalId)
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
}

/** The full working set, including every interpretation and review. */
export function reviewedBundle(): string {
  return JSON.stringify(
    {
      format: 'unki-geotech-reviewed',
      version: 1,
      exportedAt: new Date().toISOString(),
      reviewer: state.reviewer || null,
      sourceFiles: state.files,
      records: state.records,
      interpretations: state.interpretations,
      reviews: state.reviews,
      notice:
        'Produced by Unki GeoTech in standalone mode. Observed values are exactly as captured underground; interpreted values are recorded separately and never overwrite them. This file carries no central audit trail and geological interpretation remains subject to competent-person review under the mine approved procedures.',
    },
    null,
    2,
  );
}
