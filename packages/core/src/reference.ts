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
      item('BMSZ', 'BMSZ (base of the Main Sulphide Zone)', 10),
      item('REEF', 'Reef', 20),
      item('HANGINGWALL', 'Hangingwall', 30),
      item('FOOTWALL', 'Footwall', 40),
      item('FAULT', 'Fault', 50),
      item('SHEAR', 'Shear', 60),
      item('DYKE', 'Dyke', 70),
      item('SILL', 'Sill', 80),
      item('VEIN', 'Vein', 90),
      item('JOINT', 'Joint', 100),
      item('CONTACT', 'Contact', 110),
      item('FRACTURE', 'Fracture', 120),
      item('XENOLITH', 'Xenolith', 130),
      item('REPLACEMENT_PEGMATITE', 'Replacement pegmatite', 140),
      item('GROUND_CONDITION', 'Ground condition', 150),
      item('OTHER', 'Other', 999),
    ],
  },
  {
    code: 'structure_type',
    name: 'Structure type',
    description: 'Structural feature types available for measurement (§14).',
    mineSpecific: true,
    items: [
      // A fault has observable displacement; a shear is closely spaced
      // jointing from tangential stress. The standard is emphatic that the two
      // must be distinguished (STD-201 §9.3).
      item('FAULT', 'Fault', 10, { fields: ['strike', 'dip', 'dipDirection', 'width', 'infill', 'condition'] }),
      item('SHEAR', 'Shear', 20, { fields: ['strike', 'dip', 'dipDirection', 'width', 'intensity'] }),
      item('THRUST', 'Thrust (fault parallel to layering)', 30, { fields: ['strike', 'dip', 'dipDirection', 'width'] }),
      item('JOINT', 'Joint', 40, { fields: ['strike', 'dip', 'dipDirection', 'spacing', 'persistence', 'aperture', 'condition'] }),
      item('DYKE', 'Dyke', 50, { fields: ['strike', 'dip', 'dipDirection', 'width', 'composition'] }),
      item('SILL', 'Sill', 60, { fields: ['strike', 'dip', 'dipDirection', 'width', 'composition'] }),
      item('VEIN', 'Vein', 70, { fields: ['strike', 'dip', 'dipDirection', 'width', 'composition'] }),
      item('OTHER', 'Other', 999, { fields: ['strike', 'dip', 'dipDirection'] }),
    ],
  },
  {
    code: 'reef_name',
    name: 'Reef name',
    description: 'Reef horizons. Confirm against the mine geological standard before production use.',
    mineSpecific: true,
    items: [
      item('MSZ', 'Main Sulphide Zone (MSZ)', 10),
      item('BMSZ', 'Base of the Main Sulphide Zone (BMSZ)', 20),
      item('OTHER', 'Other', 999),
    ],
  },
  {
    code: 'lithology',
    name: 'Lithology',
    description: 'Rock types for hangingwall, footwall and material description.',
    mineSpecific: true,
    items: [
      item('PYROXENITE', 'Pyroxenite', 10),
      item('PLAGIOCLASE_PYROXENITE', 'Plagioclase pyroxenite', 20),
      item('NORITE', 'Norite', 30),
      item('ANORTHOSITE', 'Anorthosite', 40),
      item('GABBRO', 'Gabbro', 50),
      item('CHROMITITE', 'Chromitite', 60),
      // Replaces the reef and is PGE barren at Unki (STD-201 §3.0).
      item('REPLACEMENT_PEGMATITE', 'Replacement pegmatite', 70),
      item('XENOLITH', 'Xenolith', 80),
      item('AUTOLITH', 'Autolith', 90),
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
      item('BMSZ', 'BMSZ', 10),
      item('REEF', 'Reef', 20),
      item('REEF_CONTACT', 'Reef contact', 30),
      item('GEOLOGICAL_CONTACT', 'Geological contact', 40),
      item('DYKE', 'Dyke', 50),
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
    code: 'face_limit_set',
    name: 'Face mining-cut limits',
    description:
      'BMSZ-to-hangingwall and BMSZ-to-footwall limits applied to a face (§9.8), in centimetres. Revised only under Chief Geologist authorisation; the applied values are stored on each measurement so a revision never reinterprets a historical face.',
    mineSpecific: true,
    items: [
      item('BORD', 'Bord / ledging decline', 10, { hangingwall: 45, footwall: -135 }),
      item('DECLINE', 'Decline', 20, { hangingwall: 150, footwall: -100 }),
    ],
  },
  {
    code: 'face_breach_reason',
    name: 'Face limit breach reason',
    description: 'Why a station sits outside the mining-cut limits. Required on every breaching station.',
    mineSpecific: true,
    items: [
      item('BLAST_OVERBREAK', 'Blast over-break', 10),
      item('GROUND_CONDITIONS', 'Ground conditions', 20),
      item('BMSZ_UNCERTAIN', 'BMSZ position uncertain', 30),
      item('SUPPORT_INSTALLED', 'Support installed', 40),
      item('GEOLOGICAL_STRUCTURE', 'Geological structure', 50),
      item('OTHER', 'Other — see notes', 999),
    ],
  },
  {
    code: 'face_measurement_method',
    name: 'Face measurement method',
    description: 'Instrument used for the tape offsets (§9.8.v).',
    mineSpecific: false,
    items: [item('DISTOMETER', 'Distometer', 10), item('TAPE_5M', '5 m tape measure', 20)],
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
    items: [
      item('CHANNEL', 'Channel', 10),
      item('CHIP', 'Chip', 20),
      item('GRAB', 'Grab', 30),
      item('CORE', 'Core', 40),
      item('XRF', 'Handheld XRF reading', 50),
      item('OTHER', 'Other', 999),
    ],
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
    description:
      'Kind of underground working place. Unki mines bord-and-pillar: a section contains numbered bords and a strike belt (UNKI-MIN-MRM-STD-201 §9.1).',
    mineSpecific: true,
    items: [
      item('BORD', 'Bord', 10),
      item('STRIKE_BELT', 'Strike belt', 20),
      item('END', 'End', 30),
      item('RAISE', 'Raise', 40),
      item('DECLINE', 'Decline', 50),
      item('LEDGING', 'Ledging', 60),
      item('OTHER', 'Other', 999),
    ],
  },
  {
    code: 'shift',
    name: 'Shift',
    description: 'Shift identifiers as used by the mine.',
    mineSpecific: true,
    // Morning, afternoon or night — the shifts named in STD-201 §3.0.
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
    code: 'tarp_class',
    name: 'TARP system class',
    description:
      'Trigger Action Response Plan class for the heading. Recorded on every face log.',
    mineSpecific: true,
    items: [
      item('1', 'Class 1', 10),
      item('2', 'Class 2', 20),
      item('3', 'Class 3', 30),
      item('S', 'Class S', 40),
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
  // Centimetres, at the Chief Geologist's instruction: it is what the
  // technician reads off the tape, and a reading converted on entry is a
  // reading that can be converted wrongly.
  defaultUnit: 'CM',
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
