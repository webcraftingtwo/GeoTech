# Standalone deployment

Two self-contained HTML files, no server, no installation:

```bash
npm install
npm run build:standalone

apps/field/dist-standalone/index.html        # technician application
apps/dashboard/dist-standalone/index.html    # geologist application
```

Each file carries its own JavaScript, CSS and icons. Copy them anywhere and
open them in a browser.

---

## How the two halves work together

```
  TECHNICIAN (phone or tablet)              GEOLOGIST (desktop)
  ┌──────────────────────────┐              ┌──────────────────────────┐
  │ field/index.html         │              │ dashboard/index.html     │
  │                          │              │                          │
  │ sign in (name only)      │              │ open shift files         │
  │ capture the shift        │  shift file  │ checksum verified        │
  │ everything held locally  │ ───────────> │ review and interpret     │
  │ export shift file        │   .json      │ export CSV / full set    │
  └──────────────────────────┘              └──────────────────────────┘
```

The hand-over file carries the **same record shapes the sync protocol uses**.
A mine that pilots the standalone pair and later stands up the server can
replay its files through the normal ingest without a conversion step, and
without reinterpreting a single measurement.

---

## Serving the files

**They must be served over http or https — not opened from a file path.**

Browsers deny local storage to pages opened directly from disk, and this
application stores a shift's geology locally. It detects that condition and
refuses to start rather than accepting work into storage that will not keep it.

Any static host will do, and none of them need a build step:

```bash
# On a laptop, to try it
cd apps/field/dist-standalone && python3 -m http.server 8080

# On the mine network
copy index.html to any intranet web share

# For phones and tablets
serve over https — a browser needs it for the camera
```

A phone reaching a plain `http://` address on the mine's own network will
capture and export correctly, but the camera will not open: browsers require a
secure context for it. Use https where photographs matter.

---

## What the standalone deployment does not have

This is the part to read before deciding to use it.

| | Networked | Standalone |
| --- | --- | --- |
| Sign-in | Password, verified by the server | **Name only. Anyone holding the device can record as anyone.** |
| Roles | Enforced server-side on every request | **Not enforced. There is no server to enforce them.** |
| Audit trail | Central, append-only, no delete route at any role | **Local to one machine.** |
| Records reaching the geologist | Automatic, on regaining coverage | **A file someone has to carry.** |
| Duplicate sample numbers | Caught across the whole mine | Caught on the capturing device only |
| Structure history | Across every device and every shift | Only across the files currently open |
| Photographs | Uploaded and stored centrally | Held on the device, exported separately |

What is **not** given up: capture behaves identically, the same validation
rules run, the same data-quality scoring applies, observed and interpreted
values remain separate, and interpretation history is still append-only.

**Use standalone for** a pilot, a trial at one section, a demonstration, or a
site with no network at all.

**Use networked for** a permanent geological record. Provenance that cannot be
verified and an audit trail on one laptop are not adequate for a record the
mine will rely on for years.

---

## First run

The field application ships with **neutral example** geological terms and a
generic workplace list so it is usable immediately. These are not Unki
terminology.

Before real use, load the mine's own reference file:

1. Settings → **Load the mine's reference file**
2. Choose a JSON file containing any of `workplaces`, `referenceLists`,
   `convention`

Anything absent keeps its current value, so a mine can supply only its
workplace list without restating every geological term. A networked
deployment's `/sync/reference` response is accepted as-is, which is the
simplest way to produce one.

---

## Daily use

**Technician**

1. Open the application, enter name and employee number, start the shift
2. Capture face logs, observations, offsets, samples and hazards
3. **Hand over** → *Export shift file* at the end of the shift
4. Send the file to the geologist by whatever means the mine already uses

Exporting never deletes anything. The records stay on the device after the file
is written, so a lost file is never a lost observation.

**Geologist**

1. Open the dashboard, enter your name (it is recorded against your interpretations)
2. **Shift files** → *Open shift files*; several devices can be opened at once
3. Review face logs, add interpretations, record decisions
4. **Export** → CSV for the spreadsheet, or the full working set to retain

Every file is checked against the checksum written when it was exported. A file
that fails is refused with an explanation, not silently partially loaded.

---

## Integrity checks

The hand-over file carries a SHA-256 checksum over a canonical serialisation of
its records — keys sorted at every level, so the same records always produce the
same checksum whatever order they came out of the database in.

The dashboard verifies it before showing a single measurement, and additionally
reports records whose parent is missing rather than letting them disappear from
every view.

Interpretation is bounded by the observation it belongs to: an interpreted
throw larger than the apparent offset measured along the structure is refused,
because it is not geometrically possible.

---

## Storage

Records live in the browser's IndexedDB, which survives closing the tab,
restarting the browser and restarting the device.

It does **not** survive clearing site data, and the browser may evict it under
severe disk pressure. The application requests persistent storage where the
browser offers it, and Settings reports whether that was granted.

The practical rule: **hand over each shift rather than accumulating several.**

The dashboard keeps loaded records and your interpretations in local storage so
a reload does not lose work in progress. It warns if the browser refuses.
