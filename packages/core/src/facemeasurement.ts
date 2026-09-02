/**
 * Face measurements — tape offsets from the BMSZ.
 *
 * Implements UNKI-MIN-MRM-STD-201 §9.8 ("Tape offsets or face measurements"),
 * the task that produces the Face Marking Sheet.
 *
 * The standard specifies:
 *   i.   the distance from peg to face is recorded
 *   ii.  BMSZ→hangingwall and BMSZ→footwall are measured 1 m from the face,
 *        starting 1 m from the sidewall
 *   iii. readings run from the down-dip side to the up-dip side
 *   iv.  stations are at two metre intervals
 *   vi.  the face width of the bord is measured
 *
 * ── Sign convention ───────────────────────────────────────────────────
 * The BMSZ is the datum, at zero. Hangingwall offsets are measured **up**
 * from it and are positive; footwall offsets are measured **down** and are
 * negative. This is the convention on the sheet itself (H/W 2.45, F/W −1.32),
 * and getting it backwards silently inverts every stope width, so it is
 * validated rather than assumed.
 *
 * ── A note on the station interval and the first station ──────────────
 * The standard and the sheets in circulation disagree twice, and this module
 * rules on neither. §9.8.iv specifies a 2 m interval; the sheets record at
 * 1 m. §9.8.ii places the first reading 1 m from the sidewall; the sheets
 * start at 0 and run to the far sidewall (Face Marking Sheet NS3: a 7.2 m
 * face, stations 0 to 7).
 *
 * Both are therefore inputs, both default to the standard, and both are
 * recoverable from any stored record — the interval is a field on it, and the
 * first station's distance is the first station's distance. Deviating from the
 * standard raises a warning, never an error: it is the mine's call, and the
 * application's job is to record which was used, not to refuse the practice
 * that is actually in the sheets.
 */

import type { Confidence } from './types.js';

/* ── limits ───────────────────────────────────────────────────────────── */

/**
 * The mining-cut limits applied to a face.
 *
 * Snapshotted onto each measurement rather than looked up when the record is
 * read. Limits are revised under Chief Geologist authorisation, and a revision
 * must never silently turn a compliant historical face into a breaching one.
 */
export interface FaceLimits {
  /** Reference code of the limit set, e.g. BORD or DECLINE. */
  code: string;
  label: string;
  /** Maximum permitted BMSZ→hangingwall offset, in metres (positive). */
  hangingwall: number;
  /** Minimum permitted BMSZ→footwall offset, in metres (negative). */
  footwall: number;
}

/**
 * Development-time limit sets, carried over from the prototype and matching
 * the values printed on the sheets. **Confirm against the current standard
 * before production use** — these are configuration, held in the
 * `face_limit_set` reference list, not authority.
 */
export const DEFAULT_FACE_LIMITS: FaceLimits[] = [
  { code: 'BORD', label: 'Bord / ledging decline', hangingwall: 0.45, footwall: -1.35 },
  { code: 'DECLINE', label: 'Decline', hangingwall: 1.5, footwall: -1.0 },
];

/** §9.8.iv specifies two metre stations. */
export const STANDARD_STATION_INTERVAL_M = 2;

/** §9.8.ii: the first reading is taken 1 m from the sidewall. */
export const STANDARD_START_OFFSET_M = 1;

export type FaceMeasurementMethod = 'DISTOMETER' | 'TAPE_5M';

/** §9.8.iii: readings run from the down-dip side to the up-dip side. */
export type FaceTraverseDirection = 'DOWN_DIP_TO_UP_DIP' | 'UP_DIP_TO_DOWN_DIP';

/* ── records ──────────────────────────────────────────────────────────── */

export interface FaceStation {
  /** Position along the face in metres, from the first station. */
  distance: number;
  /** BMSZ → hangingwall, positive, metres. Null until measured. */
  hangingwall: number | null;
  /** BMSZ → footwall, negative, metres. Null until measured. */
  footwall: number | null;
  /** Required when the station breaches a limit. */
  reason?: string | null;
  note?: string | null;
}

export interface FaceMeasurement {
  /** §9.8.i */
  distanceFromPeg: number | null;
  blastNumber?: string | null;
  advance?: number | null;
  distanceToCapitalFpBorder?: number | null;
  /** §9.8.vi — the face width of the bord. */
  faceLength: number | null;
  stationInterval: number;
  traverseDirection: FaceTraverseDirection;
  measurementMethod?: FaceMeasurementMethod | null;
  limits: FaceLimits;
  stations: FaceStation[];
  expectedGrade?: number | null;
  actualGrade?: number | null;
  confidence?: Confidence | null;
}

/* ── breach detection ─────────────────────────────────────────────────── */

