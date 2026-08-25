/**
 * Configurable reference data (§11, §38, §39).
 *
 * No mine-specific geological term is hard-coded anywhere in this system. Every
 * list below is seed/development data, replaced by authorized mine personnel
 * through the administration panel. Records reference items **by code**, so
 * relabelling a term later does not orphan historical observations.
 */

export interface RefItem {
  code: string;
  label: string;
  sortOrder: number;
  active: boolean;
  /** Optional list-specific payload, e.g. severity rank or symbol name. */
  meta?: Record<string, unknown>;
}

export interface RefList {
  code: string;
  name: string;
  description: string;
  /** Lists the mine is expected to replace wholesale before production use. */
  mineSpecific: boolean;
  items: RefItem[];
}

const item = (
  code: string,
  label: string,
  sortOrder: number,
  meta?: Record<string, unknown>,
): RefItem => ({ code, label, sortOrder, active: true, ...(meta ? { meta } : {}) });

/**
 * `PLACEHOLDER_REFERENCE_DATA` exists so the application is runnable and
 * testable before a mine's approved lists are loaded. It deliberately uses
 * generic geological terminology and invents no official Unki codes.
 */
export const PLACEHOLDER_REFERENCE_DATA: RefList[] = [
  {
    code: 'observation_type',
    name: 'Observation type',
    description: 'Top-level classification of a geological observation (§10).',
    mineSpecific: true,
    items: [
      item('REEF', 'Reef', 10),
      item('HANGINGWALL', 'Hangingwall', 20),
      item('FOOTWALL', 'Footwall', 30),
      item('FAULT', 'Fault', 40),
      item('DYKE', 'Dyke', 50),
      item('SHEAR', 'Shear', 60),
      item('JOINT', 'Joint', 70),
      item('VEIN', 'Vein', 80),
      item('CONTACT', 'Contact', 90),
      item('FRACTURE', 'Fracture', 100),
      item('GROUND_CONDITION', 'Ground condition', 110),
      item('OTHER', 'Other', 999),
    ],
  },
  {
    code: 'structure_type',
    name: 'Structure type',
    description: 'Structural feature types available for measurement (§14).',
    mineSpecific: true,
    items: [
      item('FAULT', 'Fault', 10, { fields: ['strike', 'dip', 'dipDirection', 'width', 'infill', 'condition'] }),
      item('JOINT', 'Joint', 20, { fields: ['strike', 'dip', 'dipDirection', 'spacing', 'persistence', 'aperture', 'condition'] }),
      item('DYKE', 'Dyke', 30, { fields: ['strike', 'dip', 'dipDirection', 'width', 'composition'] }),
      item('SHEAR', 'Shear', 40, { fields: ['strike', 'dip', 'dipDirection', 'width', 'intensity'] }),
      item('OTHER', 'Other', 999, { fields: ['strike', 'dip', 'dipDirection'] }),
    ],
  },
  {
    code: 'reef_name',
    name: 'Reef name',
    description: 'Mine-approved reef horizons. MUST be configured before production use.',
    mineSpecific: true,
    items: [item('REEF_A', 'Reef horizon A (placeholder)', 10), item('REEF_B', 'Reef horizon B (placeholder)', 20)],
  },
  {
    code: 'lithology',
    name: 'Lithology',
    description: 'Rock types for hangingwall, footwall and material description.',
    mineSpecific: true,
    items: [
      item('PYROXENITE', 'Pyroxenite', 10),
      item('NORITE', 'Norite', 20),
      item('ANORTHOSITE', 'Anorthosite', 30),
      item('GABBRO', 'Gabbro', 40),
      item('CHROMITITE', 'Chromitite', 50),
      item('PEGMATOID', 'Pegmatoid', 60),
      item('OTHER', 'Other', 999),
    ],
  },
  {
    code: 'contact_type',
    name: 'Contact type',
    description: 'Nature of a geological contact.',
    mineSpecific: true,
    items: [item('SHARP', 'Sharp', 10), item('GRADATIONAL', 'Gradational', 20), item('IRREGULAR', 'Irregular', 30), item('FAULTED', 'Faulted', 40)],
  },
  {
    code: 'contact_quality',
    name: 'Contact quality',
    description: 'How clearly the contact could be observed.',
    mineSpecific: false,
    items: [item('CLEAR', 'Clear', 10), item('OBSCURED', 'Obscured', 20), item('NOT_VISIBLE', 'Not visible', 30)],
  },
  {
    code: 'marker_type',
    name: 'Offset marker',
    description: 'Geological marker whose displacement was measured (§12 step 2).',
    mineSpecific: true,
    items: [
      item('REEF', 'Reef', 10),
      item('REEF_CONTACT', 'Reef contact', 20),
      item('GEOLOGICAL_CONTACT', 'Geological contact', 30),
      item('DYKE', 'Dyke', 40),
      item('OTHER', 'Other marker', 999),
    ],
  },
  {
    code: 'offset_direction',
    name: 'Offset direction',
    description: 'Sense of displacement across the structure.',
    mineSpecific: false,
    items: [
      item('NORMAL', 'Normal', 10),
      item('REVERSE', 'Reverse', 20),
      item('SINISTRAL', 'Sinistral', 30),
      item('DEXTRAL', 'Dextral', 40),
      item('OBLIQUE', 'Oblique', 50),
      item('UNKNOWN', 'Unknown', 999),
    ],
  },
  {
    code: 'measurement_method',
    name: 'Measurement method',
    description: 'How the offset measurement was obtained.',
    mineSpecific: false,
    items: [
      item('TAPE', 'Tape measure', 10),
      item('RULER', 'Ruler / scale', 20),
      item('ESTIMATED', 'Visual estimate', 30),
      item('SURVEY', 'Survey-provided', 40),
    ],
  },
  {
    code: 'sample_type',
    name: 'Sample type',
    description: 'Sampling method (§16).',
    mineSpecific: true,
    items: [item('CHIP', 'Chip', 10), item('CHANNEL', 'Channel', 20), item('GRAB', 'Grab', 30), item('CORE', 'Core', 40), item('OTHER', 'Other', 999)],
  },
  {
    code: 'hazard_type',
    name: 'Geological hazard type',
    description: 'Complements — does not replace — the mine formal hazard reporting system (§17, §50).',
    mineSpecific: true,
    items: [
      item('FAULT', 'Fault', 10),
      item('MAJOR_JOINTING', 'Major jointing', 20),
      item('SHEAR_ZONE', 'Shear zone', 30),
      item('DYKE', 'Dyke', 40),
      item('GEOLOGICAL_CONTACT', 'Geological contact', 50),
      item('GROUND_DETERIORATION', 'Ground deterioration', 60),
      item('WATER_INTERSECTION', 'Water intersection', 70),
      item('OTHER', 'Other geological hazard', 999),
    ],
  },
  {
    code: 'hazard_severity',
    name: 'Hazard severity',
    description: 'Severity ranking for geological hazards.',
    mineSpecific: true,
    items: [item('LOW', 'Low', 10, { rank: 1 }), item('MEDIUM', 'Medium', 20, { rank: 2 }), item('HIGH', 'High', 30, { rank: 3 })],
  },
  {
    code: 'surface_condition',
    name: 'Surface condition',
    description: 'Condition of a structural surface.',
    mineSpecific: false,
    items: [item('ROUGH', 'Rough', 10), item('SMOOTH', 'Smooth', 20), item('SLICKENSIDED', 'Slickensided', 30), item('WEATHERED', 'Weathered', 40)],
  },
  {
    code: 'infill',
    name: 'Gouge / infill',
    description: 'Material filling a structure.',
    mineSpecific: false,
    items: [item('NONE', 'None', 10), item('CLAY', 'Clay', 20), item('CALCITE', 'Calcite', 30), item('QUARTZ', 'Quartz', 40), item('GOUGE', 'Gouge', 50), item('OTHER', 'Other', 999)],
  },
  {
    code: 'ground_condition',
    name: 'Ground condition',
    description: 'General ground condition at the face.',
    mineSpecific: true,
    items: [item('GOOD', 'Good', 10), item('FAIR', 'Fair', 20), item('POOR', 'Poor', 30), item('VERY_POOR', 'Very poor', 40)],
  },
  {
    code: 'workplace_type',
    name: 'Workplace type',
    description: 'Kind of underground working place (§7).',
    mineSpecific: true,
    items: [
      item('PANEL', 'Panel', 10),
      item('RAISE', 'Raise', 20),
      item('DRIVE', 'Drive', 30),
      item('STOPE', 'Stope', 40),
      item('DEVELOPMENT_END', 'Development end', 50),
    ],
  },
  {
    code: 'shift',
    name: 'Shift',
    description: 'Shift identifiers as used by the mine.',
    mineSpecific: true,
    items: [item('MORNING', 'Morning', 10), item('AFTERNOON', 'Afternoon', 20), item('NIGHT', 'Night', 30)],
  },
  {
    code: 'coordinate_system',
    name: 'Coordinate system',
    description: 'Survey coordinate systems in use. Configure to the mine survey standard.',
    mineSpecific: true,
    items: [item('MINE_GRID', 'Mine grid (placeholder)', 10), item('LOCAL', 'Local grid', 20), item('WGS84', 'WGS84', 30)],
  },
  {
    code: 'location_method',
    name: 'Location method',
    description: 'How the position of the record was established (§7).',
    mineSpecific: false,
    items: [
      item('SURVEY_STATION', 'Survey station / peg', 10),
      item('TAPE_FROM_PEG', 'Tape from last peg', 20),
      item('GPS', 'GPS (surface only)', 30),
      item('ESTIMATED', 'Estimated', 40),
    ],
  },
  {
    code: 'unit',
    name: 'Measurement unit',
    description: 'Units permitted for linear measurements.',
    mineSpecific: false,
    items: [item('M', 'metres (m)', 10, { factorToMetres: 1 }), item('CM', 'centimetres (cm)', 20, { factorToMetres: 0.01 }), item('MM', 'millimetres (mm)', 30, { factorToMetres: 0.001 })],
  },
];

