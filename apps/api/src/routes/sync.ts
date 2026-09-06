import type { EntityType, Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  conflictingFields,
  detectConflict,
  isProvisional,
  RECORD_PREFIXES,
  STATION_INTERVAL_M,
  summariseFaceMeasurement,
  validateRecord,
  type FaceStation,
  type RecordPrefix,
  type SyncOperationStatus,
} from '@geotech/core';
import type { Env } from '../env.js';
import { recordAudit, recordVersion } from '../lib/audit.js';
import { loadValidationConfig } from '../lib/config.js';
import { prisma, type Tx } from '../lib/prisma.js';
import { nextRecordId } from '../lib/sequences.js';

/* ── request shape ────────────────────────────────────────────────────── */

const operationSchema = z.object({
  localId: z.string().min(1),
  entityType: z.enum([
    'FACE_LOG',
    'OBSERVATION',
    'REEF_OBSERVATION',
    'STRUCTURE',
    'OFFSET',
    'SAMPLE',
    'HAZARD',
    'PHOTO',
    'FACE_MEASUREMENT',
  ]),
  op: z.enum(['CREATE', 'UPDATE']),
  clientVersion: z.number().int().positive(),
  baseVersion: z.number().int().nullable().optional(),
  payload: z.record(z.unknown()),
  queuedAt: z.string(),
});

const batchSchema = z.object({
  batchId: z.string().min(1),
  deviceId: z.string().min(1),
  sentAt: z.string(),
  operations: z.array(operationSchema).max(500),
});

type Operation = z.infer<typeof operationSchema>;

/**
 * Parents must land before their children, whatever order the device queued
 * them in — a technician who photographs a face before finishing the log still
 * gets a coherent record on the server.
 */
const DEPENDENCY_ORDER: EntityType[] = [
  'FACE_LOG',
  'OBSERVATION',
  'REEF_OBSERVATION',
  'STRUCTURE',
  'OFFSET',
  'SAMPLE',
  'HAZARD',
  'FACE_MEASUREMENT',
  'PHOTO',
];

/* ── helpers ──────────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
const enumOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

const CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const;
const SOURCE = ['SENSOR', 'MANUAL'] as const;

class SyncReject extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

/**
 * Sync dispatches over eight entity types by name, which Prisma's per-model
 * types cannot express as a union. Rather than scatter `@ts-expect-error`
 * through the ingest path, the dynamic access is confined to this one narrow
 * interface — every record the protocol touches has exactly these three
 * operations and a `localId`.
 */
interface SyncedRecord {
  id: string;
  version: number;
  recordId?: string;
  [key: string]: unknown;
}

interface RecordDelegate {
  findUnique(args: { where: { localId: string } }): Promise<SyncedRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<SyncedRecord>;
  update(args: { where: { localId: string }; data: Record<string, unknown> }): Promise<SyncedRecord>;
}

function delegateFor(tx: Tx, model: string): RecordDelegate {
  return (tx as unknown as Record<string, RecordDelegate>)[model]!;
}

/** Resolves a parent referenced by its device-minted localId. */
async function parentId(
  tx: Tx,
  model: 'faceLog' | 'observation' | 'structure' | 'offset',
  localId: unknown,
  label: string,
): Promise<string> {
  const key = str(localId);
  if (!key) throw new SyncReject(`This record is not linked to a ${label}. It cannot be filed without one.`);
  const found = await delegateFor(tx, model).findUnique({ where: { localId: key } });
  if (!found) {
    throw new SyncReject(
      `The ${label} this record belongs to has not reached the server yet. It will be retried automatically once the ${label} syncs.`,
    );
  }
  return found.id;
}

/* ── per-entity mapping ───────────────────────────────────────────────── */

