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

/** Syncs a complete face log → observation → structure → offset package. */
async function seedOffset(): Promise<{ faceLogId: string; offsetId: string }> {
  const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
  const obsId = localId('obs');
  const strId = localId('str');
  const offId = localId('off');

  const op = (entityType: string, payload: Record<string, unknown>) => ({
    localId: payload['localId'],
    entityType,
    op: 'CREATE',
    clientVersion: 1,
    payload,
    queuedAt: new Date().toISOString(),
  });

  await app.inject({
    method: 'POST',
    url: '/api/v1/sync/batch',
    headers: auth(fx.technician.token),
    payload: {
      batchId: localId('batch'),
      deviceId: 'device-T100',
      sentAt: new Date().toISOString(),
      operations: [
        op('FACE_LOG', fl),
        op('OBSERVATION', {
          localId: obsId,
          faceLogLocalId: fl.localId,
          observationType: 'FAULT',
          confidence: 'MEDIUM',
          observedById: fx.technician.id,
          observedAt: new Date().toISOString(),
        }),
        op('STRUCTURE', {
          localId: strId,
          observationLocalId: obsId,
          structureType: 'FAULT',
          strike: 10,
          dip: 57,
          dipDirection: 100,
          measurementSource: 'MANUAL',
          confidence: 'MEDIUM',
          structureRef: 'F-012',
        }),
        op('OFFSET', {
          localId: offId,
          structureLocalId: strId,
          markerType: 'REEF',
          apparentOffset: 2.5,
          unit: 'M',
          verticalSense: 'DOWN',
          confidence: 'HIGH',
          observedById: fx.technician.id,
          observedAt: new Date().toISOString(),
        }),
      ],
    },
  });

  const faceLog = await prisma.faceLog.findUniqueOrThrow({ where: { localId: fl.localId } });
  const offset = await prisma.offset.findUniqueOrThrow({ where: { localId: offId } });
  return { faceLogId: faceLog.id, offsetId: offset.id };
}

describe('observation and interpretation are separate value spaces (§13, §49)', () => {
  it('records an interpreted throw without touching the observed offset', async () => {
    const { offsetId } = await seedOffset();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(fx.geologist.token),
      payload: {
        entityType: 'OFFSET',
        entityId: offsetId,
        field: 'throw',
        value: 2.1,
        confidence: 'MEDIUM',
        comment: 'Resolved for a 57 degree dip.',
      },
    });
    expect(res.statusCode).toBe(200);

    const offset = await prisma.offset.findUniqueOrThrow({ where: { id: offsetId } });
    // The technician measured 2.5 m. That value is still 2.5 m.
    expect(offset.apparentOffset).toBe(2.5);
    expect(offset.confidence).toBe('HIGH');
    // The geologist's 2.1 m sits alongside it.
    expect(offset.interpretedThrow).toBe(2.1);
    expect(offset.interpretationConfidence).toBe('MEDIUM');
    expect(offset.interpretedById).toBe(fx.geologist.id);
  });

  it('supersedes an earlier interpretation without deleting it', async () => {
    const { offsetId } = await seedOffset();
    const post = (value: number, comment: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/interpretations',
        headers: auth(fx.geologist.token),
        payload: { entityType: 'OFFSET', entityId: offsetId, field: 'throw', value, confidence: 'MEDIUM', comment },
      });

    await post(2.1, 'First reading.');
    await post(2.3, 'Revised after reviewing the photograph.');

    const history = await prisma.interpretation.findMany({
      where: { entityType: 'OFFSET', entityId: offsetId },
      orderBy: { interpretedAt: 'asc' },
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.supersededById).toBe(history[1]?.id);
    expect(history[0]?.value).toBe(2.1); // the earlier reading is still readable
    expect(history[1]?.supersededById).toBeNull();
  });

  it('refuses to interpret a field that is not interpretable', async () => {
    const { offsetId } = await seedOffset();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(fx.geologist.token),
      payload: {
        entityType: 'OFFSET',
        entityId: offsetId,
        // The observed measurement itself is not an interpretable field.
        field: 'apparentOffset',
        value: 9.9,
        confidence: 'HIGH',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('interpretation.field_not_interpretable');

    const offset = await prisma.offset.findUniqueOrThrow({ where: { id: offsetId } });
    expect(offset.apparentOffset).toBe(2.5);
  });

  it('returns observed and interpreted as separate blocks, never merged', async () => {
    const { offsetId } = await seedOffset();
    await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(fx.geologist.token),
      payload: { entityType: 'OFFSET', entityId: offsetId, field: 'throw', value: 2.1, confidence: 'LOW' },
    });

    const res = await app.inject({ method: 'GET', url: `/api/v1/offsets/${offsetId}`, headers: auth(fx.geologist.token) });
    const body = res.json();

    expect(body.observed.apparentOffset).toBe(2.5);
    expect(body.observed.confidence).toBe('HIGH');
    expect(body.interpreted.throw).toBe(2.1);
    expect(body.interpreted.confidence).toBe('LOW');
    expect(body.interpretationHistory).toHaveLength(1);
  });
});