/* ── measurement conventions (§18, §38) ───────────────────────────────── */

/**
 * Angular conventions differ between mines and between geological standards.
 * They are configuration, not constants — the validation engine reads them
 * rather than assuming a convention.
 */
export interface MeasurementConvention {
  /** Dip measured 0–90 from horizontal under the usual convention. */
  dipMin: number;
  dipMax: number;
  /** Strike as a full-circle bearing, or 0–180 where the mine uses half-circle. */
  strikeMin: number;
  strikeMax: number;
  dipDirectionMin: number;
  dipDirectionMax: number;
  /** Whether a negative apparent offset is meaningful in this mine's convention. */
  allowNegativeOffset: boolean;
  /**
   * Relationship the mine's standard expects between strike and dip direction.
   * `RIGHT_HAND` means dip direction = strike + 90 degrees. `NONE` disables the
   * cross-check for mines that record the two independently.
   */
  strikeDipRule: 'RIGHT_HAND' | 'LEFT_HAND' | 'NONE';
  /** Tolerance before a strike / dip-direction mismatch is flagged. */
  strikeDipToleranceDeg: number;
  defaultUnit: string;
  /** Widths beyond this are flagged for review rather than rejected. */
  maxPlausibleWidthM: number;
  maxPlausibleOffsetM: number;
}

