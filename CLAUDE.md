# Unki GeoTech — working notes

## Git

**Merge to `main` when work is finished.** The owner has asked for this as a
standing instruction: develop on the feature branch, then merge it into `main`
and push, without waiting to be asked each time and without opening a pull
request. Run the tests, the typecheck and the build on the merged tree before
pushing — `main` is what the mine gets, so it does not get a broken tree.

## The mine

Working places are named the way Unki names them: **section and bord**,
"14 South bord 5". There is no level in the hierarchy. Sections currently
seeded are 11 to 14, North and South, bords 1 to 9 plus a strike belt — a
starting list, not the mine's establishment. Survey holds the authoritative
list; importing it in Settings replaces everything and is never overwritten by
an application update.

The geological standard is **UNKI-MIN-MRM-STD-201, "BMSZ Marking & Face
Measurements" v2.0**. Where the Chief Geologist has ruled against the standard,
the ruling wins and the code says which is which.

## Offsets — the thing the application exists for

- **Centimetres everywhere.** Metres only where a figure leaves geology for
  management, converted at that boundary and nowhere else.
- **BMSZ is the datum at zero.** Hangingwall positive, footwall negative. A
  positive footwall is refused, never silently corrected — the mining height is
  a subtraction, so a flipped sign shortens it instead of adding to it.
- **The traverse is fixed**, not configurable: 1 m stations, first 1 m from the
  sidewall, no station zero, `face length − 1` offsets. The 2 m and 5 m offsets
  are mandatory before a face can be saved.
- **Applied limits are snapshotted onto each record.** A later revision must
  never reinterpret a face that was already signed.
- **The server recomputes every aggregate at ingest.** A breach count is a
  compliance figure and is not taken on the word of a handset.

## Deployment

Two products from one source: the networked pair (API + PWA + dashboard) and
`npm run build:standalone`, which produces two self-contained HTML files that
run off the filesystem with no server. The standalone build must stay genuinely
self-contained — no request for a file that does not travel with it.

## Open questions for the mine

These are recorded rather than guessed at:

- **Waste tonnage.** `V = face length × mining height × ?`, then × 3.21 (S.G.).
  The third term is unconfirmed, so the calculation is not built.
- **Design cut.** Read as H/W +60 cm, F/W −140 cm for North, unconfirmed. It is
  an optional pair of fields rather than a rule.
- **Reference terminology.** Reef names, structure types and the rest are
  seeded placeholders, flagged as such in `packages/core/src/reference.ts`.
  They are not official Unki codes and must be replaced before production use.
