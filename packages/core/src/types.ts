/**
 * Unki GeoTech — shared domain types.
 *
 * These types are imported by the device, the server and the dashboard, so a
 * geological concept has exactly one definition in the system. Nothing
 * mine-specific is enumerated here: terminology lives in reference data
 * (see `reference.ts`) and is referenced by code.
 */

/* ── people and access ────────────────────────────────────────────────── */

export type Role = 'TECHNICIAN' | 'GEOLOGIST' | 'SENIOR_GEOLOGIST' | 'ADMIN';

export interface User {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  role: Role;
  department?: string | null;
  active: boolean;
}

/* ── confidence (§19) ─────────────────────────────────────────────────── */

/**
 * Observation confidence and interpretation confidence use the same scale but
 * are never stored in the same field — see `Interpretation`.
 */
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export const CONFIDENCE_VALUES: readonly Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];

/* ── measurement provenance (§15) ─────────────────────────────────────── */

/**
 * A device-compass reading and a hand-held-compass reading are not
 * interchangeable, and neither is survey-grade. Every orientation records how
 * it was obtained.
 */
export type MeasurementSource = 'SENSOR' | 'MANUAL';

export type LocationMethod =
  | 'SURVEY_STATION'
  | 'TAPE_FROM_PEG'
  | 'GPS'
  | 'ESTIMATED';

/* ── lifecycle ────────────────────────────────────────────────────────── */

export type RecordStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'CLARIFICATION_REQUESTED'
  | 'VALIDATED'
  | 'REJECTED';

export type ReviewStatus =
  | 'ACCEPTED'
  | 'CLARIFICATION_REQUESTED'
  | 'REJECTED'
  | 'VALIDATED';

export type HazardStatus = 'OPEN' | 'ACKNOWLEDGED' | 'UNDER_REVIEW' | 'CLOSED';

export type SampleStatus =
  | 'COLLECTED'
  | 'SUBMITTED_TO_LAB'
  | 'RESULTS_RECEIVED'
  | 'CANCELLED';

/* ── entities the sync protocol and audit trail address polymorphically ── */

export type EntityType =
  | 'FACE_LOG'
  | 'OBSERVATION'
  | 'REEF_OBSERVATION'
  | 'STRUCTURE'
  | 'OFFSET'
  | 'SAMPLE'
  | 'HAZARD'
  | 'PHOTO';

export const ENTITY_TYPES: readonly EntityType[] = [
  'FACE_LOG',
  'OBSERVATION',
  'REEF_OBSERVATION',
  'STRUCTURE',
  'OFFSET',
  'SAMPLE',
  'HAZARD',
  'PHOTO',
];

/* ── device-authored record envelope (§30) ────────────────────────────── */

export type SyncState =
  | 'DRAFT'
  | 'LOCAL_SAVED'
  | 'PENDING_SYNC'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'
  | 'REQUIRES_REVIEW';

/**
 * Every record a device can author carries this envelope. `localId` is minted
 * on the device, never reused, and acts as the idempotency key at ingest — so
 * replaying a batch cannot duplicate a geological observation.
 */
export interface SyncEnvelope {
  localId: string;
  serverId?: string | null;
  deviceId: string;
  version: number;
  syncState: SyncState;
  createdAt: string;
  updatedAt: string;
  syncError?: string | null;
  syncAttempts?: number;
}

/** Mine-specific fields configured without a schema migration (§39). */
export type ExtraFields = Record<string, unknown>;

/* ── mine hierarchy ───────────────────────────────────────────────────── */

export interface Workplace {
  id: string;
  mineCode: string;
  levelCode: string;
  sectionCode: string;
  code: string;
  name: string;
  workplaceType: string;
  panel?: string | null;
  drive?: string | null;
  stope?: string | null;
  face?: string | null;
  active: boolean;
}

/* ── orientation ──────────────────────────────────────────────────────── */

export interface Orientation {
  strike?: number | null;
  dip?: number | null;
  dipDirection?: number | null;
  measurementSource?: MeasurementSource | null;
}

/* ── capture records ──────────────────────────────────────────────────── */

export interface FaceLog extends SyncEnvelope {
  recordId: string;
  workplaceId: string;
  technicianId: string;
  shiftDate: string;
  shift: string;
  startTime?: string | null;
  endTime?: string | null;

  /** Underground, the survey reference is primary — GPS is not assumed (§7). */
  surveyReference?: string | null;
  chainage?: number | null;
  faceAdvance?: number | null;
  easting?: number | null;
  northing?: number | null;
  elevation?: number | null;
  coordinateSystem?: string | null;
  locationMethod?: LocationMethod | null;
  locationConfidence?: Confidence | null;

  status: RecordStatus;
  dataQuality?: number | null;
  notes?: string | null;
  submittedAt?: string | null;
  extra?: ExtraFields;
}

export interface Observation extends SyncEnvelope {
  recordId: string;
  faceLogLocalId: string;
  observationType: string;
  description?: string | null;
  materialCode?: string | null;
  contactTypeCode?: string | null;
  width?: number | null;
  persistence?: number | null;
  relationToReef?: string | null;
  strike?: number | null;
  dip?: number | null;
  dipDirection?: number | null;
  measurementSource?: MeasurementSource | null;
  confidence?: Confidence | null;
  observedById: string;
  observedAt: string;
  extra?: ExtraFields;
}

