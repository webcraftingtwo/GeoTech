# Unki GeoTech

**Digital underground geological mapping, offset recording and field data management.**

A digital geological field book for underground platinum mining. Geological
technicians capture face observations, structures, offsets, reef data, samples and
hazards at the workplace — offline, with gloves on, under cap-lamp light — and the
records synchronise to a central geological database where geologists review,
interpret and report on them.

> **Not an official mine system.** This is a geological information and data-capture
> tool. It does not replace mine safety procedures, ground-control procedures, survey
> standards, geological standards, sampling protocols, formal hazard reporting or
> competent-person interpretation. Seeded geological terminology is placeholder
> development data, **not** official Unki geological codes — authorized mine personnel
> configure the approved values before any production use.

---

## Repository layout

```
packages/core       shared domain model, validation engine, sync protocol  (no deps)
apps/api            Fastify + Prisma + PostgreSQL — auth, sync, review, audit
apps/field          technician PWA — offline-first capture (React + Vite + Dexie)
apps/dashboard      geologist dashboard — review, history, reports, admin
docs/               architecture, data model, user flows, testing
prototypes/         earlier standalone explorations (not part of the build)
```

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then set DATABASE_URL and JWT_SECRET

npm run db:up        # postgres + minio via docker compose
npm run db:push      # apply the Prisma schema
npm run db:seed      # reference data + demo users
npm run db:seed:demo # optional: a shift of demo geology, pushed through the real sync endpoint

npm run dev:api        # http://localhost:4000
npm run dev:field      # http://localhost:5173   technician PWA
npm run dev:dashboard  # http://localhost:5174   geologist dashboard
```

Development sign-in after seeding: `T001` (technician), `G001` (geologist),
`S001` (senior geologist), `A001` (administrator), password `ChangeMe123`. All
four are created with `mustChangePassword` set so they cannot quietly survive
into a real deployment.

Without Docker, any local PostgreSQL 16 works — point `DATABASE_URL` at it and
run `npm run db:push`.

### Standalone build — two files, no server

```bash
npm run build:standalone
# apps/field/dist-standalone/index.html      technician application
# apps/dashboard/dist-standalone/index.html  geologist application
```

Self-contained HTML that runs with no API and no database: the technician
captures a shift on the device and exports a hand-over file; the geologist
opens it, reviews and interprets. Suitable for a pilot or a site with no
network — **not** for a permanent geological record, because without a server
there is no verified sign-in, no enforced roles and no central audit trail.
The trade-offs are set out in full in [`docs/STANDALONE.md`](docs/STANDALONE.md).

```bash
npm test         # 130 tests; the API suite needs a database (see docs/TESTING.md)
npm run build    # build all workspaces
npm run typecheck
```

**Verifying offline behaviour** needs the built bundle rather than the dev
server, because the dev server has no service worker:

```bash
npm run build -w @geotech/field
npm run preview -w @geotech/field   # http://localhost:4173
```

## Design principles

1. **Local-first.** The device is the system of record until sync. No save waits on a network.
2. **Observation ≠ interpretation.** Both are kept, forever, side by side. Neither overwrites the other.
3. **Nothing mine-specific is hard-coded.** Terminology and validation rules are configuration.
4. **Minimal typing.** Pickers, chips and a numeric keypad. Typing underground is a failure mode.
5. **Append, never overwrite.** Corrections create versions; the audit log has no delete route.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design,
[`docs/STANDALONE.md`](docs/STANDALONE.md) for the server-free deployment,
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) for the schema rationale,
[`docs/USER-FLOWS.md`](docs/USER-FLOWS.md) for the workflows, and
[`docs/TESTING.md`](docs/TESTING.md) for what is and is not tested.

---

## What is built, and what is not

This is the **first MVP** as scoped in the specification (§43). Being explicit
about the boundary matters more than the feature count.

**Built and verified**

| Area | State |
| --- | --- |
| Offline capture, device-restart survival, automatic resync | Working, verified in a browser against the built bundle |
| Face logs, observations, reef detail, structures, offsets, samples, hazards | Working |
| Offset workflow with generated section and derived throw/heave | Working |
| Sync protocol: idempotency, batch replay, dependency ordering, conflicts | Working, integration-tested |
| Shared validation and data-quality scoring on device and server | Working, unit-tested |
| Observed vs interpreted separation, with full interpretation history | Working, tested end to end |
| Review workflow, versioning, notifications | Working |
| Append-only audit trail with no mutation route at any role | Working, tested |
| Role-based access, offline capture grant, session rotation | Working, tested |
| Geologist dashboard: queue, detail, structure history, search, reports, admin | Working |
| Reports as JSON and CSV | Working |
| Photograph capture, compression, upload, integrity hashing | Working |
| Device compass capture, tagged `SENSOR` and never survey-grade | Implemented; graceful-degradation path verified, reading path needs real hardware |

**Deliberately not built in this version**

| Area | Why |
| --- | --- |
| Digital face mapping — drawing over the photograph (§9) | Roadmap v2. The data model, annotation storage and API endpoint exist; the drawing surface does not. |
| Mine map / spatial view (§24) | Roadmap v3. The schema carries coordinates and PostGIS is available. |
| 3D geological visualisation (§25) | Roadmap v5, explicitly excluded from the first release. |
| AI assistance of any kind (§36, §37) | Roadmap v6, explicitly excluded. No AI touches geological data here. |
| Native PDF and XLSX generation (§26) | CSV opens in Excel; the dashboard prints to PDF from the browser. A server-side renderer is straightforward to add. |
| Barcode / QR scanning for samples (§16) | The field carries the value; the scanner does not. |
| External mine-system integration (§44 v7) | Out of scope for v1. |
| Usability testing with real technicians (§49) | **A precondition for deployment.** Not something that can be done from a keyboard. |

Before any production use, authorized mine personnel must replace the seeded
placeholder terminology with the mine-approved geological lists, conventions and
validation rules through the administration panel.
