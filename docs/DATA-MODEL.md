# Unki GeoTech — Data Model (Stage 3)

Normalized PostgreSQL schema. Authoritative definition lives in
`apps/api/prisma/schema.prisma`; this document explains *why* it is shaped this way.

---

## Design rules

1. **Reference data is data, not code.** Anything a mine might name differently
   (`ref_lists` / `ref_items`) is looked up by code, never enumerated in the schema.
2. **Records are append-only in spirit.** Observation values are versioned via
   `record_versions`; corrections create versions, they do not overwrite.
3. **Observed and interpreted values never share a column.**
4. **Every table that a device can author** carries `localId`, `deviceId`,
   `version`, `syncState` — the sync protocol is part of the model, not bolted on.
5. **`extra JSONB` on every capture table** absorbs mine-specific fields without migration.

---

## Entity map

```
users ──< devices
  │
  └──< face_logs >── workplaces >── sections >── mines
         │  │
         │  ├──< observations ──< structures ──< offsets ──< interpretations
         │  │         │                                │
         │  │         ├──< hazards                     └──< photos
         │  │         └──< photos
         │  ├──< reef_observations
         │  ├──< samples
         │  └──< photos
         │
         └──< reviews, record_versions, audit_logs (polymorphic by entity/entityId)

ref_lists ──< ref_items          validation_rules          sync_batches ──< sync_operations
```

---

## Core tables

### `users`
`id · employeeNo · name · email · passwordHash · role · department · active · createdAt`

`role ∈ TECHNICIAN | GEOLOGIST | SENIOR_GEOLOGIST | ADMIN` (§3). Deactivation is a
flag, never a delete — historical observations must keep a resolvable author.

### Mine hierarchy — `mines` / `sections` / `workplaces`

**There is no level.** Unki organises underground work by **section** —
UNKI-MIN-MRM-STD-201 §3.0 defines a section as "an area of responsibility
allocated to a specific person" — and a section contains numbered **bords**:
section `12S` ("12 South"), bords 1 to 9, plus a strike belt.

`workplaces` carries `code · name · workplaceType · bord · strikeBelt · drive ·
stope · face · active`, where `workplaceType ∈ bord | strike_belt | end | raise
| decline | ledging` by reference code, configurable per mine.

"Half level" appears in the standard (§9.1: a technician covers "two half
levels consisting of 6 bords and one strike belt") but describes a technician's
beat, not a place a face belongs to, so it is not part of the hierarchy.

Technicians select section then bord; they never type a workplace name.

### `face_logs`
```
id · recordId (UNK-FL-2026-000124) · workplaceId · technicianId
shiftDate · shift · startTime · endTime
surveyReference · chainage · faceAdvance
easting · northing · elevation · coordinateSystem · locationMethod · locationConfidence
status · dataQuality · submittedAt
localId · deviceId · version · syncState · createdAt · updatedAt · extra
```
`locationMethod` distinguishes `survey_station | tape_from_peg | gps | estimated` —
underground, the survey reference is primary and GPS is not assumed to exist (§7).
`status ∈ DRAFT | SUBMITTED | UNDER_REVIEW | CLARIFICATION_REQUESTED | VALIDATED | REJECTED`.

### `observations`
```
id · recordId · faceLogId · observationType(code) · description
materialCode · contactTypeCode · width · persistence · relationToReef
strike · dip · dipDirection            ← general orientation, if taken
confidence · observedById · observedAt · extra + sync columns
```

### `reef_observations`
Dedicated reef workflow (§11), one per face log or per reef intersection:
`reefNameCode · reefPosition · reefWidth · hwLithologyCode · fwLithologyCode ·
contactQualityCode · chromititeNotes · internalPartings · wasteInclusions ·
visibleMineralisation · confidence`.

### `structures`
```
id · observationId · structureType(code)
strike · dip · dipDirection · width · persistence · spacing · aperture
conditionCode · infillCode · intensity · compositionCode · relationToReef
measurementSource (SENSOR | MANUAL) · sensorAccuracy · confidence
```
`measurementSource` is mandatory (§15): a device-compass reading and a hand-held
compass reading are not interchangeable, and neither is presented as survey-grade.

### `offsets`  ← the module the product exists for (§12)
```
OBSERVED (technician, immutable)
  structureId · markerType(code) · markerRef
  apparentOffset · unit · offsetDirection
  lateralSense (LEFT|RIGHT) · verticalSense (UP|DOWN)
  strike · dip · dipDirection · throwObserved · heaveObserved
  measurementMethod · confidence · observedById · observedAt

INTERPRETED (geologist, additive)
  interpretedThrow · interpretedHeave · interpretedById
  interpretationConfidence · interpretedAt
```
Both blocks persist. The interpreted block is a cache of the newest matching row in
`interpretations`; overwriting the observed block is impossible through any route.

### `interpretations` (§13)
`id · entityType · entityId · field · value(JSONB) · confidence · comment ·
interpretedById · interpretedAt · supersededById`

Polymorphic and append-only. Superseding an interpretation links the rows rather
than deleting the old one.

### `photos` (§8)
`id · faceLogId · observationId? · offsetId? · storageKey · thumbnailKey · mimeType ·
bytes · width · height · sha256 · capturedAt · capturedById · metadata(JSONB) · annotations(JSONB)`

Binary lives in object storage. `sha256` gives duplicate detection and integrity
proof. `annotations` holds the digital face-mapping vector layer (§9) so the original
photograph is never altered.

### `samples` (§16)
`sampleNumber` is **globally unique** — the constraint is in the database, and the
device additionally checks its local set before accepting, so a duplicate is caught
underground rather than at sync.

### `hazards` (§17)
`hazardType · severity · description · action · notifiedPerson · status ·
raisedById · raisedAt · closedAt`, `status ∈ OPEN | ACKNOWLEDGED | UNDER_REVIEW | CLOSED`.
Complements — never replaces — the mine's formal safety reporting system.

### `reviews` (§20)
`entityType · entityId · reviewerId · status · comment · reviewedAt`
`status ∈ ACCEPTED | CLARIFICATION_REQUESTED | REJECTED | VALIDATED`.

### `record_versions`
Full JSONB snapshot per version of any record, with author and timestamp. Restores
"what did this look like when the geologist accepted it" without event-sourcing the
whole system.

### `audit_logs` (§21)
`userId · entity · entityId · action · oldValue · newValue · deviceId · syncBatchId ·
ipAddress · timestamp`. Append-only: no update/delete route exists at any role.

### Sync — `devices`, `sync_batches`, `sync_operations` (§30)
`sync_operations` records `localId · entityType · op · payload · clientVersion ·
serverVersion · status · conflict(JSONB)`. `localId` is the idempotency key.
Conflicts are stored, not resolved automatically.

### Configuration — `ref_lists`, `ref_items`, `validation_rules` (§38)
`ref_items`: `listCode · code · label · sortOrder · active · meta(JSONB)`.
`validation_rules`: `entity · field · ruleType · params(JSONB) · severity(ERROR|WARNING) · active`.
Both are cached to devices and evaluated by the shared engine in `packages/core`.

---

## Seeded reference lists

`observation_type · structure_type · reef_name · lithology · contact_type ·
contact_quality · sample_type · hazard_type · confidence · unit · offset_direction ·
marker_type · surface_condition · infill · ground_condition · workplace_type ·
shift · coordinate_system · location_method`

> Seed values are **neutral placeholders for development only**. They are not
> official Unki geological codes. Authorized mine personnel must enter the
> mine-approved terminology through the administration panel before any production use.
