/**
 * Validation engine (§18).
 *
 * Two design rules govern everything here:
 *
 *  1. **The same rules run on the device and on the server.** A rule that lives
 *     only on the device is unenforceable; one that lives only on the server
 *     rejects work the technician has already walked away from.
 *
 *  2. **Warn, don't block.** Geology is genuinely uncertain and a technician at
 *     a face has limited time. `ERROR` is reserved for values that cannot be
 *     interpreted at all (a missing sample number, a dip outside the mine's
 *     convention). Everything else is a `WARNING` that travels with the record
 *     for the geologist to weigh — including some values that are merely
 *     unusual rather than wrong.
 */

import type {
  EntityType,
  FaceLog,
  GeologicalOffset,
  Hazard,
  Observation,
  ReefObservation,
  Sample,
  Structure,
} from './types.js';
import {
  DEFAULT_CONVENTION,
  isValidCode,
  type MeasurementConvention,
  type RefList,
} from './reference.js';

/**
 * How far a face can advance past its sampling channel before the channel
 * assay can no longer be tied to it, in metres.
 */
export const CHANNEL_TIE_LIMIT_M = 9;

export type Severity = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  field: string;
  severity: Severity;
  /** Stable machine code, so the UI can style or suppress a specific issue. */
  code: string;
  /** Plain language, actionable. Never "Something went wrong" (§42). */
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** True when nothing blocks submission. Warnings do not block. */
  ok: boolean;
}

/* ── administrator-configured rules (§38) ─────────────────────────────── */

export type RuleType =
  | 'REQUIRED'
  | 'RANGE'
  | 'ONE_OF'
  | 'NON_NEGATIVE'
  | 'PATTERN'
  | 'MAX_LENGTH';

export interface ConfigurableRule {
  id: string;
  entity: EntityType;
  field: string;
  ruleType: RuleType;
  params?: {
    min?: number;
    max?: number;
    values?: string[];
    pattern?: string;
    maxLength?: number;
  };
  severity: Severity;
  message?: string;
  active: boolean;
}

export interface ValidationContext {
  convention?: MeasurementConvention;
  lists?: RefList[];
  rules?: ConfigurableRule[];
  /** Sample numbers already known to the device or the database (§16). */
  knownSampleNumbers?: Iterable<string>;
  /** Whether at least one photograph is attached to the record. */
  hasPhoto?: boolean;
  /** Whether the record has at least one associated observation. */
  hasObservation?: boolean;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

const present = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));

const issue = (
  field: string,
  severity: Severity,
  code: string,
  message: string,
  value?: unknown,
): ValidationIssue => ({ field, severity, code, message, value });

function result(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');
  return { issues, errors, warnings, ok: errors.length === 0 };
}

function angleIssues(
  field: string,
  label: string,
  value: number | null | undefined,
  min: number,
  max: number,
): ValidationIssue[] {
  if (!present(value)) return [];
  const v = value as number;
  if (!Number.isFinite(v)) {
    return [issue(field, 'ERROR', 'angle.not_a_number', `${label} must be a number.`, value)];
  }
  if (v < min || v > max) {
    return [
      issue(
        field,
        'ERROR',
        'angle.out_of_convention',
        `${label} of ${v}° is outside the configured convention (${min}–${max}°). Check the reading, or ask an administrator whether the measurement convention needs changing.`,
        v,
      ),
    ];
  }
  return [];
}

/**
 * Cross-checks strike against dip direction under the mine's configured rule.
 * A mismatch is common and often legitimate (a mis-keyed digit, or a mine that
 * records the two independently), so this warns rather than blocks.
 */
