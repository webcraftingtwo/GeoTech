import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACE_LIMITS,
  assessStation,
  buildSectionProfile,
  layOutStations,
  summariseFaceMeasurement,
  validateFaceMeasurement,
  type FaceMeasurement,
  type FaceStation,
} from '../src/index.js';

const DECLINE = DEFAULT_FACE_LIMITS.find((l) => l.code === 'DECLINE')!;
const BORD = DEFAULT_FACE_LIMITS.find((l) => l.code === 'BORD')!;

/** The readings from Face Marking Sheet NS3, 12-07-10: 7.2 m face, 1 m stations. */
const NS3 = {
  hangingwall: [2.45, 2.47, 2.51, 2.43, 2.42, 2.44, 2.46, 2.43],
  footwall: [-1.32, -1.34, -1.32, -1.37, -1.34, -1.38, -1.37, -1.36],
};

function measurement(overrides: Partial<FaceMeasurement> = {}): FaceMeasurement {
  return {
    distanceFromPeg: 5.1,
    faceLength: 7.2,
    stationInterval: 2,
    traverseDirection: 'DOWN_DIP_TO_UP_DIP',
    measurementMethod: 'TAPE_5M',
    limits: DECLINE,
    stations: [],
    ...overrides,
  };
}

/** Stations at 1 m, numbered as the sheet numbers them: from zero by default. */
const stationsFrom = (hw: number[], fw: number[], reason?: string, start = 0): FaceStation[] =>
  hw.map((h, i) => ({
    distance: start + i,
    hangingwall: h,
    footwall: fw[i] ?? null,
    ...(reason ? { reason } : {}),
  }));

describe('sign convention (BMSZ datum)', () => {
  it('accepts a hangingwall above and a footwall below the BMSZ', () => {
    const r = validateFaceMeasurement(
      measurement({ stationInterval: 1, stations: stationsFrom([0.4], [-1.2]) }),
    );
    expect(r.issues.some((i) => i.code === 'face.hw_sign')).toBe(false);
    expect(r.issues.some((i) => i.code === 'face.fw_sign')).toBe(false);
  });

  it('rejects a negative hangingwall reading', () => {
    const r = validateFaceMeasurement(measurement({ stations: stationsFrom([-0.4], [-1.2]) }));
    const issue = r.errors.find((i) => i.code === 'face.hw_sign');
    expect(issue?.message).toMatch(/measured up from the BMSZ/i);
  });

  it('rejects a positive footwall reading', () => {
    const r = validateFaceMeasurement(measurement({ stations: stationsFrom([0.4], [1.2]) }));
    expect(r.errors.some((i) => i.code === 'face.fw_sign')).toBe(true);
  });

  it('rejects a face where the readings cross over', () => {
    // Physically impossible: hangingwall below footwall.
    const r = validateFaceMeasurement(measurement({ stations: [{ distance: 0, hangingwall: 0.1, footwall: -0.05 }] }));
    expect(r.ok).toBe(true); // 0.1 - (-0.05) = 0.15, still positive
    const crossed = validateFaceMeasurement(measurement({ stations: [{ distance: 0, hangingwall: 0, footwall: 0 }] }));
    expect(crossed.errors.some((i) => i.code === 'face.width_not_positive')).toBe(true);
  });
});

