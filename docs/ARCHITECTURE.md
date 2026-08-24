# Unki GeoTech — Architecture

> **Status:** design baseline for v1 (MVP per spec §43).
> **Scope note:** this is an internal geological data-capture tool. It is **not** an
> official Unki Mine system, and it does not replace mine safety, ground-control,
> survey, sampling or hazard-reporting procedures (spec §50).

---

## 1. Requirements analysis (Stage 1)

The problem is not "build forms". It is: **a geological observation made at a
face underground must survive the trip to surface without losing meaning,
provenance or measurement fidelity.** Everything below follows from that.

Four constraints dominate every design decision:

| Constraint | Consequence |
| --- | --- |
| **No connectivity underground** | The device is the system of record until sync. The server is a replica that arrives late. Nothing in the capture path may await a network call. |
| **Gloves, dust, cap-lamp light, time pressure** | Large targets, numeric keypads, quick-select chips, progressive disclosure. Typing is a failure mode. |
| **Observation ≠ interpretation** | Two separate value spaces that must never collide. A technician's measured 2.5 m and a geologist's interpreted 2.1 m both remain true, forever, side by side. |
| **Geological traceability** | Every value answers who/when/where/how-measured/how-confident, and every change is appended, never overwritten. |

### Non-goals for v1

3D geological modelling (§25), AI classification (§36/§37), external mine-system
integration (§44 v7). The schema and API are shaped so these can be added without
migration pain, but none are built now.

---

## 2. System shape

```
   UNDERGROUND                          SURFACE / NETWORK
 ┌───────────────────┐              ┌──────────────────────────┐
 │  apps/field       │              │  apps/api  (Fastify)     │
 │  Technician PWA   │              │  ┌────────────────────┐  │
 │                   │   sync       │  │ auth / RBAC        │  │
 │  ┌─────────────┐  │  batches     │  │ sync + conflicts   │  │
 │  │ Dexie       │──┼─────────────>│  │ validation (server)│  │
 │  │ IndexedDB   │  │  (queued,    │  │ review workflow    │  │
 │  │ + blob store│<─┼───resumable) │  │ audit trail        │  │
 │  └─────────────┘  │              │  │ reports / search   │  │
 │  service worker   │              │  └─────────┬──────────┘  │
 └───────────────────┘              └────────────┼─────────────┘
                                                 │
        ┌────────────────────────────────────────┼──────────────┐
        │                                        │              │
  ┌─────▼──────┐                        ┌────────▼───────┐  ┌───▼─────────┐
  │ PostgreSQL │                        │ Object storage │  │ apps/       │
  │ (+PostGIS  │                        │ (S3/MinIO)     │  │ dashboard   │
  │  ready)    │                        │ face photos    │  │ Geologist   │
  └────────────┘                        └────────────────┘  └─────────────┘

              packages/core — domain model, validation engine,
              data-quality scoring, offset geometry, sync protocol.
              Imported by field, dashboard AND api, so a rule cannot
              drift between the device and the server.
```

### Why one shared domain package

A validation rule that lives only on the device is unenforceable; a rule that
lives only on the server rejects work the technician already walked away from.
`packages/core` is pure TypeScript with no runtime dependencies, so the *same*
rule object evaluates on the device (instantly, offline) and again on ingest
(authoritatively). Divergence becomes impossible rather than merely discouraged.

---

## 3. Modules

| Workspace | Responsibility |
| --- | --- |
| `packages/core` | Domain types, configurable reference data contracts, record-ID minting, validation engine, confidence model, data-quality score, offset geometry + diagram model, sync protocol types. Zero dependencies, fully unit-tested. |
| `apps/api` | Fastify + Prisma. Authentication, authorization, sync ingest with conflict detection, review workflow, versioning, immutable audit log, reference-data administration, reports, search. |
| `apps/field` | React + Vite PWA. Offline-first capture for technicians. Dexie/IndexedDB local database, background sync queue, camera, sensors, face annotation. Mobile/tablet-first, dark high-contrast. |
| `apps/dashboard` | React + Vite. Geologist and administrator surface: review queues, observed-vs-interpreted, structure history, map view, reports, audit, admin configuration. Information-dense, desktop-first. |
| `prototypes/` | Earlier standalone explorations kept for reference (BMSZ face-measurement module). Not wired into the build. |

### Technology choices (§47)