function strikeDipDirectionIssues(
  strike: number | null | undefined,
  dipDirection: number | null | undefined,
  c: MeasurementConvention,
): ValidationIssue[] {
  if (c.strikeDipRule === 'NONE') return [];
  if (!present(strike) || !present(dipDirection)) return [];
  const offset = c.strikeDipRule === 'RIGHT_HAND' ? 90 : -90;
  const expected = ((strike as number) + offset + 360) % 360;
  const actual = ((dipDirection as number) % 360 + 360) % 360;
  let diff = Math.abs(expected - actual);
  if (diff > 180) diff = 360 - diff;
  if (diff > c.strikeDipToleranceDeg) {
    return [
      issue(
        'dipDirection',
        'WARNING',
        'orientation.strike_dipdir_mismatch',
        `Dip direction ${actual}° does not agree with strike ${strike}° under the ${
          c.strikeDipRule === 'RIGHT_HAND' ? 'right-hand' : 'left-hand'
        } rule (expected about ${Math.round(expected)}°). Confirm both readings.`,
        { strike, dipDirection, expected },
      ),
    ];
  }
  return [];
}

/** "Orientation incomplete" — a structure needs all three components (§18). */
function orientationCompleteness(o: {
  strike?: number | null;
  dip?: number | null;
  dipDirection?: number | null;
}): ValidationIssue[] {
  const have = [o.strike, o.dip, o.dipDirection].filter(present).length;
  if (have === 0) {
    return [
      issue(
        'strike',
        'WARNING',
        'orientation.missing',
        'Orientation incomplete — no strike, dip or dip direction recorded. The structure can still be saved, but it cannot be plotted or correlated without an orientation.',
      ),
    ];
  }
  if (have < 3) {
    return [
      issue(
        'strike',
        'WARNING',
        'orientation.incomplete',
        'Orientation incomplete — strike, dip and dip direction should all be recorded where the structure is accessible.',
      ),
    ];
  }
  return [];
}

/* ── configurable rule evaluation ─────────────────────────────────────── */

export function applyConfigurableRules(
  entity: EntityType,
  record: Record<string, unknown>,
  rules: ConfigurableRule[] = [],
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const rule of rules) {
    if (!rule.active || rule.entity !== entity) continue;
    const value = record[rule.field];
    const p = rule.params ?? {};
    const fail = (code: string, fallback: string, v?: unknown) =>
      out.push(issue(rule.field, rule.severity, code, rule.message ?? fallback, v));

    switch (rule.ruleType) {
      case 'REQUIRED':
        if (!present(value)) fail('rule.required', `${rule.field} is required.`);
        break;
      case 'NON_NEGATIVE':
        if (present(value) && typeof value === 'number' && value < 0)
          fail('rule.non_negative', `${rule.field} cannot be negative.`, value);
        break;
      case 'RANGE':
        if (present(value) && typeof value === 'number') {
          if ((p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max))
            fail(
              'rule.range',
              `${rule.field} of ${value} is outside the permitted range (${p.min ?? '−∞'} to ${p.max ?? '∞'}).`,
              value,
            );
        }
        break;
      case 'ONE_OF':
        if (present(value) && p.values && !p.values.includes(String(value)))
          fail('rule.one_of', `${rule.field} must be one of: ${p.values.join(', ')}.`, value);
        break;
      case 'PATTERN':
        if (present(value) && p.pattern && !new RegExp(p.pattern).test(String(value)))
          fail('rule.pattern', `${rule.field} is not in the expected format.`, value);
        break;
      case 'MAX_LENGTH':
        if (present(value) && p.maxLength !== undefined && String(value).length > p.maxLength)
          fail('rule.max_length', `${rule.field} is longer than ${p.maxLength} characters.`, value);
        break;
    }
  }
  return out;
}

/* ── entity validators ────────────────────────────────────────────────── */

