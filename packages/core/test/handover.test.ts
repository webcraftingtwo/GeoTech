import { describe, expect, it } from 'vitest';
import {
  buildHandover,
  canonicalise,
  emptyRecords,
  mergeHandovers,
  readHandover,
  type HandoverRecords,
} from '../src/index.js';

const device = { deviceId: 'device-a' };
const technician = { id: 'u1', name: 'T. Chidindi', employeeNo: 'T001' };

function records(overrides: Partial<HandoverRecords> = {}): HandoverRecords {
  return { ...emptyRecords(), ...overrides };
}

const faceLog = (localId: string, version = 1, updatedAt = '2026-02-01T06:00:00.000Z') =>
  ({
    localId,
    recordId: `UNK-FL-2026-${localId}`,
    workplaceId: 'wp1',
    technicianId: 'u1',
    shiftDate: '2026-02-01T00:00:00.000Z',
    shift: 'MORNING',
    status: 'SUBMITTED',
    deviceId: 'device-a',
    version,
    syncState: 'LOCAL_SAVED',
    createdAt: '2026-02-01T06:00:00.000Z',
    updatedAt,
  }) as HandoverRecords['faceLogs'][number];

describe('hand-over file (standalone deployment)', () => {
  it('round-trips a shift of records', async () => {
    const file = await buildHandover({ records: records({ faceLogs: [faceLog('a')] }), device, technician });
    const check = await readHandover(JSON.parse(JSON.stringify(file)));

    expect(check.ok).toBe(true);
    expect(check.problems).toHaveLength(0);
    expect(check.file?.records.faceLogs).toHaveLength(1);
    expect(check.file?.counts.faceLogs).toBe(1);
  });

  it('records the shift dates it covers', async () => {
    const file = await buildHandover({ records: records({ faceLogs: [faceLog('a'), faceLog('b')] }), device, technician });
    expect(file.covering.from).toBe('2026-02-01T00:00:00.000Z');
  });

  it('detects a file altered after export', async () => {
    const file = await buildHandover({ records: records({ faceLogs: [faceLog('a')] }), device, technician });
    const tampered = JSON.parse(JSON.stringify(file));
    tampered.records.faceLogs[0].surveyReference = 'PEG-9999';

    const check = await readHandover(tampered);
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toMatch(/altered or damaged/i);
  });

  it('is not fooled by key order', async () => {
    const file = await buildHandover({ records: records({ faceLogs: [faceLog('a')] }), device, technician });
    const reordered = JSON.parse(JSON.stringify(file));
    const log = reordered.records.faceLogs[0];
    reordered.records.faceLogs[0] = Object.fromEntries(Object.entries(log).reverse());

    const check = await readHandover(reordered);
    expect(check.ok).toBe(true);
  });

  it('refuses a file that is not a hand-over file', async () => {
    expect((await readHandover({ hello: 'world' })).ok).toBe(false);
    expect((await readHandover('not json at all')).ok).toBe(false);
    expect((await readHandover(null)).ok).toBe(false);
  });

  it('refuses a file from a newer format version', async () => {
    const file = await buildHandover({ records: records(), device, technician });
    const check = await readHandover({ ...file, version: 99 });
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toMatch(/newer version/i);
  });

  it('warns about records whose parent is missing rather than hiding them', async () => {
    const orphan = {
      localId: 'obs-1',
      recordId: 'UNK-GEO-1',
      faceLogLocalId: 'never-present',
      observationType: 'FAULT',
      observedById: 'u1',
      observedAt: '2026-02-01T07:00:00.000Z',
      deviceId: 'device-a',
      version: 1,
      syncState: 'LOCAL_SAVED' as const,
      createdAt: '2026-02-01T07:00:00.000Z',
      updatedAt: '2026-02-01T07:00:00.000Z',
    };
    const file = await buildHandover({
      records: records({ observations: [orphan as HandoverRecords['observations'][number]] }),
      device,
      technician,
    });
    const check = await readHandover(JSON.parse(JSON.stringify(file)));

    expect(check.ok).toBe(true);
    expect(check.warnings.some((w) => /parent that is not present/.test(w))).toBe(true);
  });

  it('states in the file itself that it carries no server authorisation', async () => {
    const file = await buildHandover({ records: records(), device, technician });
    expect(file.notice).toMatch(/no server-side authorisation/i);
    expect(file.notice).toMatch(/competent-person review/i);
  });
});

describe('merging files from several devices', () => {
  it('keeps one copy of a record present in two files', () => {
    const a = { records: records({ faceLogs: [faceLog('a')] }) } as never;
    const b = { records: records({ faceLogs: [faceLog('a')] }) } as never;
    expect(mergeHandovers([a, b]).faceLogs).toHaveLength(1);
  });

  it('keeps the higher version of a record', () => {
    const older = { records: records({ faceLogs: [faceLog('a', 1)] }) } as never;
    const newer = { records: records({ faceLogs: [faceLog('a', 3)] }) } as never;
    expect(mergeHandovers([older, newer]).faceLogs[0]?.version).toBe(3);
    // Order of files must not change the outcome.
    expect(mergeHandovers([newer, older]).faceLogs[0]?.version).toBe(3);
  });

  it('falls back to the later timestamp when versions match', () => {
    const early = { records: records({ faceLogs: [faceLog('a', 2, '2026-02-01T06:00:00.000Z')] }) } as never;
    const late = { records: records({ faceLogs: [faceLog('a', 2, '2026-02-01T18:00:00.000Z')] }) } as never;
    expect(mergeHandovers([early, late]).faceLogs[0]?.updatedAt).toBe('2026-02-01T18:00:00.000Z');
  });

  it('combines records from different devices', () => {
    const a = { records: records({ faceLogs: [faceLog('a')] }) } as never;
    const b = { records: records({ faceLogs: [faceLog('b')] }) } as never;
    expect(mergeHandovers([a, b]).faceLogs).toHaveLength(2);
  });
});

describe('canonical serialisation', () => {
  it('is stable regardless of key order', () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe(canonicalise({ a: 2, b: 1 }));
  });

  it('distinguishes genuinely different values', () => {
    expect(canonicalise({ a: 1 })).not.toBe(canonicalise({ a: 2 }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });
});