async function buildData(
  tx: Tx,
  entityType: EntityType,
  payload: Record<string, unknown>,
  ctx: { deviceId: string; userId: string; site: string; version: number },
): Promise<Record<string, unknown>> {
  const base = { localId: str(payload['localId'])!, deviceId: ctx.deviceId, version: ctx.version };

  switch (entityType) {
    case 'FACE_LOG': {
      const workplaceId = str(payload['workplaceId']);
      if (!workplaceId) throw new SyncReject('No working place recorded on this face log.');
      const workplace = await tx.workplace.findUnique({ where: { id: workplaceId }, select: { id: true } });
      if (!workplace) throw new SyncReject('The working place on this face log is not in the mine hierarchy. It may have been retired — contact your geologist.');
      return {
        ...base,
        workplaceId,
        technicianId: str(payload['technicianId']) ?? ctx.userId,
        shiftDate: date(payload['shiftDate']) ?? new Date(),
        shift: str(payload['shift']) ?? '',
        startTime: date(payload['startTime']),
        endTime: date(payload['endTime']),
        surveyReference: str(payload['surveyReference']),
        chainage: num(payload['chainage']),
        easting: num(payload['easting']),
        northing: num(payload['northing']),
        elevation: num(payload['elevation']),
        coordinateSystem: str(payload['coordinateSystem']),
        locationMethod: enumOrNull(payload['locationMethod'], ['SURVEY_STATION', 'TAPE_FROM_PEG', 'GPS', 'ESTIMATED'] as const),
        locationConfidence: enumOrNull(payload['locationConfidence'], CONFIDENCE),
        channelId: str(payload['channelId']),
        distanceToChannel: num(payload['distanceToChannel']),
        tarpClass: str(payload['tarpClass']),
        xrfReading: num(payload['xrfReading']),
        xrfNote: str(payload['xrfNote']),
        sectionManager: str(payload['sectionManager']),
        geologist: str(payload['geologist']),
        shaftGeologist: str(payload['shaftGeologist']),
        official: str(payload['official']),
        overseer: str(payload['overseer']),
        mineName: str(payload['mineName']),
        areaMadeSafe: typeof payload['areaMadeSafe'] === 'boolean' ? payload['areaMadeSafe'] : null,
        structuralComment: str(payload['structuralComment']),
        status: enumOrNull(payload['status'], ['DRAFT', 'SUBMITTED'] as const) ?? 'SUBMITTED',
        dataQuality: num(payload['dataQuality']),
        notes: str(payload['notes']),
        submittedAt: date(payload['submittedAt']) ?? new Date(),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
        syncedAt: new Date(),
      };
    }

    case 'OBSERVATION':
      return {
        ...base,
        faceLogId: await parentId(tx, 'faceLog', payload['faceLogLocalId'], 'face log'),
        observationType: str(payload['observationType']) ?? 'OTHER',
        description: str(payload['description']),
        materialCode: str(payload['materialCode']),
        contactTypeCode: str(payload['contactTypeCode']),
        width: num(payload['width']),
        persistence: num(payload['persistence']),
        relationToReef: str(payload['relationToReef']),
        strike: num(payload['strike']),
        dip: num(payload['dip']),
        dipDirection: num(payload['dipDirection']),
        measurementSource: enumOrNull(payload['measurementSource'], SOURCE),
        confidence: enumOrNull(payload['confidence'], CONFIDENCE),
        observedById: str(payload['observedById']) ?? ctx.userId,
        observedAt: date(payload['observedAt']) ?? new Date(),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };

    case 'REEF_OBSERVATION':
      return {
        ...base,
        faceLogId: await parentId(tx, 'faceLog', payload['faceLogLocalId'], 'face log'),
        reefNameCode: str(payload['reefNameCode']),
        reefPosition: str(payload['reefPosition']),
        reefWidth: num(payload['reefWidth']),
        hwLithologyCode: str(payload['hwLithologyCode']),
        fwLithologyCode: str(payload['fwLithologyCode']),
        contactQualityCode: str(payload['contactQualityCode']),
        chromititeNotes: str(payload['chromititeNotes']),
        internalPartings: str(payload['internalPartings']),
        wasteInclusions: str(payload['wasteInclusions']),
        visibleMineralisation: str(payload['visibleMineralisation']),
        confidence: enumOrNull(payload['confidence'], CONFIDENCE),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };

    case 'STRUCTURE':
      return {
        ...base,
        observationId: await parentId(tx, 'observation', payload['observationLocalId'], 'observation'),
        structureType: str(payload['structureType']) ?? 'OTHER',
        strike: num(payload['strike']),
        dip: num(payload['dip']),
        dipDirection: num(payload['dipDirection']),
        width: num(payload['width']),
        persistence: num(payload['persistence']),
        spacing: num(payload['spacing']),
        aperture: num(payload['aperture']),
        conditionCode: str(payload['conditionCode']),
        infillCode: str(payload['infillCode']),
        intensity: str(payload['intensity']),
        compositionCode: str(payload['compositionCode']),
        relationToReef: str(payload['relationToReef']),
        measurementSource: enumOrNull(payload['measurementSource'], SOURCE),
        sensorAccuracy: num(payload['sensorAccuracy']),
        confidence: enumOrNull(payload['confidence'], CONFIDENCE),
        structureRef: str(payload['structureRef']),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };

    case 'OFFSET': {
      const apparentOffset = num(payload['apparentOffset']);
      if (apparentOffset === null) throw new SyncReject('No apparent offset measurement on this record.');
      return {
        ...base,
        structureId: await parentId(tx, 'structure', payload['structureLocalId'], 'structure'),
        markerType: str(payload['markerType']) ?? 'OTHER',
        markerRef: str(payload['markerRef']),
        apparentOffset,
        unit: str(payload['unit']) ?? 'M',
        offsetDirection: str(payload['offsetDirection']),
        lateralSense: enumOrNull(payload['lateralSense'], ['LEFT', 'RIGHT'] as const),
        verticalSense: enumOrNull(payload['verticalSense'], ['UP', 'DOWN'] as const),
        strike: num(payload['strike']),
        dip: num(payload['dip']),
        dipDirection: num(payload['dipDirection']),
        throwObserved: num(payload['throwObserved']),
        heaveObserved: num(payload['heaveObserved']),
        measurementMethod: str(payload['measurementMethod']),
        measurementSource: enumOrNull(payload['measurementSource'], SOURCE),
        confidence: enumOrNull(payload['confidence'], CONFIDENCE),
        observedById: str(payload['observedById']) ?? ctx.userId,
        observedAt: date(payload['observedAt']) ?? new Date(),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };
    }

    case 'SAMPLE':
      return {
        ...base,
        faceLogId: await parentId(tx, 'faceLog', payload['faceLogLocalId'], 'face log'),
        sampleNumber: (str(payload['sampleNumber']) ?? '').trim().toUpperCase(),
        sampleType: str(payload['sampleType']) ?? 'OTHER',
        materialCode: str(payload['materialCode']),
        fromPosition: num(payload['fromPosition']),
        toPosition: num(payload['toPosition']),
        length: num(payload['length']),
        reefClassification: str(payload['reefClassification']),
        containerRef: str(payload['containerRef']),
        barcode: str(payload['barcode']),
        status: enumOrNull(payload['status'], ['COLLECTED', 'SUBMITTED_TO_LAB', 'RESULTS_RECEIVED', 'CANCELLED'] as const) ?? 'COLLECTED',
        collectedAt: date(payload['collectedAt']) ?? new Date(),
        collectedById: str(payload['collectedById']) ?? ctx.userId,
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };

    case 'HAZARD':
      return {
        ...base,
        faceLogId: await parentId(tx, 'faceLog', payload['faceLogLocalId'], 'face log'),
        observationId: str(payload['observationLocalId'])
          ? await parentId(tx, 'observation', payload['observationLocalId'], 'observation')
          : null,
        hazardType: str(payload['hazardType']) ?? 'OTHER',
        severity: str(payload['severity']) ?? 'MEDIUM',
        description: str(payload['description']) ?? '',
        action: str(payload['action']),
        notifiedPerson: str(payload['notifiedPerson']),
        status: enumOrNull(payload['status'], ['OPEN', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'CLOSED'] as const) ?? 'OPEN',
        raisedById: str(payload['raisedById']) ?? ctx.userId,
        raisedAt: date(payload['raisedAt']) ?? new Date(),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };

    case 'FACE_MEASUREMENT': {
      const raw = Array.isArray(payload['stations']) ? (payload['stations'] as unknown[]) : [];
      const stations: FaceStation[] = raw.map((entry) => {
        const st = (entry ?? {}) as Record<string, unknown>;
        return {
          distance: num(st['distance']) ?? 0,
          hangingwall: num(st['hangingwall']),
          footwall: num(st['footwall']),
          reason: str(st['reason']),
          note: str(st['note']),
        };
      });

      // The applied limits travel with the readings so a later revision of the
      // limit set cannot reinterpret a historical face.
      const appliedLimits = (payload['limits'] ?? {}) as Record<string, unknown>;
      const design = (payload['designCut'] ?? {}) as Record<string, unknown>;
      const limitSetCode = str(appliedLimits['code']);
      const limitHangingwall = num(appliedLimits['hangingwall']);
      const limitFootwall = num(appliedLimits['footwall']);
      if (limitSetCode === null || limitHangingwall === null || limitFootwall === null) {
        throw new SyncReject('This face measurement carries no mining-cut limits. It cannot be assessed without them.');
      }

      // Recomputed here rather than trusted from the device: the summary is
      // what width-control reporting reads, and it must agree with the
      // readings actually stored.
      const summary = summariseFaceMeasurement({
        distanceFromPeg: num(payload['distanceFromPeg']),
        faceLength: num(payload['faceLength']),
        stationInterval: num(payload['stationInterval']) ?? STATION_INTERVAL_M,
        traverseDirection: 'DOWN_DIP_TO_UP_DIP',
        limits: {
          code: limitSetCode,
          label: str(appliedLimits['label']) ?? limitSetCode,
          hangingwall: limitHangingwall,
          footwall: limitFootwall,
        },
        stations,
      });

      return {
        ...base,
        faceLogId: await parentId(tx, 'faceLog', payload['faceLogLocalId'], 'face log'),
        distanceFromPeg: num(payload['distanceFromPeg']),
        faceLength: num(payload['faceLength']),
        stationInterval: num(payload['stationInterval']) ?? STATION_INTERVAL_M,
        traverseDirection:
          enumOrNull(payload['traverseDirection'], ['DOWN_DIP_TO_UP_DIP', 'UP_DIP_TO_DOWN_DIP'] as const) ??
          'DOWN_DIP_TO_UP_DIP',
        measurementMethod: str(payload['measurementMethod']),
        limitSetCode,
        limitHangingwall,
        limitFootwall,
        designHangingwall: num(design['hangingwall']),
        designFootwall: num(design['footwall']),
        startedAt: date(payload['startedAt']),
        stations: stations as unknown as Prisma.InputJsonValue,
        stationCount: summary.total,
        measuredCount: summary.measured,
        hangingwallBreaches: summary.hangingwallBreaches,
        footwallBreaches: summary.footwallBreaches,
        meanHangingwall: summary.meanHangingwall,
        meanFootwall: summary.meanFootwall,
        meanMiningHeight: summary.meanMiningHeight,
        minMiningHeight: summary.minMiningHeight,
        maxMiningHeight: summary.maxMiningHeight,
        meanHangingwallOverbreak: summary.meanHangingwallOverbreak,
        exceedsFlagHeight: summary.exceedsFlagHeight,
        expectedGrade: num(payload['expectedGrade']),
        actualGrade: num(payload['actualGrade']),
        confidence: enumOrNull(payload['confidence'], CONFIDENCE),
        measuredById: str(payload['measuredById']) ?? ctx.userId,
        measuredAt: date(payload['measuredAt']) ?? new Date(),
        extra: (payload['extra'] ?? null) as Prisma.InputJsonValue,
      };
    }

    case 'PHOTO':
      return {
        ...base,
        faceLogId: await parentId(tx, 'faceLog', payload['faceLogLocalId'], 'face log'),
        observationId: str(payload['observationLocalId'])
          ? await parentId(tx, 'observation', payload['observationLocalId'], 'observation')
          : null,
        offsetId: str(payload['offsetLocalId'])
          ? await parentId(tx, 'offset', payload['offsetLocalId'], 'offset record')
          : null,
        storageKey: str(payload['storageKey']),
        thumbnailKey: str(payload['thumbnailKey']),
        mimeType: str(payload['mimeType']) ?? 'image/jpeg',
        bytes: num(payload['bytes']),
        width: num(payload['width']),
        height: num(payload['height']),
        sha256: str(payload['sha256']),
        caption: str(payload['caption']),
        annotations: (payload['annotations'] ?? null) as Prisma.InputJsonValue,
        metadata: (payload['metadata'] ?? null) as Prisma.InputJsonValue,
        capturedAt: date(payload['capturedAt']) ?? new Date(),
        capturedById: str(payload['capturedById']) ?? ctx.userId,
      };

    default:
      throw new SyncReject(`Unsupported record type ${entityType}.`);
  }
}