export function validateFaceLog(log: Partial<FaceLog>, ctx: ValidationContext = {}): ValidationResult {
  const c = ctx.convention ?? DEFAULT_CONVENTION;
  const issues: ValidationIssue[] = [];

  if (!present(log.workplaceId))
    issues.push(issue('workplaceId', 'ERROR', 'facelog.workplace_required', 'Select the working place before saving this face log.'));

  if (!present(log.shiftDate))
    issues.push(issue('shiftDate', 'ERROR', 'facelog.date_required', 'Shift date is required.'));

  if (!present(log.shift))
    issues.push(issue('shift', 'WARNING', 'facelog.shift_missing', 'Shift not recorded. It is normally filled in automatically — confirm it before submitting.'));

  // Location required (§18) — but underground that means a survey reference OR
  // coordinates, not GPS, which may never be available (§7).
  const hasSurveyRef = present(log.surveyReference);
  const hasCoords = present(log.easting) && present(log.northing);
  if (!hasSurveyRef && !hasCoords) {
    issues.push(
      issue(
        'surveyReference',
        'ERROR',
        'facelog.location_required',
        'Location required — record a survey station or reference, or enter coordinates. GPS is not expected to work underground.',
      ),
    );
  }
  if (hasCoords && !present(log.coordinateSystem)) {
    issues.push(
      issue('coordinateSystem', 'WARNING', 'facelog.coordinate_system_missing', 'Coordinates entered without a coordinate system — the position cannot be plotted reliably.'),
    );
  }
  // The overseer's acknowledgement is the one safety control the application
  // still carries, and it blocks: geology does not send anyone to a face that
  // has not been made safe. Everything else that used to gate a face log —
  // tool checks, pre-inspection lists — has been removed at the Chief
  // Geologist's instruction, on the grounds that it duplicated controls the
  // mine already runs elsewhere.
  if (log.areaMadeSafe === false) {
    issues.push(
      issue(
        'areaMadeSafe',
        'ERROR',
        'facelog.area_not_made_safe',
        'The overseer has not declared this area made safe. Do not log this face until they have.',
      ),
    );
  } else if (!present(log.areaMadeSafe)) {
    issues.push(
      issue('areaMadeSafe', 'ERROR', 'facelog.area_safety_unrecorded', 'Record the overseer\u2019s declaration that the area was made safe.'),
    );
  }
  if (log.areaMadeSafe === true && !present(log.overseer)) {
    issues.push(
      issue('overseer', 'ERROR', 'facelog.overseer_required', 'Name the overseer who declared the area made safe. A declaration with nobody behind it is not one.'),
    );
  }

  // Past roughly 9 m the face can no longer be safely tied to its channel
  // assay. Said plainly and not refused: an 11 m face is a real face, and the
  // problem with it is exactly what a geologist needs to see.
  if (present(log.distanceToChannel)) {
    const d = log.distanceToChannel as number;
    if (d < 0) {
      issues.push(issue('distanceToChannel', 'ERROR', 'facelog.channel_distance_negative', 'Distance to the channel cannot be negative.', d));
    } else if (d > CHANNEL_TIE_LIMIT_M) {
      issues.push(
        issue(
          'distanceToChannel',
          'WARNING',
          'facelog.channel_distance_far',
          `The face is ${d} m past channel ${log.channelId ?? '(unnamed)'}, beyond the ${CHANNEL_TIE_LIMIT_M} m within which the channel assay can be tied to it. Record it, and say so to the geologist.`,
          d,
        ),
      );
    }
  }
  if (ctx.hasObservation === false) {
    issues.push(issue('observations', 'WARNING', 'facelog.no_observations', 'No geological observations recorded against this face log yet.'));
  }
  if (ctx.hasPhoto === false) {
    issues.push(issue('photos', 'WARNING', 'facelog.no_photo', 'No face photograph attached. A photograph supports every later interpretation of this face.'));
  }

  issues.push(...applyConfigurableRules('FACE_LOG', log as Record<string, unknown>, ctx.rules));
  void c;
  return result(issues);
}

