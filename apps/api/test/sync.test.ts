import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { auth, buildTestApp, faceLogPayload, localId, resetDatabase, seedFixtures, type Fixtures } from './helpers.js';

let app: FastifyInstance;
let fx: Fixtures;

beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  fx = await seedFixtures(app);
});

const sendBatch = (token: string, batchId: string, operations: unknown[], deviceId = 'device-T100') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/sync/batch',
    headers: auth(token),
    payload: { batchId, deviceId, sentAt: new Date().toISOString(), operations },
  });

const createOp = (entityType: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  localId: payload['localId'],
  entityType,
  op: 'CREATE',
  clientVersion: 1,
  payload,
  queuedAt: new Date().toISOString(),
  ...extra,
});

describe('sync ingest (§30, §49)', () => {
  it('applies a face log and mints a definitive record identifier', async () => {
    const payload = faceLogPayload(fx.workplaceId, fx.technician.id);
    const res = await sendBatch(fx.technician.token, 'batch-1', [createOp('FACE_LOG', payload)]);

    expect(res.statusCode).toBe(200);
    const result = res.json().results[0];
    expect(result.status).toBe('APPLIED');
    expect(result.recordId).toMatch(/^UNK-FL-\d{4}-\d{6}$/);
    expect(await prisma.faceLog.count()).toBe(1);
  });

  it('replaces a provisional identifier minted offline with the server sequence', async () => {
    const payload = {
      ...faceLogPayload(fx.workplaceId, fx.technician.id),
      recordId: 'UNK-FL-2026-000003-A1B2',
    };
    const res = await sendBatch(fx.technician.token, 'batch-prov', [createOp('FACE_LOG', payload)]);
    const result = res.json().results[0];
    expect(result.recordId).not.toContain('A1B2');
    expect(result.recordId).toMatch(/^UNK-FL-\d{4}-\d{6}$/);
  });

  it('is idempotent: replaying the same operation creates no second record', async () => {
    const payload = faceLogPayload(fx.workplaceId, fx.technician.id);

    const first = await sendBatch(fx.technician.token, 'batch-a', [createOp('FACE_LOG', payload)]);
    expect(first.json().results[0].status).toBe('APPLIED');

    // Same record, different batch — the device never saw the first response.
    const second = await sendBatch(fx.technician.token, 'batch-b', [createOp('FACE_LOG', payload)]);
    expect(second.json().results[0].status).toBe('DUPLICATE');
    expect(second.json().results[0].serverId).toBe(first.json().results[0].serverId);

    expect(await prisma.faceLog.count()).toBe(1);
  });

  it('replays an entire batch from stored results when the response was lost', async () => {
    const payload = faceLogPayload(fx.workplaceId, fx.technician.id);
    await sendBatch(fx.technician.token, 'batch-same', [createOp('FACE_LOG', payload)]);
    const replay = await sendBatch(fx.technician.token, 'batch-same', [createOp('FACE_LOG', payload)]);

    expect(replay.json().replayed).toBe(true);
    expect(await prisma.faceLog.count()).toBe(1);
    expect(await prisma.syncBatch.count()).toBe(1);
  });

  it('files a whole face-log package regardless of the order the device queued it', async () => {
    const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
    const obsId = localId('obs');
    const strId = localId('str');
    const offId = localId('off');

    // Deliberately reversed: offset first, face log last.
    const operations = [
      createOp('OFFSET', {
        localId: offId,
        structureLocalId: strId,
        markerType: 'REEF',
        apparentOffset: 2.5,
        unit: 'M',
        verticalSense: 'DOWN',
        lateralSense: 'RIGHT',
        confidence: 'HIGH',
        observedById: fx.technician.id,
        observedAt: new Date().toISOString(),
      }),
      createOp('STRUCTURE', {
        localId: strId,
        observationLocalId: obsId,
        structureType: 'FAULT',
        strike: 10,
        dip: 60,
        dipDirection: 100,
        measurementSource: 'MANUAL',
        confidence: 'HIGH',
        structureRef: 'F-012',
      }),
      createOp('OBSERVATION', {
        localId: obsId,
        faceLogLocalId: fl.localId,
        observationType: 'FAULT',
        confidence: 'HIGH',
        observedById: fx.technician.id,
        observedAt: new Date().toISOString(),
      }),
      createOp('FACE_LOG', fl),
    ];

    const res = await sendBatch(fx.technician.token, 'batch-order', operations);
    const statuses = res.json().results.map((r: { status: string }) => r.status);
    expect(statuses.every((s: string) => s === 'APPLIED')).toBe(true);

    const offset = await prisma.offset.findFirst({ include: { structure: { include: { observation: true } } } });
    expect(offset?.apparentOffset).toBe(2.5);
    expect(offset?.structure.structureRef).toBe('F-012');
  });

  it('rejects a record the mine rules cannot accept, and says why', async () => {
    // Dip of 175 degrees is outside the configured convention.
    const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
    const obsId = localId('obs');
    const res = await sendBatch(fx.technician.token, 'batch-bad', [
      createOp('FACE_LOG', fl),
      createOp('OBSERVATION', {
        localId: obsId,
        faceLogLocalId: fl.localId,
        observationType: 'FAULT',
        dip: 175,
        observedById: fx.technician.id,
        observedAt: new Date().toISOString(),
      }),
    ]);

    const obsResult = res.json().results.find((r: { localId: string }) => r.localId === obsId);
    expect(obsResult.status).toBe('REJECTED');
    expect(obsResult.message).toMatch(/175/);
    expect(obsResult.message).toMatch(/convention/i);
  });

  it('holds a child record when its parent has not arrived, without losing it', async () => {
    const res = await sendBatch(fx.technician.token, 'batch-orphan', [
      createOp('OBSERVATION', {
        localId: localId('obs'),
        faceLogLocalId: 'never-synced',
        observationType: 'FAULT',
        confidence: 'LOW',
        observedById: fx.technician.id,
        observedAt: new Date().toISOString(),
      }),
    ]);

    const result = res.json().results[0];
    expect(result.status).toBe('REJECTED');
    expect(result.message).toMatch(/retried automatically/i);
  });

  it('detects a conflict and keeps both versions instead of overwriting', async () => {
    const payload = faceLogPayload(fx.workplaceId, fx.technician.id);
    await sendBatch(fx.technician.token, 'batch-c1', [createOp('FACE_LOG', payload)]);

    // The device edits from version 1; meanwhile the server is already at 2.
    await sendBatch(fx.technician.token, 'batch-c2', [
      { ...createOp('FACE_LOG', { ...payload, faceAdvance: 2.2 }), op: 'UPDATE', clientVersion: 2, baseVersion: 1 },
    ]);

    const conflicting = await sendBatch(fx.technician.token, 'batch-c3', [
      { ...createOp('FACE_LOG', { ...payload, faceAdvance: 9.9 }), op: 'UPDATE', clientVersion: 3, baseVersion: 1 },
    ]);

    const result = conflicting.json().results[0];
    expect(result.status).toBe('CONFLICT');
    expect(result.conflict.conflictingFields).toContain('faceAdvance');
    expect(result.conflict.localVersion.faceAdvance).toBe(9.9);
    expect(result.conflict.serverVersion.faceAdvance).toBe(2.2);

    // The server value is untouched by the conflicting attempt.
    const stored = await prisma.faceLog.findUnique({ where: { localId: payload.localId } });
    expect(stored?.faceAdvance).toBe(2.2);
  });

  it('refuses a duplicate sample number with an actionable message', async () => {
    const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
    await sendBatch(fx.technician.token, 'batch-s1', [createOp('FACE_LOG', fl)]);

    const sample = (id: string) => ({
      localId: id,
      faceLogLocalId: fl.localId,
      sampleNumber: 'UNK-SMP-0001',
      sampleType: 'CHIP',
      collectedAt: new Date().toISOString(),
      collectedById: fx.technician.id,
    });

    await sendBatch(fx.technician.token, 'batch-s2', [createOp('SAMPLE', sample(localId('sm')))]);
    const second = await sendBatch(fx.technician.token, 'batch-s3', [createOp('SAMPLE', sample(localId('sm')))]);

    const result = second.json().results[0];
    expect(result.status).toBe('REJECTED');
    expect(result.message).toMatch(/already in use/i);
    expect(await prisma.sample.count()).toBe(1);
  });

  it('writes a version snapshot and an audit entry for every applied record', async () => {
    const payload = faceLogPayload(fx.workplaceId, fx.technician.id);
    await sendBatch(fx.technician.token, 'batch-audit', [createOp('FACE_LOG', payload)]);

    const log = await prisma.faceLog.findUnique({ where: { localId: payload.localId } });
    const versions = await prisma.recordVersion.findMany({ where: { entityId: log!.id } });
    const audit = await prisma.auditLog.findMany({ where: { entityId: log!.id } });

    expect(versions).toHaveLength(1);
    expect(audit.some((a) => a.action === 'SYNC_CREATE')).toBe(true);
    expect(audit[0]?.deviceId).toBe('device-T100');
  });

  it('serves the offline reference bundle a device carries underground', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/reference', headers: auth(fx.technician.token) });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.referenceLists.length).toBeGreaterThan(10);
    expect(body.workplaces.length).toBeGreaterThan(0);
    expect(body.convention.dipMax).toBe(90);
  });
});