describe('role boundaries are enforced by the server (§31, §49)', () => {
  it('stops a technician writing an interpretation', async () => {
    const { offsetId } = await seedOffset();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(fx.technician.token),
      payload: { entityType: 'OFFSET', entityId: offsetId, field: 'throw', value: 1, confidence: 'HIGH' },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.interpretation.count()).toBe(0);
  });

  it('stops a technician reaching administration', async () => {
    for (const url of ['/api/v1/admin/users', '/api/v1/admin/validation-rules']) {
      const res = await app.inject({ method: 'GET', url, headers: auth(fx.technician.token) });
      expect(res.statusCode).toBe(403);
    }
  });

  it('stops a geologist managing users or reference data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(fx.geologist.token) });
    expect(res.statusCode).toBe(403);
  });

  it('stops a technician reviewing records', async () => {
    const { faceLogId } = await seedOffset();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/review/FACE_LOG/${faceLogId}`,
      headers: auth(fx.technician.token),
      payload: { status: 'VALIDATED', comment: 'Looks fine to me.' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('shows a technician their own face logs and not another technician’s', async () => {
    const { faceLogId } = await seedOffset();

    const own = await app.inject({ method: 'GET', url: '/api/v1/face-logs', headers: auth(fx.technician.token) });
    expect(own.json().items).toHaveLength(1);

    const other = await app.inject({ method: 'GET', url: '/api/v1/face-logs', headers: auth(fx.otherTechnician.token) });
    expect(other.json().items).toHaveLength(0);

    const direct = await app.inject({
      method: 'GET',
      url: `/api/v1/face-logs/${faceLogId}`,
      headers: auth(fx.otherTechnician.token),
    });
    expect(direct.statusCode).toBe(404);

    // The geologist sees the mine's work.
    const geologist = await app.inject({ method: 'GET', url: '/api/v1/face-logs', headers: auth(fx.geologist.token) });
    expect(geologist.json().items).toHaveLength(1);
  });

  it('stops a live token belonging to a deactivated account', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(fx.technician.token) });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${fx.technician.id}/deactivate`,
      headers: auth(fx.admin.token),
    });

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(fx.technician.token) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.message).toMatch(/no longer active/i);
  });

  it('limits an offline capture grant to capture only', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'G100', password: 'TestPass123', deviceId: 'device-offline' },
    });
    const offlineGrant = login.json().offlineGrant as string;
    const { offsetId } = await seedOffset();

    // The same geologist, on a full session, may interpret.
    const online = await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(fx.geologist.token),
      payload: { entityType: 'OFFSET', entityId: offsetId, field: 'throw', value: 2.1, confidence: 'HIGH' },
    });
    expect(online.statusCode).toBe(200);

    // On the offline grant carried underground, they may not.
    const offline = await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(offlineGrant),
      payload: { entityType: 'OFFSET', entityId: offsetId, field: 'heave', value: 1.3, confidence: 'HIGH' },
    });
    expect(offline.statusCode).toBe(403);
    expect(offline.json().error.message).toMatch(/offline capture grant/i);
  });
});