export function validateObservation(obs: Partial<Observation>, ctx: ValidationContext = {}): ValidationResult {
  const c = ctx.convention ?? DEFAULT_CONVENTION;
  const issues: ValidationIssue[] = [];

  if (!present(obs.observationType))
    issues.push(issue('observationType', 'ERROR', 'observation.type_required', 'Select what was observed before saving.'));
  else if (ctx.lists && !isValidCode(ctx.lists, 'observation_type', obs.observationType))
    issues.push(issue('observationType', 'WARNING', 'observation.type_unknown', `Observation type "${obs.observationType}" is not in the current reference list. It may have been retired by an administrator.`, obs.observationType));

  if (!present(obs.confidence))
    issues.push(issue('confidence', 'WARNING', 'observation.confidence_missing', 'Geological confidence not recorded. Low confidence is a valid answer — recording it is what matters.'));

  issues.push(...angleIssues('dip', 'Dip', obs.dip, c.dipMin, c.dipMax));
  issues.push(...angleIssues('strike', 'Strike', obs.strike, c.strikeMin, c.strikeMax));
  issues.push(...angleIssues('dipDirection', 'Dip direction', obs.dipDirection, c.dipDirectionMin, c.dipDirectionMax));
  issues.push(...strikeDipDirectionIssues(obs.strike, obs.dipDirection, c));

  if (present(obs.width)) {
    const w = obs.width as number;
    if (w < 0) issues.push(issue('width', 'ERROR', 'observation.negative_width', 'Width cannot be negative.', w));
    else if (w > c.maxPlausibleWidthM)
      issues.push(issue('width', 'WARNING', 'observation.width_implausible', `Width of ${w} m is unusually large — confirm the value and the unit.`, w));
  }

  if (present(obs.strike) || present(obs.dip) || present(obs.dipDirection)) {
    if (!present(obs.measurementSource))
      issues.push(issue('measurementSource', 'WARNING', 'observation.source_missing', 'Record whether the orientation was taken with the device sensor or entered manually — the two are not equivalent.'));
  }

  issues.push(...applyConfigurableRules('OBSERVATION', obs as Record<string, unknown>, ctx.rules));
  return result(issues);
}

export function validateStructure(str: Partial<Structure>, ctx: ValidationContext = {}): ValidationResult {
  const c = ctx.convention ?? DEFAULT_CONVENTION;
  const issues: ValidationIssue[] = [];

  if (!present(str.structureType))
    issues.push(issue('structureType', 'ERROR', 'structure.type_required', 'Select the structure type before saving.'));

  issues.push(...angleIssues('dip', 'Dip', str.dip, c.dipMin, c.dipMax));
  issues.push(...angleIssues('strike', 'Strike', str.strike, c.strikeMin, c.strikeMax));
  issues.push(...angleIssues('dipDirection', 'Dip direction', str.dipDirection, c.dipDirectionMin, c.dipDirectionMax));
  issues.push(...strikeDipDirectionIssues(str.strike, str.dipDirection, c));
  issues.push(...orientationCompleteness(str));

  for (const [field, label] of [
    ['width', 'Width'],
    ['spacing', 'Spacing'],
    ['persistence', 'Persistence'],
    ['aperture', 'Aperture'],
  ] as const) {
    const v = str[field];
    if (present(v) && (v as number) < 0)
      issues.push(issue(field, 'ERROR', 'structure.negative_measurement', `${label} cannot be negative.`, v));
  }

  if (!present(str.measurementSource) && (present(str.strike) || present(str.dip)))
    issues.push(issue('measurementSource', 'WARNING', 'structure.source_missing', 'Record whether the orientation came from the device sensor or a manual reading (§15).'));

  if (!present(str.confidence))
    issues.push(issue('confidence', 'WARNING', 'structure.confidence_missing', 'Geological confidence not recorded.'));

  issues.push(...applyConfigurableRules('STRUCTURE', str as Record<string, unknown>, ctx.rules));
  return result(issues);
}