export interface StationAssessment {
  index: number;
  distance: number;
  hangingwall: number | null;
  footwall: number | null;
  /** Hangingwall offset beyond the limit. */
  hangingwallBreach: boolean;
  /** Footwall offset beyond the limit. */
  footwallBreach: boolean;
  breach: boolean;
  /** How far past the limit, in metres. Zero when within limits. */
  hangingwallOverbreak: number;
  footwallOverbreak: number;
  /** Hangingwall minus footwall. The mined width at this station. */
  stopeWidth: number | null;
  complete: boolean;
  reasonRequired: boolean;
  reasonGiven: boolean;
}

export function assessStation(station: FaceStation, index: number, limits: FaceLimits): StationAssessment {
  const hw = station.hangingwall;
  const fw = station.footwall;

  const hangingwallBreach = hw !== null && hw > limits.hangingwall;
  const footwallBreach = fw !== null && fw < limits.footwall;
  const breach = hangingwallBreach || footwallBreach;
  const complete = hw !== null && fw !== null;

  return {
    index,
    distance: station.distance,
    hangingwall: hw,
    footwall: fw,
    hangingwallBreach,
    footwallBreach,
    breach,
    hangingwallOverbreak: hangingwallBreach ? round2(hw! - limits.hangingwall) : 0,
    footwallOverbreak: footwallBreach ? round2(limits.footwall - fw!) : 0,
    stopeWidth: complete ? round2(hw! - fw!) : null,
    complete,
    reasonRequired: breach,
    reasonGiven: Boolean(station.reason && station.reason.trim().length > 0),
  };
}

export interface FaceMeasurementSummary {
  stations: StationAssessment[];
  total: number;
  measured: number;
  hangingwallBreaches: number;
  footwallBreaches: number;
  breachingStations: number;
  /** Mean over-break across breaching hangingwall stations only. */
  meanHangingwallOverbreak: number | null;
  meanStopeWidth: number | null;
  minStopeWidth: number | null;
  maxStopeWidth: number | null;
  breachesWithoutReason: number;
  complete: boolean;
}

export function summariseFaceMeasurement(measurement: FaceMeasurement): FaceMeasurementSummary {
  const stations = measurement.stations.map((s, i) => assessStation(s, i, measurement.limits));

  const widths = stations.map((s) => s.stopeWidth).filter((w): w is number => w !== null);
  const hangingwallOverbreaks = stations.filter((s) => s.hangingwallBreach).map((s) => s.hangingwallOverbreak);
  const measured = stations.filter((s) => s.complete).length;

  return {
    stations,
    total: stations.length,
    measured,
    hangingwallBreaches: stations.filter((s) => s.hangingwallBreach).length,
    footwallBreaches: stations.filter((s) => s.footwallBreach).length,
    breachingStations: stations.filter((s) => s.breach).length,
    meanHangingwallOverbreak: hangingwallOverbreaks.length ? round2(mean(hangingwallOverbreaks)) : null,
    meanStopeWidth: widths.length ? round2(mean(widths)) : null,
    minStopeWidth: widths.length ? round2(Math.min(...widths)) : null,
    maxStopeWidth: widths.length ? round2(Math.max(...widths)) : null,
    breachesWithoutReason: stations.filter((s) => s.reasonRequired && !s.reasonGiven).length,
    complete: stations.length > 0 && measured === stations.length,
  };
}

/* ── validation ───────────────────────────────────────────────────────── */

export interface FaceMeasurementIssue {
  field: string;
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  /** Station index, where the issue belongs to one station. */
  station?: number;
}

export interface FaceMeasurementValidation {
  issues: FaceMeasurementIssue[];
  errors: FaceMeasurementIssue[];
  warnings: FaceMeasurementIssue[];
  ok: boolean;
}

/**
 * Validates a face measurement.
 *
 * `ERROR` is reserved for what cannot be interpreted at all: no readings, a
 * reversed sign convention, a breach with no reason. Everything else warns —
 * an unusual face is still a face, and an interface that refuses one stops
 * receiving them.
 */
