import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACE_LIMITS,
  MANDATORY_STATIONS_M,
  MINING_HEIGHT_FLAG_CM,
  STATION_INTERVAL_M,
  assessStation,
  buildSectionProfile,
  layOutStations,
  summariseFaceMeasurement,
  toMetres,
  validateFaceMeasurement,
  type FaceMeasurement,
  type FaceStation,
} from '../src/index.js';

const DECLINE = DEFAULT_FACE_LIMITS.find((l) => l.code === 'DECLINE')!;
const BORD = DEFAULT_FACE_LIMITS.find((l) => l.code === 'BORD')!;

/**
 * The readings from Face Marking Sheet NS3, 12-07-10 — a 7.2 m face — in the
 * centimetres the application now holds. The sheet carries eight readings; the
 * traverse the Chief Geologist fixed puts six on a face this wide (1 through
 * 6 m), so the first six are the ones a technician would enter today.
 */
const NS3 = {
  hangingwall: [245, 247, 251, 243, 242, 244],
  footwall: [-132, -134, -132, -137, -134, -138],
};

function measurement(overrides: Partial<FaceMeasurement> = {}): FaceMeasurement {
  return {
    distanceFromPeg: 5.1,
    faceLength: 7.2,
    stationInterval: STATION_INTERVAL_M,
    traverseDirection: 'DOWN_DIP_TO_UP_DIP',
    measurementMethod: 'TAPE_5M',
    limits: DECLINE,
    stations: [],
    ...overrides,
  };
}

/** Stations at 1 m from the sidewall, as the traverse lays them out. */
const stationsFrom = (hw: number[], fw: number[], reason?: string, start = 1): FaceStation[] =>
  hw.map((h, i) => ({
    distance: start + i,
    hangingwall: h,
    footwall: fw[i] ?? null,
    ...(reason ? { reason } : {}),
  }));

describe('sign convention (BMSZ datum)', () => {
  it('accepts a hangingwall above and a footwall below the BMSZ', () => {
    const r = validateFaceMeasurement(
      measurement({ stations: stationsFrom([40], [-120]) }),
    );
    expect(r.issues.some((i) => i.code === 'face.hw_sign')).toBe(false);
    expect(r.issues.some((i) => i.code === 'face.fw_sign')).toBe(false);
  });

  it('rejects a negative hangingwall reading', () => {
    const r = validateFaceMeasurement(measurement({ stations: stationsFrom([-40], [-120]) }));
    const issue = r.errors.find((i) => i.code === 'face.hw_sign');
    expect(issue?.message).toMatch(/measured up from the BMSZ/i);
  });

  it('rejects a positive footwall reading', () => {
    const r = validateFaceMeasurement(measurement({ stations: stationsFrom([40], [120]) }));
    expect(r.errors.some((i) => i.code === 'face.fw_sign')).toBe(true);
  });

  it('rejects a face with no mining height at all', () => {
    const crossed = validateFaceMeasurement(
      measurement({ stations: [{ distance: 1, hangingwall: 0, footwall: 0 }] }),
    );
    expect(crossed.errors.some((i) => i.code === 'face.height_not_positive')).toBe(true);
  });
});

describe('limit breaches', () => {
  it('flags a hangingwall offset beyond the limit and measures the over-break', () => {
    const a = assessStation({ distance: 1, hangingwall: 245, footwall: -132 }, 0, DECLINE);
    expect(a.hangingwallBreach).toBe(true);
    expect(a.hangingwallOverbreak).toBe(95); // 245 − 150 cm
    expect(a.footwallBreach).toBe(true);
    expect(a.footwallOverbreak).toBe(32); // −100 − (−132) cm
  });

  it('does not flag a station inside the limits', () => {
    const a = assessStation({ distance: 1, hangingwall: 40, footwall: -130 }, 0, BORD);
    expect(a.breach).toBe(false);
    expect(a.hangingwallOverbreak).toBe(0);
  });

  it('computes the mining height as hangingwall minus footwall', () => {
    expect(assessStation({ distance: 1, hangingwall: 245, footwall: -132 }, 0, DECLINE).miningHeight).toBe(377);
  });

  it('converts a mining height to metres for management without changing what is stored', () => {
    const a = assessStation({ distance: 1, hangingwall: 245, footwall: -132 }, 0, DECLINE);
    expect(a.miningHeight).toBe(377);
    expect(toMetres(a.miningHeight!)).toBe(3.77);
  });

  it('applies the limit set that was chosen, not a global one', () => {
    const station = { distance: 1, hangingwall: 120, footwall: -120 };
    expect(assessStation(station, 0, DECLINE).hangingwallBreach).toBe(false); // limit 150 cm
    expect(assessStation(station, 0, BORD).hangingwallBreach).toBe(true); // limit 45 cm
  });

  it('requires a reason on a breaching station, and blocks submission without one', () => {
    const withoutReason = validateFaceMeasurement(
      measurement({ stations: stationsFrom([245], [-132]) }),
    );
    expect(withoutReason.ok).toBe(false);
    expect(withoutReason.errors.some((i) => i.code === 'face.breach_reason_required')).toBe(true);

    const withReason = validateFaceMeasurement(
      measurement({ stations: stationsFrom([245], [-132], 'Blast over-break') }),
    );
    expect(withReason.errors.some((i) => i.code === 'face.breach_reason_required')).toBe(false);
  });
});

