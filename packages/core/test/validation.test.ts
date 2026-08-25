import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVENTION,
  validateFaceLog,
  validateOffset,
  validateSample,
  validateStructure,
  validateHazard,
  applyConfigurableRules,
  type ConfigurableRule,
} from '../src/index.js';

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe('measurement conventions (§18)', () => {
  it('rejects a dip outside the configured convention', () => {
    const r = validateStructure({ structureType: 'FAULT', dip: 175 });
    expect(codes(r)).toContain('angle.out_of_convention');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toMatch(/175/);
  });

  it('accepts the same dip when the mine configures a 0-180 convention', () => {
    const r = validateStructure(
      { structureType: 'FAULT', dip: 175, strike: 10, dipDirection: 100 },
      { convention: { ...DEFAULT_CONVENTION, dipMax: 180 } },
    );
    expect(codes(r)).not.toContain('angle.out_of_convention');
  });

  it('flags a strike / dip-direction pair that breaks the right-hand rule', () => {
    const r = validateStructure({ structureType: 'FAULT', strike: 10, dip: 60, dipDirection: 250 });
    expect(codes(r)).toContain('orientation.strike_dipdir_mismatch');
    // A mismatch is suspicious, not impossible — it must not block the save.
    expect(r.ok).toBe(true);
  });

  it('does not cross-check strike and dip direction when the rule is disabled', () => {
    const r = validateStructure(
      { structureType: 'FAULT', strike: 10, dip: 60, dipDirection: 250 },
      { convention: { ...DEFAULT_CONVENTION, strikeDipRule: 'NONE' } },
    );
    expect(codes(r)).not.toContain('orientation.strike_dipdir_mismatch');
  });
});

describe('orientation completeness (§18)', () => {
  it('reports "orientation incomplete" for a fault with no orientation', () => {
    const r = validateStructure({ structureType: 'FAULT' });
    expect(codes(r)).toContain('orientation.missing');
    expect(r.ok).toBe(true); // soft warning, per §18
  });

  it('reports incomplete when only some components are present', () => {
    const r = validateStructure({ structureType: 'FAULT', dip: 60 });
    expect(codes(r)).toContain('orientation.incomplete');
  });

  it('is satisfied by a full orientation', () => {
    const r = validateStructure({
      structureType: 'FAULT',
      strike: 10,
      dip: 60,
      dipDirection: 100,
      measurementSource: 'MANUAL',
      confidence: 'MEDIUM',
    });
    expect(codes(r).filter((c) => c.startsWith('orientation.'))).toHaveLength(0);
  });
});

describe('offset validation (§12, §18)', () => {
  const base = { markerType: 'REEF', unit: 'M', confidence: 'HIGH' as const };

  it('flags a negative offset for review without blocking it', () => {
    const r = validateOffset({ ...base, apparentOffset: -3 });
    expect(codes(r)).toContain('offset.negative');
    expect(r.ok).toBe(true);
  });

  it('accepts a negative offset when the mine convention supports it', () => {
    const r = validateOffset(
      { ...base, apparentOffset: -3 },
      { convention: { ...DEFAULT_CONVENTION, allowNegativeOffset: true } },
    );
    expect(codes(r)).not.toContain('offset.negative');
  });

  it('requires a measurement and a marker', () => {
    const r = validateOffset({});
    expect(codes(r)).toContain('offset.measurement_required');
    expect(codes(r)).toContain('offset.marker_required');
    expect(r.ok).toBe(false);
  });

  it('warns when a throw exceeds the apparent offset it was resolved from', () => {
    const r = validateOffset({ ...base, apparentOffset: 2.0, throwObserved: 3.5 });
    expect(codes(r)).toContain('offset.component_exceeds_apparent');
  });

  it('encourages a photograph without requiring one', () => {
    const r = validateOffset({ ...base, apparentOffset: 2.5, lateralSense: 'LEFT' }, { hasPhoto: false });
    expect(codes(r)).toContain('offset.photo_missing');
    expect(r.ok).toBe(true);
  });

  it('asks for the sense of displacement when none was recorded', () => {
    const r = validateOffset({ ...base, apparentOffset: 2.5 });
    expect(codes(r)).toContain('offset.sense_missing');
  });
});

