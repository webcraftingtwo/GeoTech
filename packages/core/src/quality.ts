/**
 * Data-quality score (§35).
 *
 * The score answers "is this record complete enough to be useful later", not
 * "is this technician doing a good job". Two consequences shape the
 * implementation:
 *
 *  - **Uncertainty is not a defect.** A confidence of LOW scores exactly the
 *    same as HIGH. What is scored is whether confidence was *recorded*.
 *  - **Criteria that do not apply are excluded from the denominator.** A face
 *    with no structure in it is not penalised for having no orientation.
 */

import type { Confidence } from './types.js';

export interface QualityCriterion {
  key: string;
  label: string;
  weight: number;
  applicable: boolean;
  met: boolean;
  /** Shown to the technician as the single next thing worth adding. */
  hint: string;
}

export interface QualityScore {
  /** 0–100, rounded. Applicable criteria only. */
  score: number;
  criteria: QualityCriterion[];
  /** Unmet applicable criteria, heaviest first — the "what to fix" list. */
  gaps: QualityCriterion[];
  band: 'GOOD' | 'ADEQUATE' | 'INCOMPLETE';
}

export interface QualityInput {
  hasLocation: boolean;
  hasPhoto: boolean;
  /** Whether a structure was present at the face at all. */
  structurePresent: boolean;
  structureClassified: boolean;
  orientationRecorded: boolean;
  /** Whether an offset was observed at the face at all. */
  offsetPresent: boolean;
  offsetRecorded: boolean;
  observationConfidence?: Confidence | null;
  requiredFieldsComplete: boolean;
  hasObservation: boolean;
  /** Reef intersected at this face — reef detail is then expected. */
  reefPresent?: boolean;
  reefDetailRecorded?: boolean;
}

export function scoreRecord(input: QualityInput): QualityScore {
  const criteria: QualityCriterion[] = [
    {
      key: 'location',
      label: 'Location recorded',
      weight: 20,
      applicable: true,
      met: input.hasLocation,
      hint: 'Add a survey station or reference so the observation can be placed on the mine plan.',
    },
    {
      key: 'required_fields',
      label: 'Required fields complete',
      weight: 20,
      applicable: true,
      met: input.requiredFieldsComplete,
      hint: 'Some required fields are still empty — check the warnings on the review screen.',
    },
    {
      key: 'observation',
      label: 'Geological observation recorded',
      weight: 15,
      applicable: true,
      met: input.hasObservation,
      hint: 'Record at least one geological observation for this face.',
    },
    {
      key: 'photo',
      label: 'Photograph attached',
      weight: 15,
      applicable: true,
      met: input.hasPhoto,
      hint: 'Take a face photograph — it is what any later interpretation rests on.',
    },
    {
      key: 'confidence',
      label: 'Confidence recorded',
      weight: 10,
      applicable: true,
      met: input.observationConfidence != null,
      hint: 'Record your confidence. LOW is a perfectly valid answer.',
    },
    {
      key: 'structure_classified',
      label: 'Structure classified',
      weight: 8,
      applicable: input.structurePresent,
      met: input.structureClassified,
      hint: 'Classify the structure you recorded — fault, joint, dyke or shear.',
    },
    {
      key: 'orientation',
      label: 'Orientation recorded',
      weight: 8,
      applicable: input.structurePresent,
      met: input.orientationRecorded,
      hint: 'Add strike, dip and dip direction so the structure can be plotted and correlated.',
    },
    {
      key: 'offset',
      label: 'Offset measured',
      weight: 8,
      applicable: input.offsetPresent,
      met: input.offsetRecorded,
      hint: 'Measure and record the displacement across the structure.',
    },
    {
      key: 'reef_detail',
      label: 'Reef detail recorded',
      weight: 6,
      applicable: input.reefPresent === true,
      met: input.reefDetailRecorded === true,
      hint: 'Record reef width, hangingwall and footwall lithology for the reef intersection.',
    },
  ];

  const applicable = criteria.filter((c) => c.applicable);
  const total = applicable.reduce((sum, c) => sum + c.weight, 0);
  const earned = applicable.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  const score = total === 0 ? 100 : Math.round((earned / total) * 100);

  return {
    score,
    criteria,
    gaps: applicable.filter((c) => !c.met).sort((a, b) => b.weight - a.weight),
    band: score >= 85 ? 'GOOD' : score >= 60 ? 'ADEQUATE' : 'INCOMPLETE',
  };
}

/** The single most valuable thing the technician could still add. */
export function nextBestAction(score: QualityScore): string | null {
  return score.gaps[0]?.hint ?? null;
}