describe('audit trail cannot be altered (§21, §49)', () => {
  it('exposes no route that modifies or deletes audit entries', async () => {
    const { faceLogId } = await seedOffset();
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: faceLogId } });

    for (const method of ['PATCH', 'PUT', 'DELETE', 'POST'] as const) {
      for (const token of [fx.admin.token, fx.geologist.token, fx.technician.token]) {
        const res = await app.inject({
          method,
          url: `/api/v1/audit/${entry.id}`,
          headers: auth(token),
          payload: { action: 'TAMPERED' },
        });
        // No such route exists at any role — not "forbidden", simply absent.
        expect(res.statusCode).toBe(404);
      }
    }

    const unchanged = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(unchanged.action).toBe(entry.action);
  });

  it('records the whole provenance of a record in one answer (§40)', async () => {
    const { faceLogId, offsetId } = await seedOffset();

    await app.inject({
      method: 'POST',
      url: '/api/v1/interpretations',
      headers: auth(fx.geologist.token),
      payload: { entityType: 'OFFSET', entityId: offsetId, field: 'throw', value: 2.1, confidence: 'MEDIUM', comment: 'Dip-slip.' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/review/FACE_LOG/${faceLogId}`,
      headers: auth(fx.geologist.token),
      payload: { status: 'VALIDATED', comment: 'Consistent with the adjacent panel.' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/record/OFFSET/${offsetId}`,
      headers: auth(fx.geologist.token),
    });
    const body = res.json();

    expect(body.audit.some((a: { action: string }) => a.action === 'SYNC_CREATE')).toBe(true);
    expect(body.audit.some((a: { action: string }) => a.action === 'INTERPRETATION_ADDED')).toBe(true);
    expect(body.versions).toHaveLength(1);
    expect(body.interpretations).toHaveLength(1);
  });

  it('denies the audit trail to a technician', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: auth(fx.technician.token) });
    expect(res.statusCode).toBe(403);
  });
});

describe('review workflow (§20)', () => {
  it('moves a face log to validated and notifies the technician', async () => {
    const { faceLogId } = await seedOffset();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/review/FACE_LOG/${faceLogId}`,
      headers: auth(fx.geologist.token),
      payload: { status: 'VALIDATED', comment: 'Accepted.' },
    });
    expect(res.statusCode).toBe(200);

    const log = await prisma.faceLog.findUniqueOrThrow({ where: { id: faceLogId } });
    expect(log.status).toBe('VALIDATED');

    const notifications = await prisma.notification.findMany({ where: { userId: fx.technician.id } });
    expect(notifications).toHaveLength(1);
  });

  it('requires a comment on anything other than a plain acceptance', async () => {
    const { faceLogId } = await seedOffset();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/review/FACE_LOG/${faceLogId}`,
      headers: auth(fx.geologist.token),
      payload: { status: 'REJECTED' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/what to do next/i);
  });

  it('leaves the technician’s observation untouched when a log is rejected', async () => {
    const { faceLogId, offsetId } = await seedOffset();
    await app.inject({
      method: 'POST',
      url: `/api/v1/review/FACE_LOG/${faceLogId}`,
      headers: auth(fx.geologist.token),
      payload: { status: 'REJECTED', comment: 'Survey reference does not match the plan.' },
    });

    const offset = await prisma.offset.findUniqueOrThrow({ where: { id: offsetId } });
    expect(offset.apparentOffset).toBe(2.5);
    expect(offset.confidence).toBe('HIGH');
  });
});
