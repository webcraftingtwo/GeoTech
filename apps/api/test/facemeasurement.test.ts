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

/** The readings from Face Marking Sheet NS3, 12-07-10. */
const NS3_STATIONS = [
  { distance: 0, hangingwall: 2.45, footwall: -1.32 },
  { distance: 1, hangingwall: 2.47, footwall: -1.34 },
  { distance: 2, hangingwall: 2.51, footwall: -1.32 },
  { distance: 3, hangingwall: 2.43, footwall: -1.37 },
].map((s) => ({ ...s, reason: 'Blast over-break' }));

const DECLINE = { code: 'DECLINE', label: 'Decline', hangingwall: 1.5, footwall: -1.0 };

async function syncFaceMeasurement(overrides: Record<string, unknown> = {}) {
  const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
  const measurementLocalId = localId('fms');

  const op = (entityType: string, payload: Record<string, unknown>) => ({
    localId: payload['localId'],
    entityType,
    op: 'CREATE',
    clientVersion: 1,
    payload,
    queuedAt: new Date().toISOString(),
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/batch',
    headers: auth(fx.technician.token),
    payload: {
      batchId: localId('batch'),
      deviceId: 'device-T100',
      sentAt: new Date().toISOString(),
      operations: [
        op('FACE_LOG', fl),
        op('FACE_MEASUREMENT', {
          localId: measurementLocalId,
          faceLogLocalId: fl.localId,
          distanceFromPeg: 5.1,
          blastNumber: '14',
          advance: 1.8,
          faceLength: 7.2,
          stationInterval: 1,
          traverseDirection: 'DOWN_DIP_TO_UP_DIP',
          measurementMethod: 'TAPE_5M',
          limits: DECLINE,
          stations: NS3_STATIONS,
          measuredById: fx.technician.id,
          measuredAt: new Date().toISOString(),
          ...overrides,
        }),
      ],
    },
  });

  return { res, measurementLocalId };
}

describe('face measurement sync (§9.8)', () => {
  it('files a measurement and mints its record identifier', async () => {
    const { res } = await syncFaceMeasurement();
    const result = res.json().results.find((r: { entityType?: string; recordId?: string }) => r.recordId?.includes('FMS'));

    expect(res.json().results.every((r: { status: string }) => r.status === 'APPLIED')).toBe(true);
    expect(result.recordId).toMatch(/^UNK-FMS-\d{4}-\d{6}$/);
    expect(await prisma.faceMeasurement.count()).toBe(1);
  });

  it('stores the applied limits with the readings, not a reference to them', async () => {
    const { measurementLocalId } = await syncFaceMeasurement();
    const stored = await prisma.faceMeasurement.findUniqueOrThrow({ where: { localId: measurementLocalId } });

    expect(stored.limitSetCode).toBe('DECLINE');
    expect(stored.limitHangingwall).toBe(1.5);
    expect(stored.limitFootwall).toBe(-1.0);
  });

  it('recomputes the summary server-side rather than trusting the device', async () => {
    const { measurementLocalId } = await syncFaceMeasurement();
    const stored = await prisma.faceMeasurement.findUniqueOrThrow({ where: { localId: measurementLocalId } });

    expect(stored.stationCount).toBe(4);
    expect(stored.measuredCount).toBe(4);
    // Every NS3 station breaches both limits.
    expect(stored.hangingwallBreaches).toBe(4);
    expect(stored.footwallBreaches).toBe(4);
    // Over-breaks 0.95, 0.97, 1.01, 0.93 → mean 0.965, stored rounded to 0.97.
    expect(stored.meanHangingwallOverbreak).toBe(0.97);
    expect(stored.meanStopeWidth).toBeCloseTo(3.79, 1);
  });

  it('ignores a summary the device claims, deriving it from the readings', async () => {
    // A device sending a flattering summary must not be believed.
    const { measurementLocalId } = await syncFaceMeasurement({ hangingwallBreaches: 0, meanStopeWidth: 1 });
    const stored = await prisma.faceMeasurement.findUniqueOrThrow({ where: { localId: measurementLocalId } });

    expect(stored.hangingwallBreaches).toBe(4);
    expect(stored.meanStopeWidth).toBeCloseTo(3.79, 1);
  });

  it('preserves the readings exactly as captured', async () => {
    const { measurementLocalId } = await syncFaceMeasurement();
    const stored = await prisma.faceMeasurement.findUniqueOrThrow({ where: { localId: measurementLocalId } });
    const stations = stored.stations as typeof NS3_STATIONS;

    expect(stations).toHaveLength(4);
    expect(stations[0]!.hangingwall).toBe(2.45);
    expect(stations[0]!.footwall).toBe(-1.32);
    expect(stations[2]!.hangingwall).toBe(2.51);
  });

  it('records the station interval actually used', async () => {
    const { measurementLocalId } = await syncFaceMeasurement();
    const stored = await prisma.faceMeasurement.findUniqueOrThrow({ where: { localId: measurementLocalId } });
    expect(stored.stationInterval).toBe(1);
  });

  it('refuses a measurement that carries no limits', async () => {
    const { res } = await syncFaceMeasurement({ limits: undefined });
    const rejected = res.json().results.find((r: { status: string }) => r.status === 'REJECTED');
    expect(rejected?.message).toMatch(/no mining-cut limits/i);
    expect(await prisma.faceMeasurement.count()).toBe(0);
  });

  it('is idempotent, like every other record', async () => {
    const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
    const id = localId('fms');
    const payload = {
      localId: id,
      faceLogLocalId: fl.localId,
      distanceFromPeg: 5.1,
      faceLength: 7.2,
      stationInterval: 1,
      limits: DECLINE,
      stations: NS3_STATIONS,
      measuredById: fx.technician.id,
      measuredAt: new Date().toISOString(),
    };
    const op = (entityType: string, p: Record<string, unknown>) => ({
      localId: p['localId'], entityType, op: 'CREATE', clientVersion: 1, payload: p, queuedAt: new Date().toISOString(),
    });
    const send = (batchId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/sync/batch',
        headers: auth(fx.technician.token),
        payload: { batchId, deviceId: 'device-T100', sentAt: new Date().toISOString(), operations: [op('FACE_LOG', fl), op('FACE_MEASUREMENT', payload)] },
      });

    await send(localId('b1'));
    const second = await send(localId('b2'));
    expect(second.json().results.every((r: { status: string }) => r.status === 'DUPLICATE')).toBe(true);
    expect(await prisma.faceMeasurement.count()).toBe(1);
  });
});

describe('stope width control report (§9.8.vii)', () => {
  beforeEach(async () => {
    await syncFaceMeasurement();
  });

  it('reports each face with the limits that were applied to it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/width-control',
      headers: auth(fx.geologist.token),
    });
    const body = res.json();

    expect(body.count).toBe(1);
    expect(body.rows[0]).toMatchObject({
      section: '12 South',
      workplace: '12S-B4',
      limitSet: 'DECLINE',
      hangingwallLimit: 1.5,
      footwallLimit: -1,
      hangingwallBreaches: 4,
    });
    expect(body.basis).toMatch(/§9\.8/);
  });

  it('serves CSV for the width-control spreadsheet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/width-control?format=csv',
      headers: auth(fx.geologist.token),
    });
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.body.split('\n')[0]).toContain('meanStopeWidth');
  });

  it('is not available to a technician', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/width-control',
      headers: auth(fx.technician.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