export interface ReefObservation extends SyncEnvelope {
  faceLogLocalId: string;
  reefNameCode?: string | null;
  reefPosition?: string | null;
  reefWidth?: number | null;
  hwLithologyCode?: string | null;
  fwLithologyCode?: string | null;
  contactQualityCode?: string | null;
  chromititeNotes?: string | null;
  internalPartings?: string | null;
  wasteInclusions?: string | null;
  visibleMineralisation?: string | null;
  confidence?: Confidence | null;
  extra?: ExtraFields;
}

export interface Structure extends SyncEnvelope {
  observationLocalId: string;
  structureType: string;
  strike?: number | null;
  dip?: number | null;
  dipDirection?: number | null;
  width?: number | null;
  persistence?: number | null;
  spacing?: number | null;
  aperture?: number | null;
  conditionCode?: string | null;
  infillCode?: string | null;
  intensity?: string | null;
  compositionCode?: string | null;
  relationToReef?: string | null;
  measurementSource?: MeasurementSource | null;
  sensorAccuracy?: number | null;
  confidence?: Confidence | null;
  /** Stable identifier when the structure is correlated across faces (§23). */
  structureRef?: string | null;
  extra?: ExtraFields;
}

export type LateralSense = 'LEFT' | 'RIGHT';
export type VerticalSense = 'UP' | 'DOWN';

/**
 * The observed block is written once by the technician and is immutable after
 * submission. The interpreted block is maintained by geologists and is a cache
 * of the newest matching row in `Interpretation` — it never replaces the
 * observed values (§13).
 */
export interface GeologicalOffset extends SyncEnvelope {
  recordId: string;
  structureLocalId: string;

  markerType: string;
  markerRef?: string | null;

  apparentOffset: number;
  unit: string;
  offsetDirection?: string | null;
  lateralSense?: LateralSense | null;
  verticalSense?: VerticalSense | null;
  strike?: number | null;
  dip?: number | null;
  dipDirection?: number | null;
  throwObserved?: number | null;
  heaveObserved?: number | null;
  measurementMethod?: string | null;
  measurementSource?: MeasurementSource | null;
  confidence?: Confidence | null;
  observedById: string;
  observedAt: string;

  interpretedThrow?: number | null;
  interpretedHeave?: number | null;
  interpretedById?: string | null;
  interpretationConfidence?: Confidence | null;
  interpretedAt?: string | null;

  extra?: ExtraFields;
}

export interface Sample extends SyncEnvelope {
  faceLogLocalId: string;
  sampleNumber: string;
  sampleType: string;
  materialCode?: string | null;
  fromPosition?: number | null;
  toPosition?: number | null;
  length?: number | null;
  reefClassification?: string | null;
  collectedAt: string;
  collectedById: string;
  containerRef?: string | null;
  barcode?: string | null;
  status: SampleStatus;
  extra?: ExtraFields;
}

export interface Hazard extends SyncEnvelope {
  recordId: string;
  faceLogLocalId: string;
  observationLocalId?: string | null;
  hazardType: string;
  severity: string;
  description: string;
  action?: string | null;
  notifiedPerson?: string | null;
  status: HazardStatus;
  raisedById: string;
  raisedAt: string;
  closedAt?: string | null;
  extra?: ExtraFields;
}

/* ── photographs and face mapping (§8, §9) ────────────────────────────── */

export type AnnotationKind =
  | 'POINT'
  | 'LINE'
  | 'POLYGON'
  | 'ARROW'
  | 'TEXT'
  | 'MEASUREMENT';

export interface PhotoAnnotation {
  id: string;
  kind: AnnotationKind;
  /** Normalised 0..1 coordinates so annotations survive resize and re-crop. */
  points: Array<{ x: number; y: number }>;
  featureCode?: string | null;
  label?: string | null;
  observationLocalId?: string | null;
  confidence?: Confidence | null;
  colour?: string | null;
}

export interface Photo extends SyncEnvelope {
  faceLogLocalId: string;
  observationLocalId?: string | null;
  offsetLocalId?: string | null;
  storageKey?: string | null;
  mimeType: string;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
  capturedAt: string;
  capturedById: string;
  caption?: string | null;
  annotations?: PhotoAnnotation[];
  metadata?: ExtraFields;
}

/* ── interpretation, review, audit (§13, §20, §21) ────────────────────── */

export interface Interpretation {
  id: string;
  entityType: EntityType;
  entityId: string;
  field: string;
  value: unknown;
  confidence: Confidence;
  comment?: string | null;
  interpretedById: string;
  interpretedAt: string;
  supersededById?: string | null;
}

export interface Review {
  id: string;
  entityType: EntityType;
  entityId: string;
  reviewerId: string;
  status: ReviewStatus;
  comment?: string | null;
  reviewedAt: string;
}

export interface AuditEntry {
  id: string;
  userId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  deviceId?: string | null;
  syncBatchId?: string | null;
  ipAddress?: string | null;
  timestamp: string;
}
