import { describe, expect, it } from 'vitest';
import {
  deviceSuffix,
  formatRecordId,
  isProvisional,
  mintProvisionalRecordId,
  newLocalId,
  normaliseSampleNumber,
  parseRecordId,
} from '../src/index.js';

describe('record identifiers (§7)', () => {
  it('formats the identifier a technician reads out underground', () => {
    expect(formatRecordId({ site: 'UNK', prefix: 'FL', year: 2026, sequence: 124 })).toBe(
      'UNK-FL-2026-000124',
    );
  });

  it('round-trips through the parser', () => {
    const id = formatRecordId({ site: 'UNK', prefix: 'OFS', year: 2026, sequence: 7 });
    const parts = parseRecordId(id);
    expect(parts).toMatchObject({ site: 'UNK', prefix: 'OFS', year: 2026, sequence: 7 });
    expect(isProvisional(id)).toBe(false);
  });

  it('rejects malformed identifiers rather than guessing', () => {
    expect(parseRecordId('not-an-id')).toBeNull();
    expect(parseRecordId('UNK-FL-2026-124')).toBeNull();
  });

  it('marks an identifier minted offline as provisional', () => {
    const id = mintProvisionalRecordId({
      site: 'UNK',
      prefix: 'FL',
      deviceId: 'device-a',
      localSequence: 3,
      now: new Date('2026-02-01T00:00:00Z'),
    });
    expect(isProvisional(id)).toBe(true);
    expect(parseRecordId(id)?.sequence).toBe(3);
  });

  it('gives different devices different suffixes, stably', () => {
    expect(deviceSuffix('device-a')).toBe(deviceSuffix('device-a'));
    expect(deviceSuffix('device-a')).not.toBe(deviceSuffix('device-b'));
    expect(deviceSuffix('device-a')).toHaveLength(4);
  });

  it('mints unique local ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newLocalId()));
    expect(ids.size).toBe(500);
  });

  it('normalises sample numbers so a duplicate cannot hide behind spacing', () => {
    expect(normaliseSampleNumber(' unk smp 001 ')).toBe('UNKSMP001');
  });
});
