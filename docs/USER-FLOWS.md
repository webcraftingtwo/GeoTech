# Unki GeoTech — User Flows (Stage 4)

Underground time is the scarcest resource in this system. Every flow below is
measured against one question: **how many taps from "standing at the face" to
"observation captured and safe"?**

---

## Flow 1 — Technician: record an offset (the critical path, §12)

Target: **under 90 seconds**, gloves on, one hand.

```
HOME  ──tap──>  RECORD OFFSET
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
   │             strike / dip / dip-dir → keypad or device sensor
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
| 1 | Where are you? | Section then bord, defaulted to last workplace |
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

## Flow 2b — Technician: measure the face (§9.8)

Replaces the paper Face Marking Sheet. Three steps, because a technician
measuring a face is holding a tape and cannot hold a scrolling form.

| Step | Question | Input style |
| --- | --- | --- |
| 1 | Set up the face | Limit set (bord / decline), face width, station interval, first station, distance peg→face |
| 2 | Walk the stations | Numeric keypad, hangingwall then footwall, then straight to the next station |
| 3 | Check and submit | Live section, breach list, reason per breaching station |

Step 1 lays out the stations from the face width. The technician never types a
station distance — they are generated, and the technician walks them.

Two things about that layout are the mine's call, not the application's, and
both are controls on this step. §9.8.iv specifies a **2 m interval**; the sheets
in circulation record at 1 m. §9.8.ii places the first reading **1 m from the
sidewall**; the sheets start at the sidewall and run across (NS3: a 7.2 m face,
stations 0 to 7). Each defaults to the standard, each warns when it is departed
from, and the distances actually used are stored on the record — so a face is
never read back at a spacing it was not measured at, and a sheet already filled
in by hand can be entered exactly as it stands.

Step 2 draws the section as it is measured. Each reading is checked against the
limits the moment it is entered, so a station that is out is red before the
technician has moved on from it, not at the end when they have packed the tape
away.

The applied limits are shown on their own card at step 1 and repeated at step 3.
This is not decoration: a bord and a decline are cut to different profiles, and
the same eight readings are compliant against one and six breaches against the
other. A mis-tap on that control is the single most consequential error
available on this screen, so it is confirmed twice and stored with the record.

**A breach cannot be submitted without a reason.** Not a warning — the save
button does not work. The reason is chosen from a chip list (blast over-break,
ground conditions, BMSZ position uncertain, support installed, geological
structure) and it is asked for **at the station**, the moment the reading
breaches, rather than in a list at the end: standing at station 4 is the only
place the technician can still see why station 4 is out. A face that was cut
outside limits is a fact; why it was is the part that is lost if it is not
written down at the face.

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

Select a structure (e.g. `F-012`) → every observation of it across sections, dates
and technicians, listed and plotted:

```
FAULT F-012          apparent offset by working place
  12S bord 3   2.1 m  ▓▓▓▓▓▓▓▓▓▓░░░░
  12S bord 4   2.3 m  ▓▓▓▓▓▓▓▓▓▓▓░░░
  12S bord 5   2.5 m  ▓▓▓▓▓▓▓▓▓▓▓▓░░
  12N bord 2   2.4 m  ▓▓▓▓▓▓▓▓▓▓▓▓░░
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