export function validateOffset(off: Partial<GeologicalOffset>, ctx: ValidationContext = {}): ValidationResult {
  const c = ctx.convention ?? DEFAULT_CONVENTION;
  const issues: ValidationIssue[] = [];

  if (!present(off.markerType))
    issues.push(issue('markerType', 'ERROR', 'offset.marker_required', 'Select which geological marker was displaced — the offset means nothing without it.'));

  if (!present(off.apparentOffset)) {
    issues.push(issue('apparentOffset', 'ERROR', 'offset.measurement_required', 'Enter the apparent offset you measured.'));
  } else {
    const v = off.apparentOffset as number;
    if (v < 0 && !c.allowNegativeOffset) {
      issues.push(
        issue(
          'apparentOffset',
          'WARNING',
          'offset.negative',
          `Apparent offset of ${v} m is negative. Direction is recorded separately, so the measurement is normally positive — flagged for geologist review.`,
          v,
        ),
      );
    }
    if (Math.abs(v) > c.maxPlausibleOffsetM) {
      issues.push(issue('apparentOffset', 'WARNING', 'offset.implausible', `Apparent offset of ${v} m is unusually large — confirm the value and the unit.`, v));
    }
    if (v === 0) {
      issues.push(issue('apparentOffset', 'WARNING', 'offset.zero', 'Apparent offset recorded as zero. If the marker is not displaced, record the structure without an offset instead.', v));
    }
  }

  if (!present(off.unit))
    issues.push(issue('unit', 'WARNING', 'offset.unit_missing', `No unit recorded — assuming ${c.defaultUnit}. Confirm before submitting.`));

  if (!present(off.lateralSense) && !present(off.verticalSense) && !present(off.offsetDirection))
    issues.push(issue('offsetDirection', 'WARNING', 'offset.sense_missing', 'No sense of displacement recorded. Which way did the marker step — left/right, up/down?'));

  issues.push(...angleIssues('dip', 'Dip', off.dip, c.dipMin, c.dipMax));
  issues.push(...angleIssues('strike', 'Strike', off.strike, c.strikeMin, c.strikeMax));
  issues.push(...angleIssues('dipDirection', 'Dip direction', off.dipDirection, c.dipDirectionMin, c.dipDirectionMax));
  issues.push(...strikeDipDirectionIssues(off.strike, off.dipDirection, c));

  // Geometric sanity: measured along the fault plane, neither component can
  // exceed the apparent offset.
  if (present(off.apparentOffset)) {
    const a = Math.abs(off.apparentOffset as number);
    for (const [field, label] of [
      ['throwObserved', 'Throw'],
      ['heaveObserved', 'Heave'],
    ] as const) {
      const v = off[field];
      if (present(v) && Math.abs(v as number) > a + 1e-9) {
        issues.push(
          issue(
            field,
            'WARNING',
            'offset.component_exceeds_apparent',
            `${label} of ${v} m is larger than the apparent offset of ${a} m. Confirm which measurement was taken along the structure.`,
            v,
          ),
        );
      }
    }
  }

  if (!present(off.confidence))
    issues.push(issue('confidence', 'WARNING', 'offset.confidence_missing', 'Record how confident you are in this measurement — HIGH, MEDIUM or LOW.'));

  if (ctx.hasPhoto === false)
    issues.push(issue('photos', 'WARNING', 'offset.photo_missing', 'No photograph attached. A photograph of the offset is strongly encouraged — it is the only way the measurement can be checked later.'));

  issues.push(...applyConfigurableRules('OFFSET', off as Record<string, unknown>, ctx.rules));
  return result(issues);
}

export function validateReefObservation(reef: Partial<ReefObservation>, ctx: ValidationContext = {}): ValidationResult {
  const c = ctx.convention ?? DEFAULT_CONVENTION;
  const issues: ValidationIssue[] = [];

  if (!present(reef.reefNameCode))
    issues.push(issue('reefNameCode', 'WARNING', 'reef.name_missing', 'Reef not identified. Select the reef horizon if it can be determined.'));

  if (present(reef.reefWidth)) {
    const w = reef.reefWidth as number;
    if (w < 0) issues.push(issue('reefWidth', 'ERROR', 'reef.negative_width', 'Reef width cannot be negative.', w));
    else if (w === 0) issues.push(issue('reefWidth', 'WARNING', 'reef.zero_width', 'Reef width recorded as zero — confirm the measurement.', w));
    else if (w > c.maxPlausibleWidthM) issues.push(issue('reefWidth', 'WARNING', 'reef.width_implausible', `Reef width of ${w} m is unusually large — confirm the value and the unit.`, w));
  } else {
    issues.push(issue('reefWidth', 'WARNING', 'reef.width_missing', 'Reef width not measured.'));
  }

  if (!present(reef.confidence))
    issues.push(issue('confidence', 'WARNING', 'reef.confidence_missing', 'Geological confidence not recorded.'));

  issues.push(...applyConfigurableRules('REEF_OBSERVATION', reef as Record<string, unknown>, ctx.rules));
  return result(issues);
}