describe('the NS3 sheet', () => {
  const ns3 = measurement({
    stations: stationsFrom(NS3.hangingwall, NS3.footwall, 'Blast over-break'),
  });

  it('summarises every station as breaching both limits, as the sheet shows', () => {
    const s = summariseFaceMeasurement(ns3);
    expect(s.total).toBe(6);
    expect(s.measured).toBe(6);
    expect(s.hangingwallBreaches).toBe(6);
    expect(s.footwallBreaches).toBe(6);
    expect(s.complete).toBe(true);
  });

  it('reports the means and the mining heights, in centimetres', () => {
    const s = summariseFaceMeasurement(ns3);
    expect(s.meanHangingwallOverbreak).toBe(95.33);
    expect(s.meanHangingwall).toBe(245.33);
    expect(s.meanFootwall).toBe(-134.5);
    expect(s.meanMiningHeight).toBe(379.83);
    expect(s.minMiningHeight).toBe(376);
    expect(s.maxMiningHeight).toBe(383);
  });

  it('flags the face to management, every station being mined above the flag height', () => {
    const s = summariseFaceMeasurement(ns3);
    expect(MINING_HEIGHT_FLAG_CM).toBe(200);
    expect(s.exceedsFlagHeight).toBe(true);
  });

  it('keeps the mean footwall negative — it is measured down from the BMSZ', () => {
    expect(summariseFaceMeasurement(ns3).meanFootwall).toBeLessThan(0);
  });

  it('accepts the sheet once every breach carries a reason', () => {
    expect(validateFaceMeasurement(ns3).ok).toBe(true);
  });
});

describe('the station traverse', () => {
  it('starts 1 m from the sidewall, steps 1 m, and has no station zero', () => {
    const stations = layOutStations(11.4).map((s) => s.distance);
    expect(stations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stations).not.toContain(0);
  });

  it('lays out face length minus one offsets', () => {
    // The Chief Geologist's rule: a 7.2 m face is six offsets, not eight.
    expect(layOutStations(7.2).map((s) => s.distance)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(layOutStations(9).map((s) => s.distance)).toHaveLength(8);
    expect(layOutStations(5).map((s) => s.distance)).toHaveLength(4);
  });

  it('never runs a station into either sidewall', () => {
    for (const length of [3, 5.5, 7.2, 11.4]) {
      for (const station of layOutStations(length)) {
        expect(station.distance).toBeGreaterThanOrEqual(1);
        expect(station.distance).toBeLessThanOrEqual(length - 1 + 1e-9);
      }
    }
  });

  it('still measures the centre of a face too narrow for the inset', () => {
    expect(layOutStations(1.6).map((s) => s.distance)).toEqual([0.8]);
  });

  it('returns nothing for an unset face length', () => {
    expect(layOutStations(0)).toEqual([]);
    expect(layOutStations(Number.NaN)).toEqual([]);
  });

  it('refuses readings laid out at any other spacing', () => {
    const wrong = validateFaceMeasurement(
      measurement({ stationInterval: 2, stations: stationsFrom([40, 40], [-120, -120]) }),
    );
    expect(wrong.errors.some((i) => i.code === 'face.interval_invalid')).toBe(true);
  });

  it('refuses a traverse that starts at the sidewall', () => {
    const fromZero = validateFaceMeasurement(
      measurement({ stations: stationsFrom(NS3.hangingwall, NS3.footwall, 'Blast over-break', 0) }),
    );
    const issue = fromZero.errors.find((i) => i.code === 'face.start_invalid');
    expect(issue?.message).toMatch(/no station zero/i);
  });
});

describe('the mandatory 2 m and 5 m offsets', () => {
  it('names both as required', () => {
    expect(MANDATORY_STATIONS_M).toEqual([2, 5]);
  });

  it('blocks a face that is missing either of them', () => {
    // Stations 1 to 6; leave 5 m unread.
    const partial = stationsFrom(NS3.hangingwall, NS3.footwall, 'Blast over-break');
    partial[4] = { distance: 5, hangingwall: null, footwall: null };

    const r = validateFaceMeasurement(measurement({ stations: partial }));
    const issue = r.errors.find((i) => i.code === 'face.mandatory_station_missing');
    expect(issue?.message).toMatch(/5 m station/);
    expect(r.ok).toBe(false);
  });

  it('does not demand a station the face is too narrow to have', () => {
    // A 4 m face lays out stations at 1, 2 and 3 — there is no 5 m station.
    const narrow = measurement({
      faceLength: 4,
      stations: [
        { distance: 1, hangingwall: 40, footwall: -120 },
        { distance: 2, hangingwall: 41, footwall: -121 },
        { distance: 3, hangingwall: 40, footwall: -119 },
      ],
    });
    expect(validateFaceMeasurement(narrow).errors.some((i) => i.code === 'face.mandatory_station_missing')).toBe(false);
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
    measurement({ stations: stationsFrom(NS3.hangingwall, NS3.footwall) }),
  );

  it('draws a point per reading', () => {
    expect(profile.hangingwall).toHaveLength(6);
    expect(profile.footwall).toHaveLength(6);
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
    const tidy = buildSectionProfile(measurement({ limits: BORD, stations: stationsFrom([10], [-20]) }));
    expect(tidy.hangingwallLimitY).toBeGreaterThanOrEqual(0);
    expect(tidy.footwallLimitY).toBeLessThanOrEqual(tidy.height);
  });
});
