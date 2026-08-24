import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  canTransition,
  conflictingFields,
  describeSyncFailure,
  describeSyncStatus,
  detectConflict,
  isOutstanding,
  nextState,
} from '../src/index.js';

describe('sync state machine (§5)', () => {
  it('allows the normal capture-to-synced path', () => {
    expect(canTransition('DRAFT', 'LOCAL_SAVED')).toBe(true);
    expect(canTransition('LOCAL_SAVED', 'PENDING_SYNC')).toBe(true);
    expect(canTransition('PENDING_SYNC', 'SYNCING')).toBe(true);
    expect(canTransition('SYNCING', 'SYNCED')).toBe(true);
  });

  it('never allows a record to skip straight from draft to synced', () => {
    expect(canTransition('DRAFT', 'SYNCED')).toBe(false);
  });

  it('returns a failed record to the queue rather than dropping it', () => {
    expect(nextState('SYNCING', 'FAILED')).toBe('SYNC_FAILED');
    expect(canTransition('SYNC_FAILED', 'PENDING_SYNC')).toBe(true);
    expect(isOutstanding('SYNC_FAILED')).toBe(true);
  });

  it('treats a duplicate as success, so a replayed batch settles', () => {
    expect(nextState('SYNCING', 'DUPLICATE')).toBe('SYNCED');
  });

  it('parks a conflicted record for review instead of resolving it', () => {
    expect(nextState('SYNCING', 'CONFLICT')).toBe('REQUIRES_REVIEW');
    expect(isOutstanding('REQUIRES_REVIEW')).toBe(true);
  });
});

describe('retry backoff (§30, §41)', () => {
  it('grows with each attempt', () => {
    const half = () => 0.5;
    const delays = [1, 2, 3, 4].map((a) => backoffDelayMs(a, { random: half }));
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
  });

  it('is capped so a long outage does not push retries into next week', () => {
    expect(backoffDelayMs(50, { random: () => 0.5, maxMs: 300000 })).toBeLessThanOrEqual(300000);
  });

  it('applies jitter so devices leaving the cage do not retry in lockstep', () => {
    const low = backoffDelayMs(3, { random: () => 0 });
    const high = backoffDelayMs(3, { random: () => 1 });
    expect(low).toBeLessThan(high);
  });
});

describe('conflict detection (§30)', () => {
  it('finds no conflict for a create', () => {
    expect(detectConflict({ baseVersion: null, serverVersion: 4 })).toBe(false);
  });

  it('finds no conflict when the device is up to date', () => {
    expect(detectConflict({ baseVersion: 4, serverVersion: 4 })).toBe(false);
  });

  it('finds a conflict when the server has moved on', () => {
    expect(detectConflict({ baseVersion: 3, serverVersion: 4 })).toBe(true);
  });

  it('lists the fields that actually differ, ignoring sync bookkeeping', () => {
    const fields = conflictingFields(
      { apparentOffset: 2.5, confidence: 'HIGH', version: 3, updatedAt: 'a' },
      { apparentOffset: 2.1, confidence: 'HIGH', version: 4, updatedAt: 'b' },
    );
    expect(fields).toEqual(['apparentOffset']);
  });
});

describe('what the technician reads (§5, §42)', () => {
  const base = { online: true, pending: 0, failed: 0, conflicts: 0, syncing: 0 };

  it('says exactly how many records are waiting while offline', () => {
    expect(describeSyncStatus({ ...base, online: false, pending: 7 })).toBe(
      'OFFLINE — 7 records waiting to sync',
    );
  });

  it('reassures when offline with nothing outstanding', () => {
    expect(describeSyncStatus({ ...base, online: false })).toBe('OFFLINE — everything saved');
  });

  it('gets the singular right', () => {
    expect(describeSyncStatus({ ...base, online: false, pending: 1 })).toBe(
      'OFFLINE — 1 record waiting to sync',
    );
  });

  it('surfaces conflicts ahead of everything else', () => {
    expect(describeSyncStatus({ ...base, conflicts: 2, pending: 3 })).toBe(
      '2 records need review · 3 waiting to sync',
    );
  });

  it('confirms when everything has landed', () => {
    expect(describeSyncStatus(base)).toBe('All records synced');
  });

  it('never says "something went wrong" on failure', () => {
    const msg = describeSyncFailure(2, 120000);
    expect(msg).toMatch(/Saved locally/);
    expect(msg).toMatch(/Nothing has been lost/);
    expect(msg.toLowerCase()).not.toContain('something went wrong');
  });
});