export function validateFaceMeasurement(measurement: FaceMeasurement): FaceMeasurementValidation {
  const issues: FaceMeasurementIssue[] = [];
  const summary = summariseFaceMeasurement(measurement);

  const add = (
    field: string,
    severity: 'ERROR' | 'WARNING',
    code: string,
    message: string,
    station?: number,
  ) => issues.push({ field, severity, code, message, ...(station !== undefined ? { station } : {}) });

  if (measurement.stations.length === 0) {
    add('stations', 'ERROR', 'face.no_stations', 'No measurement stations. Set the face length and interval to lay out the stations.');
  }

  if (summary.measured === 0 && measurement.stations.length > 0) {
    add('stations', 'ERROR', 'face.nothing_measured', 'No readings taken yet. Record the hangingwall and footwall offset at each station.');
  }

  // §9.8.i — the peg-to-face distance is what places this face on the plan.
  if (measurement.distanceFromPeg === null || measurement.distanceFromPeg === undefined) {
    add('distanceFromPeg', 'ERROR', 'face.peg_distance_required', 'Record the distance from the peg to the face. Without it the readings cannot be placed.');
  } else if (measurement.distanceFromPeg < 0) {
    add('distanceFromPeg', 'ERROR', 'face.peg_distance_negative', 'Distance from the peg cannot be negative.');
  }

  // §9.8.vi
  if (measurement.faceLength === null || measurement.faceLength === undefined) {
    add('faceLength', 'WARNING', 'face.length_missing', 'Face width of the bord not recorded (§9.8.vi).');
  } else if (measurement.faceLength <= 0) {
    add('faceLength', 'ERROR', 'face.length_invalid', 'Face width must be greater than zero.');
  }

  if (measurement.stationInterval <= 0) {
    add('stationInterval', 'ERROR', 'face.interval_invalid', 'Station interval must be greater than zero.');
  } else if (measurement.stationInterval !== STANDARD_STATION_INTERVAL_M) {
    add(
      'stationInterval',
      'WARNING',
      'face.interval_non_standard',
      `Stations are at ${measurement.stationInterval} m. STD-201 §9.8.iv specifies ${STANDARD_STATION_INTERVAL_M} m. The interval used is recorded with the readings.`,
    );
  }

  if (measurement.stations.length > 0) {
    const first = measurement.stations[0]!.distance;
    if (Math.abs(first - STANDARD_START_OFFSET_M) > 1e-9) {
      add(
        'stations',
        'WARNING',
        'face.start_non_standard',
        `The first station is ${round2(first)} m from the sidewall. STD-201 §9.8.ii places it ${STANDARD_START_OFFSET_M} m. The distances used are recorded with the readings.`,
      );
    }
  }

  // Station spacing must cover the face that was measured.
  if (measurement.faceLength && measurement.faceLength > 0 && measurement.stations.length > 1) {
    const span = measurement.stations[measurement.stations.length - 1]!.distance - measurement.stations[0]!.distance;
    if (span > measurement.faceLength + 0.51) {
      add('stations', 'WARNING', 'face.span_exceeds_length', `The stations span ${round2(span)} m but the face is ${measurement.faceLength} m wide. Check the face width and the interval.`);
    } else if (measurement.faceLength - span > measurement.stationInterval) {
      add('stations', 'WARNING', 'face.span_short', `The stations span ${round2(span)} m of a ${measurement.faceLength} m face. More than one interval is unmeasured.`);
    }
  }

  for (const station of summary.stations) {
    const label = `station ${round2(station.distance)} m`;

    // Sign convention. Getting these the wrong way round inverts every stope
    // width on the face, so it is caught rather than stored.
    if (station.hangingwall !== null && station.hangingwall < 0) {
      add('hangingwall', 'ERROR', 'face.hw_sign', `Hangingwall offset at ${label} is negative. The hangingwall is measured up from the BMSZ and is positive.`, station.index);
    }
    if (station.footwall !== null && station.footwall > 0) {
      add('footwall', 'ERROR', 'face.fw_sign', `Footwall offset at ${label} is positive. The footwall is measured down from the BMSZ and is negative.`, station.index);
    }

    if (station.reasonRequired && !station.reasonGiven) {
      add('reason', 'ERROR', 'face.breach_reason_required', `${capitalise(label)} is outside the mining-cut limits. Record why before submitting.`, station.index);
    }

    if (station.stopeWidth !== null && station.stopeWidth <= 0) {
      add('stopeWidth', 'ERROR', 'face.width_not_positive', `Stope width at ${label} is ${station.stopeWidth} m. Check the two readings — the hangingwall reading should be above the footwall reading.`, station.index);
    }

    if (!station.complete && (station.hangingwall !== null || station.footwall !== null)) {
      add('stations', 'WARNING', 'face.station_partial', `${capitalise(label)} has only one of the two readings.`, station.index);
    }
  }

  if (summary.total > 0 && summary.measured < summary.total) {
    add('stations', 'WARNING', 'face.incomplete', `${summary.total - summary.measured} of ${summary.total} stations still to measure.`);
  }

  if (!measurement.measurementMethod) {
    add('measurementMethod', 'WARNING', 'face.method_missing', 'Record whether a distometer or a 5 m tape was used (§9.8.v).');
  }

  const errors = issues.filter((i) => i.severity === 'ERROR');
  return { issues, errors, warnings: issues.filter((i) => i.severity === 'WARNING'), ok: errors.length === 0 };
}

