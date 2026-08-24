# Unki GeoTech — Testing (Stage 15)

The specification's §49 names five things that must be tested. This document
records what is covered, how, and — just as importantly — what is not.

```bash
npm test                       # 115 automated tests
npm run typecheck              # every workspace, strict
npm run build                  # every workspace
```

The API suite needs a PostgreSQL database. It uses `TEST_DATABASE_URL`, or
`postgresql://geotech@127.0.0.1:5432/geotech_test` by default, applies the
schema once per run, and truncates between tests.

---

## Coverage against §49

### Offline (§49.1)

| Requirement | How it is covered |
| --- | --- |
| Device loses connection | Browser-driven: the context is put offline and an `offline` event dispatched |
| Technician creates record | A face log and a 2.5 m offset captured with no network at all |
| Device restarts | Page reloaded while still offline; the service worker serves the shell |
| Record remains available | The record is still listed, and the queue still reports it waiting |

Verified against the **production bundle** served by `vite preview`, not the dev
server — the dev server has no service worker, so an offline reload there fails
for reasons that have nothing to do with the application.

Unit-level cover for the same behaviour lives in `packages/core/test/sync.test.ts`:
the state machine cannot move a record from `DRAFT` straight to `SYNCED`, a
failure returns it to the queue, and `isOutstanding` keeps failed and conflicted
records counted.

### Synchronisation (§49.2)

`apps/api/test/sync.test.ts`, against a real database:

- a face log applies and receives a definitive record identifier
- a provisional identifier minted offline is replaced by the server sequence
- **duplicate prevention** — replaying an operation in a new batch returns
  `DUPLICATE` and creates no second record
- **batch replay** — resending the same `batchId` returns the stored results
  rather than reprocessing, for a device that lost the response
- dependency ordering — a batch queued offset-first still files correctly
- a child whose parent has not arrived is held with an explanation, not dropped
- **failed upload retry** — backoff grows, is capped, and is jittered
  (`packages/core/test/sync.test.ts`)
- **conflict detection** — a stale `baseVersion` yields `CONFLICT`, both
  versions are preserved, and the server value is left untouched
- a duplicate sample number is refused with a message saying what to do

### Geological data (§49.3)

`packages/core/test/validation.test.ts` and `offset.test.ts`:

- measurement validation — a dip of 175° is rejected under the default
  convention and accepted when the mine configures 0–180°
- orientation values — strike/dip-direction cross-checked under the mine's
  right-hand or left-hand rule, and skipped where the rule is `NONE`
- required fields — sample ID, face-log location, offset marker and measurement
- observation confidence — recorded separately from interpretation confidence,
  and its absence warned about while a LOW value is treated as perfectly valid
- **offset calculations** — 2.5 m along a 57° structure resolves to a throw of
  2.1 m and a heave of 1.36 m; a vertical structure puts everything into throw;
  the result is always marked as requiring geological review
- the generated diagram steps the right way for each recorded sense, stays
  inside its frame from 0.05 m to 500 m, and marks itself illustrative when no
  sense was recorded

### Security (§49.4)

`apps/api/test/integrity.test.ts`, end to end through the HTTP layer:

- a technician **cannot** access administration (403)
- a technician **cannot** write an interpretation, and none is created
- a technician **cannot** review records
- a geologist **cannot** manage users or reference data
- a technician sees their own face logs and not another technician's
- a live token for a **deactivated** account stops working immediately
- an **offline capture grant** permits capture but refuses interpretation, on
  the same account that may interpret when signed in normally
- **the audit trail cannot be manipulated**: every mutating method against an
  audit entry returns 404 at every role, and the entry is unchanged afterwards
- `packages/core/test/permissions.test.ts` asserts that *no* role holds
  `observation:edit_submitted` or `audit:modify`

### The integrity rule (§13)

Given its weight in the specification, it is tested on its own:

- an interpreted throw of 2.1 m recorded against an observed 2.5 m leaves the
  observed value, and the technician's confidence, exactly as captured
- a second interpretation supersedes the first by **linking** to it; the earlier
  reading and its author remain readable
- `apparentOffset` is refused as an interpretable field
- the API returns observed and interpreted as separate blocks, never merged
- rejecting a face log does not alter a single observed value

### Usability (§49.5)

**Not covered, and cannot be.** §49 requires testing with actual intended users
on realistic underground workflows before deployment. Browser automation
verifies that a flow *works*; it says nothing about whether it works with gloves
on, under a cap lamp, at the end of a shift. That testing remains outstanding
and is a precondition for deployment, not a nice-to-have.

---

## What the browser verification actually does

Two scripted runs, against the real API and a real database:

1. **Field app** — sign in, capture a face log through the seven steps, record a
   2.5 m offset through the six-step workflow including the numeric keypad, read
   the generated section, go offline, capture more, restart the device, confirm
   nothing is lost, reconnect, watch it sync.
2. **Dashboard** — sign in as a geologist, work the review queue, open a face
   log and an offset, record an interpretation and confirm the observed value is
   untouched, follow one structure across four faces, and run a structured
   search.

Three defects were found this way and fixed: the sync indicator reported
"everything saved" while a record was queued; tapping RECORD OFFSET with no open
face log silently became a different screen; and a missing favicon threw a 404
on every dashboard page load.

These runs are scripted but not yet committed as a CI job — they need a running
API, database and built front end, which is a fixture worth building before this
goes anywhere near production.

---

## Known gaps

- **No end-to-end suite in CI.** The browser runs above are reproducible by
  hand; they are not automated in a pipeline.
- **No load testing.** Sync ingest has not been tested with a shift's worth of
  devices arriving at the shaft at the same moment.
- **Photograph upload is only lightly covered.** The queue and dedup path have
  unit-level cover; a large multi-photo upload over a poor link has not been
  exercised.
- **Sensor capture cannot be tested here.** The graceful degradation path is
  verified (no sensor present); the reading path needs a real device.