describe('sample validation (§16, §18)', () => {
  it('requires a sample ID', () => {
    const r = validateSample({ sampleType: 'CHIP' });
    expect(codes(r)).toContain('sample.id_required');
    expect(r.ok).toBe(false);
  });

  it('rejects a duplicate sample number regardless of case or padding', () => {
    const r = validateSample(
      { sampleNumber: ' unk-smp-001 ', sampleType: 'CHIP' },
      { knownSampleNumbers: ['UNK-SMP-001'] },
    );
    expect(codes(r)).toContain('sample.duplicate');
    expect(r.ok).toBe(false);
  });

  it('warns when the recorded length disagrees with the positions', () => {
    const r = validateSample({
      sampleNumber: 'UNK-SMP-002',
      sampleType: 'CHANNEL',
      fromPosition: 0,
      toPosition: 1.0,
      length: 1.5,
    });
    expect(codes(r)).toContain('sample.length_mismatch');
  });
});

describe('face log validation (§18)', () => {
  it('requires a location, and accepts a survey reference as that location', () => {
    const missing = validateFaceLog({ workplaceId: 'wp1', shiftDate: '2026-02-01' });
    expect(codes(missing)).toContain('facelog.location_required');

    const withRef = validateFaceLog({
      workplaceId: 'wp1',
      shiftDate: '2026-02-01',
      surveyReference: 'PEG-1255',
    });
    expect(codes(withRef)).not.toContain('facelog.location_required');
  });

  it('accepts coordinates as a location but wants the coordinate system', () => {
    const r = validateFaceLog({
      workplaceId: 'wp1',
      shiftDate: '2026-02-01',
      easting: 12345,
      northing: 67890,
    });
    expect(codes(r)).not.toContain('facelog.location_required');
    expect(codes(r)).toContain('facelog.coordinate_system_missing');
  });

  it('requires a workplace', () => {
    const r = validateFaceLog({ shiftDate: '2026-02-01', surveyReference: 'PEG-1' });
    expect(codes(r)).toContain('facelog.workplace_required');
    expect(r.ok).toBe(false);
  });
});

describe('hazard validation (§17)', () => {
  it('requires type, description and severity, and nudges toward formal reporting', () => {
    const r = validateHazard({ hazardType: 'FAULT' });
    expect(codes(r)).toContain('hazard.description_required');
    expect(codes(r)).toContain('hazard.severity_required');
    const notify = r.issues.find((i) => i.code === 'hazard.notification_missing');
    expect(notify?.message).toMatch(/does not replace/i);
  });
});

describe('administrator-configured rules (§38)', () => {
  const rules: ConfigurableRule[] = [
    {
      id: 'r1',
      entity: 'OFFSET',
      field: 'measurementMethod',
      ruleType: 'REQUIRED',
      severity: 'ERROR',
      message: 'This mine requires the measurement method on every offset.',
      active: true,
    },
    {
      id: 'r2',
      entity: 'OFFSET',
      field: 'apparentOffset',
      ruleType: 'RANGE',
      params: { min: 0, max: 25 },
      severity: 'WARNING',
      active: true,
    },
  ];

  it('applies a mine-specific required rule with its own message', () => {
    const r = validateOffset({ markerType: 'REEF', apparentOffset: 2.5, unit: 'M' }, { rules });
    const found = r.issues.find((i) => i.field === 'measurementMethod');
    expect(found?.severity).toBe('ERROR');
    expect(found?.message).toMatch(/This mine requires/);
  });

  it('ignores rules for other entities and inactive rules', () => {
    const inactive = rules.map((r) => ({ ...r, active: false }));
    expect(applyConfigurableRules('OFFSET', { apparentOffset: 999 }, inactive)).toHaveLength(0);
    expect(applyConfigurableRules('SAMPLE', { apparentOffset: 999 }, rules)).toHaveLength(0);
  });
});
