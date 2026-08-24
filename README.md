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
cp apps/api/.env.example apps/api/.env

npm run db:up        # postgres + minio via docker compose
npm run db:push      # apply the Prisma schema
npm run db:seed      # reference data + demo users

npm run dev:api        # http://localhost:4000
npm run dev:field      # http://localhost:5173   technician PWA
npm run dev:dashboard  # http://localhost:5174   geologist dashboard
```

```bash
npm test         # full test suite
npm run build    # build all workspaces
```

## Design principles

1. **Local-first.** The device is the system of record until sync. No save waits on a network.
2. **Observation ≠ interpretation.** Both are kept, forever, side by side. Neither overwrites the other.
3. **Nothing mine-specific is hard-coded.** Terminology and validation rules are configuration.
4. **Minimal typing.** Pickers, chips and a numeric keypad. Typing underground is a failure mode.
5. **Append, never overwrite.** Corrections create versions; the audit log has no delete route.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.
