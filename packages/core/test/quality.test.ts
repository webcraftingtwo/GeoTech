import { describe, expect, it } from 'vitest';
import { nextBestAction, scoreRecord, type QualityInput } from '../src/index.js';

const complete: QualityInput = {
  hasLocation: true,
  hasPhoto: true,
  structurePresent: true,
  structureClassified: true,
  orientationRecorded: true,
  offsetPresent: true,
  offsetRecorded: true,
  observationConfidence: 'HIGH',
  requiredFieldsComplete: true,
  hasObservation: true,
};

describe('data-quality score (§35)', () => {
  it('scores a complete record at 100', () => {
    expect(scoreRecord(complete).score).toBe(100);
    expect(scoreRecord(complete).band).toBe('GOOD');
  });

  it('does not penalise low geological confidence', () => {
    const low = scoreRecord({ ...complete, observationConfidence: 'LOW' });
    expect(low.score).toBe(100);
  });

  it('penalises confidence that was never recorded at all', () => {
    const none = scoreRecord({ ...complete, observationConfidence: null });
    expect(none.score).toBeLessThan(100);
    expect(none.gaps.map((g) => g.key)).toContain('confidence');
  });

  it('excludes inapplicable criteria from the denominator', () => {
    // A face with no structure in it must not be marked down for having no
    // orientation, no classification and no offset.
    const noStructure = scoreRecord({
      ...complete,
      structurePresent: false,
      structureClassified: false,
      orientationRecorded: false,
      offsetPresent: false,
      offsetRecorded: false,
    });
    expect(noStructure.score).toBe(100);
    expect(noStructure.criteria.find((c) => c.key === 'orientation')?.applicable).toBe(false);
  });

  it('drops the score when a structure is present but unclassified', () => {
    const s = scoreRecord({ ...complete, structureClassified: false, orientationRecorded: false });
    expect(s.score).toBeLessThan(100);
    expect(s.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(['structure_classified', 'orientation']));
  });

  it('ranks gaps by weight so the technician is told the most useful thing first', () => {
    const s = scoreRecord({ ...complete, hasLocation: false, observationConfidence: null });
    expect(s.gaps[0]?.key).toBe('location');
    expect(nextBestAction(s)).toMatch(/survey station/i);
  });

  it('bands a badly incomplete record as INCOMPLETE', () => {
    const s = scoreRecord({
      hasLocation: false,
      hasPhoto: false,
      structurePresent: true,
      structureClassified: false,
      orientationRecorded: false,
      offsetPresent: false,
      offsetRecorded: false,
      observationConfidence: null,
      requiredFieldsComplete: false,
      hasObservation: false,
    });
    expect(s.band).toBe('INCOMPLETE');
    expect(nextBestAction(s)).toBeTruthy();
  });

  it('expects reef detail only where reef was intersected', () => {
    const noReef = scoreRecord({ ...complete, reefPresent: false });
    expect(noReef.score).toBe(100);
    const reefMissing = scoreRecord({ ...complete, reefPresent: true, reefDetailRecorded: false });
    expect(reefMissing.score).toBeLessThan(100);
  });
});