describe('limit breaches', () => {
  it('flags a hangingwall offset beyond the limit and measures the over-break', () => {
    const a = assessStation({ distance: 0, hangingwall: 2.45, footwall: -1.32 }, 0, DECLINE);
    expect(a.hangingwallBreach).toBe(true);
    expect(a.hangingwallOverbreak).toBe(0.95); // 2.45 − 1.50
    expect(a.footwallBreach).toBe(true);
    expect(a.footwallOverbreak).toBeCloseTo(0.32, 2); // −1.00 − (−1.32)
  });

  it('does not flag a station inside the limits', () => {
    const a = assessStation({ distance: 0, hangingwall: 0.4, footwall: -1.3 }, 0, BORD);
    expect(a.breach).toBe(false);
    expect(a.hangingwallOverbreak).toBe(0);
  });

  it('computes the stope width as hangingwall minus footwall', () => {
    expect(assessStation({ distance: 0, hangingwall: 2.45, footwall: -1.32 }, 0, DECLINE).stopeWidth).toBe(3.77);
  });

  it('applies the limit set that was chosen, not a global one', () => {
    const station = { distance: 0, hangingwall: 1.2, footwall: -1.2 };
    expect(assessStation(station, 0, DECLINE).hangingwallBreach).toBe(false); // limit 1.5
    expect(assessStation(station, 0, BORD).hangingwallBreach).toBe(true); // limit 0.45
  });

  it('requires a reason on a breaching station, and blocks submission without one', () => {
    const withoutReason = validateFaceMeasurement(
      measurement({ stationInterval: 1, stations: stationsFrom([2.45], [-1.32]) }),
    );
    expect(withoutReason.ok).toBe(false);
    expect(withoutReason.errors.some((i) => i.code === 'face.breach_reason_required')).toBe(true);

    const withReason = validateFaceMeasurement(
      measurement({ stationInterval: 1, stations: stationsFrom([2.45], [-1.32], 'Blast over-break') }),
    );
    expect(withReason.errors.some((i) => i.code === 'face.breach_reason_required')).toBe(false);
  });
});

describe('the NS3 sheet', () => {
  const ns3 = measurement({
    stationInterval: 1,
    stations: stationsFrom(NS3.hangingwall, NS3.footwall, 'Blast over-break'),
  });

  it('summarises every station as breaching both limits, as the sheet shows', () => {
    const s = summariseFaceMeasurement(ns3);
    expect(s.total).toBe(8);
    expect(s.measured).toBe(8);
    expect(s.hangingwallBreaches).toBe(8);
    expect(s.footwallBreaches).toBe(8);
    expect(s.complete).toBe(true);
  });

  it('reports the mean over-break and the stope widths', () => {
    const s = summariseFaceMeasurement(ns3);
    expect(s.meanHangingwallOverbreak).toBeCloseTo(0.95, 2);
    expect(s.meanStopeWidth).toBeCloseTo(3.79, 1);
    expect(s.minStopeWidth).toBeCloseTo(3.76, 2);
    expect(s.maxStopeWidth).toBeCloseTo(3.83, 2);
  });

  it('accepts the sheet once every breach carries a reason', () => {
    expect(validateFaceMeasurement(ns3).ok).toBe(true);
  });

  it('warns that 1 m stations depart from the 2 m the standard specifies', () => {
    const warning = validateFaceMeasurement(ns3).warnings.find((i) => i.code === 'face.interval_non_standard');
    expect(warning?.message).toMatch(/§9\.8\.iv specifies 2 m/);
  });

  it('does not warn at the standard interval', () => {
    const atStandard = validateFaceMeasurement(
      measurement({ stations: stationsFrom([0.4, 0.4], [-1.2, -1.2]) }),
    );
    expect(atStandard.warnings.some((i) => i.code === 'face.interval_non_standard')).toBe(false);
  });
});