/** Models that carry a human-readable record identifier. */
const RECORD_ID_ENTITIES: Partial<Record<EntityType, RecordPrefix>> = {
  FACE_MEASUREMENT: RECORD_PREFIXES['FACE_MEASUREMENT']!,
  FACE_LOG: RECORD_PREFIXES['FACE_LOG']!,
  OBSERVATION: RECORD_PREFIXES['OBSERVATION']!,
  STRUCTURE: RECORD_PREFIXES['STRUCTURE']!,
  OFFSET: RECORD_PREFIXES['OFFSET']!,
  HAZARD: RECORD_PREFIXES['HAZARD']!,
};

const MODEL_FOR: Record<
  EntityType,
  'faceLog' | 'observation' | 'reefObservation' | 'structure' | 'offset' | 'sample' | 'hazard' | 'photo' | 'faceMeasurement'
> = {
  FACE_LOG: 'faceLog',
  OBSERVATION: 'observation',
  REEF_OBSERVATION: 'reefObservation',
  STRUCTURE: 'structure',
  OFFSET: 'offset',
  SAMPLE: 'sample',
  HAZARD: 'hazard',
  PHOTO: 'photo',
  FACE_MEASUREMENT: 'faceMeasurement',
};

/* ── the route ────────────────────────────────────────────────────────── */