export function validateSample(sample: Partial<Sample>, ctx: ValidationContext = {}): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!present(sample.sampleNumber)) {
    issues.push(issue('sampleNumber', 'ERROR', 'sample.id_required', 'Sample ID required — the sample cannot be tracked to the laboratory without it.'));
  } else if (ctx.knownSampleNumbers) {
    const target = String(sample.sampleNumber).trim().toUpperCase();
    for (const known of ctx.knownSampleNumbers) {
      if (String(known).trim().toUpperCase() === target) {
        issues.push(issue('sampleNumber', 'ERROR', 'sample.duplicate', `Sample ID ${sample.sampleNumber} has already been used. Every sample number must be unique.`, sample.sampleNumber));
        break;
      }
    }
  }

  if (!present(sample.sampleType))
    issues.push(issue('sampleType', 'ERROR', 'sample.type_required', 'Select the sample type.'));

  const from = sample.fromPosition;
  const to = sample.toPosition;
  const len = sample.length;

  if (present(from) && present(to)) {
    if ((to as number) <= (from as number))
      issues.push(issue('toPosition', 'WARNING', 'sample.positions_reversed', 'The "to" position is not beyond the "from" position. Check the two readings.', { from, to }));
    if (present(len)) {
      const derived = Math.abs((to as number) - (from as number));
      if (Math.abs(derived - (len as number)) > 0.05)
        issues.push(issue('length', 'WARNING', 'sample.length_mismatch', `Recorded length of ${len} m does not match the positions (${derived.toFixed(2)} m). Confirm which is correct.`, { len, derived }));
    }
  }

  if (present(len) && (len as number) <= 0)
    issues.push(issue('length', 'ERROR', 'sample.non_positive_length', 'Sample length must be greater than zero.', len));

  issues.push(...applyConfigurableRules('SAMPLE', sample as Record<string, unknown>, ctx.rules));
  return result(issues);
}

export function validateHazard(hazard: Partial<Hazard>, ctx: ValidationContext = {}): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!present(hazard.hazardType))
    issues.push(issue('hazardType', 'ERROR', 'hazard.type_required', 'Select the hazard type.'));
  if (!present(hazard.description))
    issues.push(issue('description', 'ERROR', 'hazard.description_required', 'Describe the hazard — a type alone is not enough for someone acting on it later.'));
  if (!present(hazard.severity))
    issues.push(issue('severity', 'ERROR', 'hazard.severity_required', 'Record the severity.'));
  if (!present(hazard.notifiedPerson))
    issues.push(issue('notifiedPerson', 'WARNING', 'hazard.notification_missing', 'No person or team recorded as notified. This app does not replace the mine formal hazard reporting procedure — report through the normal channel as well.'));
  if (ctx.hasPhoto === false)
    issues.push(issue('photos', 'WARNING', 'hazard.photo_missing', 'No photograph attached to the hazard.'));

  issues.push(...applyConfigurableRules('HAZARD', hazard as Record<string, unknown>, ctx.rules));
  return result(issues);
}

/* ── dispatch ─────────────────────────────────────────────────────────── */

export function validateRecord(
  entity: EntityType,
  record: Record<string, unknown>,
  ctx: ValidationContext = {},
): ValidationResult {
  switch (entity) {
    case 'FACE_LOG':
      return validateFaceLog(record as Partial<FaceLog>, ctx);
    case 'OBSERVATION':
      return validateObservation(record as Partial<Observation>, ctx);
    case 'REEF_OBSERVATION':
      return validateReefObservation(record as Partial<ReefObservation>, ctx);
    case 'STRUCTURE':
      return validateStructure(record as Partial<Structure>, ctx);
    case 'OFFSET':
      return validateOffset(record as Partial<GeologicalOffset>, ctx);
    case 'SAMPLE':
      return validateSample(record as Partial<Sample>, ctx);
    case 'HAZARD':
      return validateHazard(record as Partial<Hazard>, ctx);
    default:
      return result(applyConfigurableRules(entity, record, ctx.rules));
  }
}