- **TypeScript everywhere.** One domain vocabulary across device, server and dashboard.
- **React + Vite** for both front ends — fast cold start, small bundles, mature PWA tooling.
- **Dexie (IndexedDB)** on the device: transactional, blob-capable, survives app kill and reboot.
- **Fastify + Prisma + PostgreSQL** on the server: strong typing end-to-end, straightforward migrations, PostGIS available when the map/3D work (§24/§25) needs real geometry.
- **S3-compatible object storage** for photographs — never in the relational database.
- No framework lock-in on the sync path: it is plain HTTP + JSON batches, so a future
  native Android client can implement the identical protocol.

---

## 4. Offline-first model (§5)

The device holds a complete, writable copy of everything a technician needs for a
shift: their profile, the workplace hierarchy, and all reference lists. This is
cached at login-on-surface and refreshed opportunistically.

Every locally created record carries:

```
localId      UUID minted on device, permanent, never reused
serverId     assigned at first successful sync
deviceId     which device authored it
version      monotonically increasing per local mutation
syncState    DRAFT → LOCAL_SAVED → PENDING_SYNC → SYNCING → SYNCED
                                              ↘ SYNC_FAILED → (retry)
                                              ↘ REQUIRES_REVIEW (conflict)
createdAt / updatedAt   device clock, plus server receipt time on ingest
```

**Writes are local-first and synchronous.** The UI never shows a spinner for a save.
The sync queue is a separate, resumable process:

1. Records enter the queue on submit (photos queue separately, largest last).
2. On connectivity, batches upload oldest-first with exponential backoff.
3. `localId` is the **idempotency key** — replaying a batch cannot duplicate a record.
4. Failures never discard local data. The record returns to `SYNC_FAILED` and retries.
5. A server-side conflict marks the record `REQUIRES_REVIEW` and surfaces both
   versions to an authorized user. Nothing is silently overwritten (§30).

The technician always sees plain-language state, e.g. `OFFLINE — 7 records waiting to sync`,
and errors are actionable: *"Saved locally. Synchronisation will retry when a connection is
available."* — never *"Something went wrong."* (§42).

---

## 5. Data integrity: observed vs interpreted (§13)

This is the rule the schema is built around.

- Observation fields are written **once** by the technician and are immutable after
  submission. A correction is a new version with a reason, not an edit in place.
- Interpretations live in a separate `Interpretation` table keyed by
  `(entityType, entityId, field)`, each carrying interpreter, timestamp, value,
  confidence and comment.
- The current interpretation is additionally denormalised onto the record
  (e.g. `offsets.interpretedThrow`) for query speed, but the `Interpretation`
  rows remain the source of truth and full history.
- Confidence is recorded twice and separately: **observation confidence** (how
  sure was the technician of what they saw and measured) and **interpretation
  confidence** (how sure is the geologist of what it means).

Technicians cannot write interpretations. Geologists cannot rewrite observations.
Both are enforced server-side, not merely hidden in the UI.

---

## 6. Security (§31)

- Argon2id password hashing; short-lived access JWTs with rotating refresh tokens.
- **Offline authentication:** a device holds a sealed, expiring offline session grant
  (default 16 h, configurable to mine IT policy) that permits capture but never
  privileged operations. No password or long-lived secret is stored on the device.
- Authorization is enforced in the API layer on every route, keyed to role —
  the client's menus are a convenience, not a control.
- TLS in transit; local IndexedDB holds operational data only.
- The audit log is append-only and has no update or delete route at any role.

---

## 7. Configurability (§38/§39)

No mine-specific geological term is hard-coded. Structure types, reef names,
lithologies, sample types, hazard types, confidence labels, units, measurement
conventions and validation rules all live in `ref_lists` / `ref_items` and
`validation_rules`, administered from the dashboard and cached to devices.

Records reference reference data **by code**, and each record also stores an
`extra` JSON column for mine-specific fields added without a migration. Seeded
values are neutral placeholders, explicitly **not** official Unki geological codes —
authorized mine personnel enter the approved values.

---

## 8. Build and release

- `npm install` at the root installs all workspaces.
- `npm run db:up && npm run db:push && npm run db:seed` prepares a local database.
- `npm run dev:api`, `npm run dev:field`, `npm run dev:dashboard` run the three services.
- `npm test` runs the full suite (see `docs/TESTING.md`, spec §49).