export default async function syncRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;

  /**
   * The offline cache a device fills on surface and carries underground:
   * everything needed to capture a full shift with no network at all (§5).
   */
  app.get('/sync/reference', { preHandler: [app.authenticate] }, async () => {
    const [config, mines, workplaces] = await Promise.all([
      loadValidationConfig(),
      prisma.mine.findMany({
        where: { active: true },
        include: { sections: { where: { active: true } } },
      }),
      prisma.workplace.findMany({
        where: { active: true },
        include: { section: { include: { mine: true } } },
        orderBy: { code: 'asc' },
      }),
    ]);

    return {
      fetchedAt: new Date().toISOString(),
      convention: config.convention,
      referenceLists: config.lists,
      validationRules: config.rules,
      mines,
      workplaces: workplaces.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        workplaceType: w.workplaceType,
        bord: w.bord,
        strikeBelt: w.strikeBelt,
        drive: w.drive,
        stope: w.stope,
        face: w.face,
        sectionId: w.sectionId,
        sectionCode: w.section.code,
        sectionName: w.section.name,
        mineCode: w.section.mine.code,
      })),
    };
  });

  app.post('/sync/batch', { preHandler: [app.requireAction('facelog:submit')] }, async (request) => {
    const body = batchSchema.parse(request.body);
    const auth = request.auth!;
    const config = await loadValidationConfig();

    // A batch that has already landed is acknowledged from its stored results
    // rather than reprocessed: a device that lost the response mid-cage-ride
    // gets the same answer back.
    const existingBatch = await prisma.syncBatch.findUnique({
      where: { batchId: body.batchId },
      include: { operations: true },
    });
    if (existingBatch) {
      return {
        batchId: existingBatch.batchId,
        receivedAt: existingBatch.receivedAt.toISOString(),
        replayed: true,
        results: existingBatch.operations.map((o) => ({
          localId: o.localId,
          status: o.status,
          serverId: o.serverId ?? undefined,
          message: o.message ?? undefined,
          conflict: (o.conflict ?? undefined) as unknown,
        })),
      };
    }

    await prisma.device.upsert({
      where: { deviceId: body.deviceId },
      create: { deviceId: body.deviceId, userId: auth.sub, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    });

    const ordered = [...body.operations].sort((a, b) => {
      const d = DEPENDENCY_ORDER.indexOf(a.entityType) - DEPENDENCY_ORDER.indexOf(b.entityType);
      return d !== 0 ? d : a.queuedAt.localeCompare(b.queuedAt);
    });

    const results: Array<{
      localId: string;
      status: SyncOperationStatus;
      serverId?: string;
      recordId?: string;
      serverVersion?: number;
      message?: string;
      conflict?: unknown;
    }> = [];

    for (const op of ordered) {
      results.push(await processOperation(op, { auth, deviceId: body.deviceId, site: env.SITE_CODE, config, ip: request.ip, batchId: body.batchId }));
    }

    const tally = (s: SyncOperationStatus) => results.filter((r) => r.status === s).length;

    await prisma.syncBatch.create({
      data: {
        batchId: body.batchId,
        deviceId: body.deviceId,
        userId: auth.sub,
        sentAt: new Date(body.sentAt),
        opCount: results.length,
        appliedCount: tally('APPLIED'),
        duplicateCount: tally('DUPLICATE'),
        conflictCount: tally('CONFLICT'),
        failedCount: tally('REJECTED') + tally('FAILED'),
        operations: {
          create: results.map((r, i) => ({
            localId: r.localId,
            entityType: ordered[i]!.entityType,
            op: ordered[i]!.op,
            clientVersion: ordered[i]!.clientVersion,
            baseVersion: ordered[i]!.baseVersion ?? null,
            status: r.status,
            serverId: r.serverId ?? null,
            message: r.message ?? null,
            conflict: (r.conflict ?? null) as Prisma.InputJsonValue,
          })),
        },
      },
    });

    return { batchId: body.batchId, receivedAt: new Date().toISOString(), results };
  });

  async function processOperation(
    op: Operation,
    ctx: {
      auth: { sub: string; role: string };
      deviceId: string;
      site: string;
      config: Awaited<ReturnType<typeof loadValidationConfig>>;
      ip: string;
      batchId: string;
    },
  ) {
    const model = MODEL_FOR[op.entityType];
    const payload: Record<string, unknown> = { ...op.payload, localId: op.localId };

    try {
      // The same rules the device ran, run again here. A device on stale
      // configuration cannot smuggle a value the mine's current rules reject.
      const validation = validateRecord(op.entityType, payload, {
        convention: ctx.config.convention,
        lists: ctx.config.lists,
        rules: ctx.config.rules,
      });
      if (!validation.ok) {
        return {
          localId: op.localId,
          status: 'REJECTED' as const,
          message: validation.errors.map((e) => e.message).join(' '),
          conflict: { validationErrors: validation.errors },
        };
      }

      return await prisma.$transaction(async (tx) => {
        const records = delegateFor(tx, model);
        const existing = await records.findUnique({ where: { localId: op.localId } });

        if (existing && op.op === 'CREATE') {
          // Idempotency. A replayed create is a success, not a duplicate record:
          // this is what makes it safe to retry a batch forever.
          return {
            localId: op.localId,
            status: 'DUPLICATE' as const,
            serverId: existing.id,
            recordId: existing.recordId,
            serverVersion: existing.version,
          };
        }

        if (existing && detectConflict({ baseVersion: op.baseVersion, serverVersion: existing.version })) {
          // Never resolved automatically: geological observations are not
          // last-write-wins. Both versions are preserved for a person to judge.
          return {
            localId: op.localId,
            status: 'CONFLICT' as const,
            serverId: existing.id,
            serverVersion: existing.version,
            message: 'This record changed on the server after your device last saw it. Both versions have been kept for review.',
            conflict: {
              entityType: op.entityType,
              localId: op.localId,
              serverId: existing.id,
              localVersion: payload,
              serverVersion: JSON.parse(JSON.stringify(existing)),
              conflictingFields: conflictingFields(payload, JSON.parse(JSON.stringify(existing))),
              detectedAt: new Date().toISOString(),
            },
          };
        }

        const version = existing ? existing.version + 1 : 1;
        const data = await buildData(tx, op.entityType, payload, {
          deviceId: ctx.deviceId,
          userId: ctx.auth.sub,
          site: ctx.site,
          version,
        });

        // The definitive record identifier replaces any provisional one minted
        // on the device while it was offline.
        const prefix = RECORD_ID_ENTITIES[op.entityType];
        if (prefix && !existing) {
          const provided = str(payload['recordId']);
          data['recordId'] =
            provided && !isProvisional(provided)
              ? provided
              : await nextRecordId(tx, { site: ctx.site, prefix });
        }

        const saved = existing
          ? await records.update({ where: { localId: op.localId }, data })
          : await records.create({ data });

        await recordVersion(tx, {
          entityType: op.entityType,
          entityId: saved.id,
          version,
          snapshot: JSON.parse(JSON.stringify(saved)),
          reason: existing ? 'Device update' : 'Captured underground',
          createdById: ctx.auth.sub,
        });

        await recordAudit(tx, {
          userId: ctx.auth.sub,
          entity: op.entityType,
          entityId: saved.id,
          action: existing ? 'SYNC_UPDATE' : 'SYNC_CREATE',
          oldValue: existing ? JSON.parse(JSON.stringify(existing)) : null,
          newValue: JSON.parse(JSON.stringify(saved)),
          deviceId: ctx.deviceId,
          syncBatchId: ctx.batchId,
          ipAddress: ctx.ip,
        });

        return {
          localId: op.localId,
          status: 'APPLIED' as const,
          serverId: saved.id,
          recordId: saved.recordId,
          serverVersion: version,
        };
      });
    } catch (err) {
      if (err instanceof SyncReject) {
        return { localId: op.localId, status: 'REJECTED' as const, message: err.message };
      }
      // A unique-constraint collision on a sample number is a real geological
      // problem, not a transport failure — say so precisely.
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        const target = ((err as { meta?: { target?: string[] } }).meta?.target ?? []).join(', ');
        return {
          localId: op.localId,
          status: 'REJECTED' as const,
          message: target.includes('sampleNumber')
            ? 'This sample number is already in use. Sample numbers must be unique — renumber the sample and it will sync.'
            : `This record conflicts with an existing one (${target}).`,
        };
      }
      app.log.error({ err }, 'sync operation failed');
      return {
        localId: op.localId,
        status: 'FAILED' as const,
        message: 'The server could not file this record. It stays on your device and will be retried automatically.',
      };
    }
  }
}
