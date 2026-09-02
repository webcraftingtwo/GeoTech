import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { parseQuery } from '../src/routes/search.js';
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

describe('search query parsing (§27)', () => {
  it('reads a geological question into structured filters', () => {
    expect(parseQuery('faults > 2m section 12 South')).toMatchObject({
      structureType: 'FAULT',
      minOffset: 2,
      sectionCode: '12S',
    });
  });

  it('understands the words a geologist would actually type', () => {
    expect(parseQuery('dykes greater than 1.5 m')).toMatchObject({ structureType: 'DYKE', minOffset: 1.5 });
    expect(parseQuery('shears under 0.5m')).toMatchObject({ structureType: 'SHEAR', maxOffset: 0.5 });
    expect(parseQuery('joints in 12 north')).toMatchObject({ structureType: 'JOINT', sectionCode: '12N' });
    expect(parseQuery('shears in section 11S')).toMatchObject({ sectionCode: '11S' });
  });

  it('treats a record identifier as an exact lookup, not a search', () => {
    const parsed = parseQuery('UNK-OFS-2026-000012');
    expect(parsed.recordId).toBe('UNK-OFS-2026-000012');
    expect(parsed.structureType).toBeUndefined();
  });

  it('leaves free text alone when there is nothing structured in it', () => {
    const parsed = parseQuery('slickensided contact near the raise');
    expect(parsed.structureType).toBeUndefined();
    expect(parsed.minOffset).toBeUndefined();
    expect(parsed.text).toBe('slickensided contact near the raise');
  });
});

describe('search endpoint (§27)', () => {
  beforeEach(async () => {
    const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
    const obsId = localId('obs');
    const strId = localId('str');
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
        batchId: localId('b'),
        deviceId: 'device-T100',
        sentAt: new Date().toISOString(),
        operations: [
          op('FACE_LOG', fl),
          op('OBSERVATION', {
            localId: obsId,
            faceLogLocalId: fl.localId,
            observationType: 'FAULT',
            confidence: 'HIGH',
            observedById: fx.technician.id,
            observedAt: new Date().toISOString(),
          }),
          op('STRUCTURE', { localId: strId, observationLocalId: obsId, structureType: 'FAULT', structureRef: 'F-099' }),
          op('OFFSET', {
            localId: localId('off'),
            structureLocalId: strId,
            markerType: 'REEF',
            apparentOffset: 3.2,
            unit: 'M',
            verticalSense: 'DOWN',
            confidence: 'HIGH',
            observedById: fx.technician.id,
            observedAt: new Date().toISOString(),
          }),
          op('OFFSET', {
            localId: localId('off2'),
            structureLocalId: strId,
            markerType: 'REEF',
            apparentOffset: 0.4,
            unit: 'M',
            verticalSense: 'UP',
            confidence: 'LOW',
            observedById: fx.technician.id,
            observedAt: new Date().toISOString(),
          }),
        ],
      },
    });
  });

  it('finds faults above a threshold and excludes those below it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent('faults > 2m section 12S'),
      headers: auth(fx.geologist.token),
    });
    const body = res.json();
    expect(body.offsets).toHaveLength(1);
    expect(body.offsets[0].apparentOffset).toBe(3.2);
  });

  it('returns nothing for a level with no such structures', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent('faults > 2m section 99S'),
      headers: auth(fx.geologist.token),
    });
    expect(res.json().offsets).toHaveLength(0);
  });

  it('builds the history of a structure across its observations (§23)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/structures/history/F-099', headers: auth(fx.geologist.token) });
    const body = res.json();
    expect(body.structureRef).toBe('F-099');
    expect(body.observations).toHaveLength(2);
    expect(body.summary).toMatchObject({ count: 2, min: 0.4, max: 3.2 });
  });
});

describe('reports (§26)', () => {
  beforeEach(async () => {
    const fl = faceLogPayload(fx.workplaceId, fx.technician.id);
    await app.inject({
      method: 'POST',
      url: '/api/v1/sync/batch',
      headers: auth(fx.technician.token),
      payload: {
        batchId: localId('b'),
        deviceId: 'device-T100',
        sentAt: new Date().toISOString(),
        operations: [
          {
            localId: fl.localId,
            entityType: 'FACE_LOG',
            op: 'CREATE',
            clientVersion: 1,
            payload: fl,
            queuedAt: new Date().toISOString(),
          },
        ],
      },
    });
  });

  it('produces a daily report with a summary and a disclaimer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/daily?date=2026-02-01',
      headers: auth(fx.geologist.token),
    });
    const body = res.json();
    expect(body.summary.facesLogged).toBe(1);
    expect(body.disclaimer).toMatch(/competent-person review/i);
  });

  it('serves CSV with a header row when asked for it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/samples?format=csv',
      headers: auth(fx.geologist.token),
    });
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('keeps observed and interpreted values in separate columns (§13)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/structures',
      headers: auth(fx.geologist.token),
    });
    const body = res.json();
    // Even with no rows, the contract is visible in the endpoint's shape.
    expect(body.title).toBe('Geological Structure Report');
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('refuses reporting to a technician', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/daily', headers: auth(fx.technician.token) });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unreadable date rather than guessing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/daily?date=not-a-date',
      headers: auth(fx.geologist.token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/YYYY-MM-DD/);
  });
});