describe('station layout (§9.8.ii)', () => {
  it('starts 1 m from the sidewall and steps by the interval', () => {
    expect(layOutStations(11.4, 2).map((s) => s.distance)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('lays out 1 m stations when the mine records at 1 m', () => {
    expect(layOutStations(7.2, 1).map((s) => s.distance)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('reproduces the NS3 sheet exactly when the traverse starts at the sidewall', () => {
    // Face Marking Sheet NS3: a 7.2 m face, Dist 0 to 7 at 1 m. A layout that
    // could not produce this could not record a sheet the mine already fills
    // in by hand.
    expect(layOutStations(7.2, 1, 0).map((s) => s.distance)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('never runs a station past the far sidewall', () => {
    for (const length of [3, 5.5, 7.2, 11.4]) {
      for (const interval of [1, 2]) {
        for (const start of [0, 1]) {
          for (const station of layOutStations(length, interval, start)) {
            expect(station.distance).toBeLessThanOrEqual(length + 1e-9);
          }
        }
      }
    }
  });

  it('still measures the centre of a face too narrow to inset', () => {
    expect(layOutStations(0.6, 2).map((s) => s.distance)).toEqual([0.3]);
  });

  it('returns nothing for an unset face length', () => {
    expect(layOutStations(0, 2)).toEqual([]);
  });

  it('warns when the traverse does not start where the standard places it', () => {
    const sheet = validateFaceMeasurement(
      measurement({ stationInterval: 1, stations: stationsFrom(NS3.hangingwall, NS3.footwall, 'Blast over-break', 0) }),
    );
    expect(sheet.warnings.some((i) => i.code === 'face.start_non_standard')).toBe(true);
    expect(sheet.ok).toBe(true);

    const perStandard = validateFaceMeasurement(
      measurement({ stationInterval: 1, stations: stationsFrom(NS3.hangingwall, NS3.footwall, 'Blast over-break', 1) }),
    );
    expect(perStandard.warnings.some((i) => i.code === 'face.start_non_standard')).toBe(false);
  });
});

describe('completeness and required fields', () => {
  it('requires the peg-to-face distance (§9.8.i)', () => {
    const r = validateFaceMeasurement(
      measurement({ distanceFromPeg: null, stations: stationsFrom([0.4], [-1.2]) }),
    );
    expect(r.errors.some((i) => i.code === 'face.peg_distance_required')).toBe(true);
  });

  it('refuses a measurement with no readings at all', () => {
    const r = validateFaceMeasurement(measurement({ stations: layOutStations(7.2, 2) }));
    expect(r.errors.some((i) => i.code === 'face.nothing_measured')).toBe(true);
  });

  it('warns about a half-measured station rather than dropping it', () => {
    const r = validateFaceMeasurement(
      measurement({ stations: [{ distance: 1, hangingwall: 0.4, footwall: null }, { distance: 3, hangingwall: 0.4, footwall: -1.2 }] }),
    );
    expect(r.warnings.some((i) => i.code === 'face.station_partial')).toBe(true);
  });

  it('warns when the stations do not span the face', () => {
    const r = validateFaceMeasurement(
      measurement({ faceLength: 12, stations: stationsFrom([0.4, 0.4], [-1.2, -1.2]) }),
    );
    expect(r.warnings.some((i) => i.code === 'face.span_short')).toBe(true);
  });

  it('warns when the method was not recorded (§9.8.v)', () => {
    const r = validateFaceMeasurement(
      measurement({ measurementMethod: null, stations: stationsFrom([0.4], [-1.2]) }),
    );
    expect(r.warnings.some((i) => i.code === 'face.method_missing')).toBe(true);
  });
});

describe('section profile', () => {
  const profile = buildSectionProfile(
    measurement({ stationInterval: 1, stations: stationsFrom(NS3.hangingwall, NS3.footwall) }),
  );

  it('draws a point per reading', () => {
    expect(profile.hangingwall).toHaveLength(8);
    expect(profile.footwall).toHaveLength(8);
  });

  it('places the hangingwall above the footwall on screen', () => {
    expect(profile.hangingwall[0]!.y).toBeLessThan(profile.footwall[0]!.y);
  });

  it('places the BMSZ datum between the two limits', () => {
    expect(profile.datumY).toBeGreaterThan(profile.hangingwallLimitY);
    expect(profile.datumY).toBeLessThan(profile.footwallLimitY);
  });

  it('marks breaching points so they can be drawn differently', () => {
    expect(profile.hangingwall.every((p) => p.breach)).toBe(true);
  });

  it('keeps every point inside the frame', () => {
    for (const p of [...profile.hangingwall, ...profile.footwall]) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(profile.height);
      expect(p.x).toBeLessThanOrEqual(profile.width);
    }
  });

  it('always frames both limits, even for a face well inside them', () => {
    const tidy = buildSectionProfile(measurement({ limits: BORD, stations: stationsFrom([0.1], [-0.2]) }));
    expect(tidy.hangingwallLimitY).toBeGreaterThanOrEqual(0);
    expect(tidy.footwallLimitY).toBeLessThanOrEqual(tidy.height);
  });
});