export const DEFAULT_CONVENTION: MeasurementConvention = {
  dipMin: 0,
  dipMax: 90,
  strikeMin: 0,
  strikeMax: 360,
  dipDirectionMin: 0,
  dipDirectionMax: 360,
  allowNegativeOffset: false,
  strikeDipRule: 'RIGHT_HAND',
  strikeDipToleranceDeg: 15,
  defaultUnit: 'M',
  maxPlausibleWidthM: 50,
  maxPlausibleOffsetM: 100,
};

/* ── lookup helpers ───────────────────────────────────────────────────── */

export function findList(lists: RefList[], listCode: string): RefList | undefined {
  return lists.find((l) => l.code === listCode);
}

export function activeItems(lists: RefList[], listCode: string): RefItem[] {
  const list = findList(lists, listCode);
  if (!list) return [];
  return list.items.filter((i) => i.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Resolves a code to its label. Deactivated items still resolve, so a record
 * captured under an older terminology remains readable (§38).
 */
export function labelFor(lists: RefList[], listCode: string, code: string | null | undefined): string {
  if (!code) return '—';
  const found = findList(lists, listCode)?.items.find((i) => i.code === code);
  return found ? found.label : code;
}

export function isValidCode(lists: RefList[], listCode: string, code: string | null | undefined): boolean {
  if (!code) return false;
  return activeItems(lists, listCode).some((i) => i.code === code);
}

export function convertToMetres(lists: RefList[], value: number, unitCode: string): number {
  const unit = findList(lists, 'unit')?.items.find((i) => i.code === unitCode);
  const factor = unit?.meta?.['factorToMetres'];
  return typeof factor === 'number' ? value * factor : value;
}