/* ── station layout ───────────────────────────────────────────────────── */

/**
 * Lays out the stations for a face.
 *
 * Starts at `startOffset` from the sidewall — 1 m per §9.8.ii — and steps by
 * the interval to the far sidewall. The traverse stops at the face width: a
 * station beyond it would be measuring rock that was never in the cut.
 *
 * It deliberately does **not** inset the far end as well. A completed sheet
 * runs to the last whole interval that fits (NS3: 0 to 7 across 7.2 m), and a
 * layout that could not reproduce a sheet already filled in by hand would be
 * telling the technician their own record is wrong.
 */
export function layOutStations(
  faceLength: number,
  interval: number,
  startOffset = STANDARD_START_OFFSET_M,
): FaceStation[] {
  if (faceLength <= 0 || interval <= 0 || startOffset < 0) return [];
  const stations: FaceStation[] = [];
  for (let d = startOffset; d <= faceLength + 1e-9; d += interval) {
    stations.push({ distance: round2(d), hangingwall: null, footwall: null });
  }
  // A face narrower than the inset still gets its centre measured.
  if (stations.length === 0) stations.push({ distance: round2(faceLength / 2), hangingwall: null, footwall: null });
  return stations;
}

/* ── section profile ──────────────────────────────────────────────────── */

export interface ProfilePoint {
  x: number;
  y: number;
  index: number;
  breach: boolean;
}

export interface SectionProfile {
  /** Drawing space, y increasing downward. */
  width: number;
  height: number;
  /** The BMSZ datum line. */
  datumY: number;
  hangingwallLimitY: number;
  footwallLimitY: number;
  hangingwall: ProfilePoint[];
  footwall: ProfilePoint[];
  /** Horizontal grid values in metres, top to bottom. */
  ticks: { value: number; y: number }[];
  xFor: (index: number) => number;
}

/**
 * Geometry for the face section — the drawing on the Face Marking Sheet.
 *
 * Reproduces the sheet's own shape: a vertical scale in metres centred on the
 * BMSZ at zero, the two mining-cut limits as horizontal lines, and the
 * measured hangingwall and footwall traces across the face. A technician who
 * has filled in these sheets by hand should recognise it immediately.
 */
export function buildSectionProfile(
  measurement: FaceMeasurement,
  size: { width?: number; height?: number; padding?: number } = {},
): SectionProfile {
  const width = size.width ?? 320;
  const height = size.height ?? 180;
  const padding = size.padding ?? 14;
  const padLeft = padding + 20;

  const summary = summariseFaceMeasurement(measurement);
  const values = summary.stations.flatMap((s) => [s.hangingwall, s.footwall]).filter((v): v is number => v !== null);

  // The frame always contains both limits, so a compliant face and a breaching
  // one are drawn at the same scale and can be compared by eye.
  const top = Math.max(measurement.limits.hangingwall + 0.35, ...values, 0.5);
  const bottom = Math.min(measurement.limits.footwall - 0.35, ...values, -0.5);
  const span = top - bottom || 1;

  const yFor = (v: number) => padding + ((top - v) / span) * (height - padding * 2);
  const count = Math.max(summary.stations.length, 2);
  const xFor = (i: number) => padLeft + (i * (width - padLeft - padding)) / (count - 1);

  const point = (s: StationAssessment, value: number | null, breach: boolean): ProfilePoint | null =>
    value === null ? null : { x: xFor(s.index), y: yFor(value), index: s.index, breach };

  const ticks: { value: number; y: number }[] = [];
  for (let v = Math.ceil(top * 2) / 2; v >= bottom; v -= 0.5) {
    ticks.push({ value: round2(v), y: yFor(v) });
  }

  return {
    width,
    height,
    datumY: yFor(0),
    hangingwallLimitY: yFor(measurement.limits.hangingwall),
    footwallLimitY: yFor(measurement.limits.footwall),
    hangingwall: summary.stations
      .map((s) => point(s, s.hangingwall, s.hangingwallBreach))
      .filter((p): p is ProfilePoint => p !== null),
    footwall: summary.stations
      .map((s) => point(s, s.footwall, s.footwallBreach))
      .filter((p): p is ProfilePoint => p !== null),
    ticks,
    xFor,
  };
}

/* ── helpers ──────────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Reasons a station may sit outside the mining-cut limits. */
export const DEFAULT_BREACH_REASONS = [
  'Blast over-break',
  'Ground conditions',
  'BMSZ position uncertain',
  'Support installed',
  'Geological structure',
  'Other — see notes',
];
