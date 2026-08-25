# Unki GeoTech — User Flows (Stage 4)

Underground time is the scarcest resource in this system. Every flow below is
measured against one question: **how many taps from "standing at the face" to
"observation captured and safe"?**

---

## Flow 1 — Technician: record an offset (the critical path, §12)

Target: **under 90 seconds**, gloves on, one hand.

```
HOME  ──tap──>  📐 RECORD OFFSET
   │
   1. WHERE      workplace pre-filled from the active face log
   │             (or last used) · confirm or change          [1 tap]
   │
   2. STRUCTURE  Fault · Dyke · Shear · Other                [1 tap]
   │
   3. MARKER     Reef · Reef contact · Geological contact ·
   │             Dyke · Other                                [1 tap]
   │
   4. MEASURE    apparent offset      → numeric keypad
   │             direction / sense    → L|R and U|D chips
   │             strike / dip / dip-dir → keypad or 📱 sensor
   │             throw / heave        → optional
   │
   5. CONFIDENCE HIGH · MEDIUM · LOW                         [1 tap]
   │
   6. PHOTO      camera opens directly; strongly encouraged,
   │             warning (not a block) if skipped
   │
   7. DIAGRAM    auto-generated section is shown for confirmation:
   │
   │                ── REEF ──┐
   │                          ┊ F  ↕ 2.5 m  (down to the right)
   │                          └── REEF ──
   │
   └── SAVE ──>  stored locally, queued for sync, home screen returns
                 with "8 records waiting to sync"
```

The diagram is generated from the recorded values, not drawn by the technician. It
exists so an error of *sense* — offset recorded down when the reef steps up — is
visible before the technician leaves the face, when it is still cheap to fix.

---

## Flow 2 — Technician: new face log (§7, §34)

Progressive disclosure, seven short steps rather than one long form:

| Step | Question | Input style |
| --- | --- | --- |
| 1 | Where are you? | Hierarchy pickers, defaulted to last workplace |
| 2 | Shift details | Auto: date, shift, technician, start time |
| 3 | Location | Survey station + tape distance; easting/northing optional |
| 4 | Photograph the face | Camera, multiple shots, rotate/crop/annotate |
| 5 | What did you observe? | Reef / structure / ground condition chips |
| 6 | Measurements | Keypad; sensor capture where available |
| 7 | Review & save | Data-quality score, validation warnings, save |

Anything the system can already know — technician, shift, date, workplace, previous
survey reference, coordinate system — is filled in and shown for confirmation, never
asked (§2). The face log ID (`UNK-FL-2026-000124`) is minted on the device at step 1
so a photograph taken at step 4 already has something to belong to.

---

## Flow 3 — Sync (§5, §30)

```
capture ──> LOCAL_SAVED ──submit──> PENDING_SYNC
                                        │  connectivity detected
                                        ▼
                                     SYNCING ──ok──> SYNCED
                                        │
                                        ├── network/server error ──> SYNC_FAILED
                                        │        exponential backoff, retries,
                                        │        data retained indefinitely
                                        │
                                        └── version conflict ──> REQUIRES_REVIEW
                                                 both versions preserved,
                                                 resolved by an authorized user
```

The technician's only obligation is to be within coverage at some point. No action,
no button, no decision. The sync indicator is always visible in the header and
states plainly what is outstanding.

---

## Flow 4 — Geologist: review (§20)

```
Dashboard ──> Pending review queue (oldest first, hazards pinned to top)
    │
    ├── open record → observed values, photographs, generated diagram,
    │                 data-quality score, technician's confidence
    │
    ├── ADD INTERPRETATION  → interpreted throw / heave + confidence + comment
    │                         (written alongside, never over, the observation)
    │
    └── decide → ACCEPT · REQUEST CLARIFICATION · REJECT · MARK VALIDATED
                 every decision writes a review row and an audit entry
```

Requesting clarification notifies the technician and returns the record to their
queue **without unmaking the original observation** — they add a response, not a
rewrite.

---

## Flow 5 — Geologist: structure history (§23)

Select a structure (e.g. `F-012`) → every observation of it across levels, dates and
technicians, listed and plotted:

```
FAULT F-012          apparent offset by level
  Level A  2.1 m  ▓▓▓▓▓▓▓▓▓▓░░░░
  Level B  2.3 m  ▓▓▓▓▓▓▓▓▓▓▓░░░
  Level C  2.5 m  ▓▓▓▓▓▓▓▓▓▓▓▓░░
  Level D  2.4 m  ▓▓▓▓▓▓▓▓▓▓▓▓░░
```

Each row opens the full record: photographs, orientation, technician's observation
and any geologist interpretation, side by side.

---

## Flow 6 — Administrator: configure terminology (§38, §39)

Admin → Reference data → pick a list (e.g. `structure_type`) → add / rename /
deactivate items. Deactivation hides an item from new capture but leaves historical
records readable — a term that was correct in 2024 stays resolvable in 2030.

Changes propagate to devices at the next reference-data refresh; a device that has
not refreshed keeps working from its cached copy.

---

## Permission boundaries enforced at every flow

| Action | Technician | Geologist | Senior / Admin |
| --- | --- | --- | --- |
| Create face log / observation / offset | ✓ | ✓ | ✓ |
| Edit own **draft** | ✓ | ✓ | ✓ |
| Edit own **submitted** observation | ✗ (clarification only) | ✗ | ✗ |
| Write interpretation | ✗ | ✓ | ✓ |
| Accept / reject / validate | ✗ | ✓ | ✓ |
| Resolve sync conflict | ✗ | ✓ | ✓ |
| Manage reference data / users / rules | ✗ | ✗ | ✓ |
| Read audit log | own records | ✓ | ✓ |
| Modify or delete audit log | ✗ | ✗ | ✗ |
