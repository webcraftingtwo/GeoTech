import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { scoreRecord, validateFaceLog } from '@geotech/core';
import { IconHazard, IconObservation, IconOffset, IconPhoto, IconSample } from '../components/Icons.js';
import { Header, Screen, SyncBar } from '../components/Layout.js';
import { QualityMeter } from '../components/Quality.js';
import { db } from '../db/database.js';
import {
  buildShiftExport,
  collectOutstanding,
  downloadFile,
  exportPhotographs,
  markHandedOver,
} from '../db/handover.js';
import { loadFaceLogPackage, submitFaceLog } from '../db/repository.js';
import { IS_STANDALONE } from '../deployment.js';
import { syncEngine } from '../sync/engine.js';
import { useApp } from '../state/app.js';

/* ── one face log and everything captured against it ──────────────────── */

export function FaceLogScreen({ localId }: { localId: string }) {
  const { reference, pop, push, showToast } = useApp();
  const pkg = useLiveQuery(() => loadFaceLogPackage(localId), [localId]);

  if (!pkg?.faceLog) {
    return (
      <>
        <Header title="Face log" onBack={pop} />
        <Screen>
          <div className="card">This face log is no longer on this device.</div>
        </Screen>
      </>
    );
  }

  const { faceLog, observations, structures, offsets, samples, hazards, photos } = pkg;
  const editable = faceLog.status === 'DRAFT';

  const validation = validateFaceLog(faceLog, {
    convention: reference.convention,
    lists: reference.lists,
    rules: reference.rules,
    hasPhoto: photos.length > 0,
    hasObservation: observations.length > 0,
  });

  const quality = scoreRecord({
    hasLocation: Boolean(faceLog.surveyReference) || (faceLog.easting != null && faceLog.northing != null),
    hasPhoto: photos.length > 0,
    structurePresent: structures.length > 0,
    structureClassified: structures.every((s) => Boolean(s.structureType)),
    orientationRecorded: structures.every((s) => s.strike != null && s.dip != null && s.dipDirection != null),
    offsetPresent: offsets.length > 0,
    offsetRecorded: offsets.every((o) => o.apparentOffset != null),
    observationConfidence: observations[0]?.confidence ?? null,
    requiredFieldsComplete: validation.ok,
    hasObservation: observations.length > 0,
  });

  const submit = async () => {
    await submitFaceLog(localId);
    void syncEngine.syncNow();
    showToast('Queued to sync. It stays on this device until the server confirms it.');
  };

  return (
    <>
      <Header title={faceLog.recordId} subtitle={faceLog.status} onBack={pop} />
      <Screen>
        <SyncBar />

        <div className="card stack">
          <QualityMeter score={quality} />
          <div className="row small muted">
            <span>{faceLog.surveyReference ?? 'No survey reference'}</span>
            <div className="spacer" />
            <span className="state-badge" data-state={faceLog.syncState}>
              {faceLog.syncState.replace('_', ' ')}
            </span>
          </div>
          {faceLog.syncError && (
            <div className="issue" data-severity="ERROR">
              <span className="issue-tag">FIX</span>
              <span>{faceLog.syncError}</span>
            </div>
          )}
        </div>

        {editable && (
          <div className="grid-2">
            <button className="btn" onClick={() => push({ name: 'offset', faceLogLocalId: localId })}>
              <IconOffset size={20} /> Offset
            </button>
            <button className="btn" onClick={() => push({ name: 'observation', faceLogLocalId: localId })}>
              <IconObservation size={20} /> Observation
            </button>
            <button className="btn" onClick={() => push({ name: 'photo', faceLogLocalId: localId })}>
              <IconPhoto size={20} /> Photo
            </button>
            <button className="btn" onClick={() => push({ name: 'sample', faceLogLocalId: localId })}>
              <IconSample size={20} /> Sample
            </button>
            <button className="btn btn-danger" style={{ gridColumn: '1 / -1' }} onClick={() => push({ name: 'hazard', faceLogLocalId: localId })}>
              <IconHazard size={20} /> Hazard
            </button>
          </div>
        )}

        <Section title="Observations" count={observations.length}>
          {observations.map((o) => (
            <div key={o.localId} className="record-row">
              <div style={{ flex: 1 }}>
                <div>{o.observationType}</div>
                <div className="rec-id">{o.recordId}</div>
              </div>
              <span className="small muted">{o.confidence ?? '—'}</span>
            </div>
          ))}
        </Section>

        <Section title="Offsets" count={offsets.length}>
          {offsets.map((o) => (
            <div key={o.localId} className="record-row">
              <div style={{ flex: 1 }}>
                <div className="value">
                  {o.apparentOffset} {o.unit.toLowerCase()}
                </div>
                <div className="rec-id">{o.recordId}</div>
              </div>
              <span className="small muted">
                {o.verticalSense ?? ''} {o.lateralSense ?? ''}
              </span>
            </div>
          ))}
        </Section>

        <Section title="Samples" count={samples.length}>
          {samples.map((s) => (
            <div key={s.localId} className="record-row">
              <div style={{ flex: 1 }}>
                <div className="value">{s.sampleNumber}</div>
                <div className="rec-id">{s.sampleType}</div>
              </div>
              <span className="small muted">{s.length != null ? `${s.length.toFixed(2)} m` : ''}</span>
            </div>
          ))}
        </Section>

        <Section title="Hazards" count={hazards.length}>
          {hazards.map((h) => (
            <div key={h.localId} className="record-row">
              <div style={{ flex: 1 }}>
                <div>{h.hazardType}</div>
                <div className="rec-id">{h.recordId}</div>
              </div>
              <span className="state-badge" data-state="SYNC_FAILED">{h.severity}</span>
            </div>
          ))}
        </Section>

        <Section title="Photographs" count={photos.length}>
          <div className="small muted">{photos.length} held on this device.</div>
        </Section>
      </Screen>

      {editable && (
        <div className="action-bar">
          <button className="btn btn-primary btn-block btn-lg" onClick={() => void submit()} disabled={!validation.ok}>
            SUBMIT & QUEUE FOR SYNC
          </button>
        </div>
      )}
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">
        {title} ({count})
      </span>
      {children}
    </div>
  );
}

/* ── my logs ──────────────────────────────────────────────────────────── */

export function MyLogsScreen() {
  const { pop, push } = useApp();
  const logs = useLiveQuery(() => db.faceLogs.reverse().sortBy('createdAt'), [], []);

  return (
    <>
      <Header title="My logs" onBack={pop} />
      <Screen>
        {logs.length === 0 && <div className="card muted">No face logs on this device yet.</div>}
        {logs.map((log) => (
          <button key={log.localId} className="record-row" onClick={() => push({ name: 'faceLog', localId: log.localId })}>
            <div style={{ flex: 1 }}>
              <div>{log.recordId}</div>
              <div className="rec-id">
                {log.shiftDate.slice(0, 10)} · {log.surveyReference ?? 'no reference'}
              </div>
            </div>
            <span className="state-badge" data-state={log.syncState}>
              {log.status === 'DRAFT' ? 'DRAFT' : log.syncState.replace('_', ' ')}
            </span>
          </button>
        ))}
      </Screen>
    </>
  );
}

/* ── sync queue (§5) ──────────────────────────────────────────────────── */

export function PendingSyncScreen() {
  const { pop, showToast, sync } = useApp();
  const items = useLiveQuery(() => db.queue.toArray(), [], []);

  return (
    <>
      <Header title="Sync queue" onBack={pop} />
      <Screen>
        <SyncBar />

        {items.length === 0 && (
          <div className="card">
            <strong>Everything has synced.</strong>
            <div className="small muted">Nothing is waiting on this device.</div>
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className="card stack" style={{ gap: 8 }}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div>{item.entityType.replace('_', ' ')}</div>
                <div className="rec-id">queued {new Date(item.queuedAt).toLocaleString()}</div>
              </div>
              <span className="state-badge" data-state={item.blocked ? 'SYNC_FAILED' : 'PENDING_SYNC'}>
                {item.blocked ? 'NEEDS YOU' : item.attempts > 0 ? `RETRY ${item.attempts}` : 'WAITING'}
              </span>
            </div>
            {item.lastError && (
              <div className="issue" data-severity={item.blocked ? 'ERROR' : 'WARNING'}>
                <span className="issue-tag">{item.blocked ? 'FIX' : 'CHECK'}</span>
                <span>{item.lastError}</span>
              </div>
            )}
            {item.blocked && (
              <button
                className="btn"
                onClick={async () => {
                  await syncEngine.retryBlocked(item.localId);
                  showToast('Retrying now.');
                }}
              >
                Try again
              </button>
            )}
          </div>
        ))}
      </Screen>

      <div className="action-bar">
        <button
          className="btn btn-primary btn-block btn-lg"
          onClick={() => {
            void syncEngine.syncNow();
            showToast(sync.online ? 'Syncing now…' : 'No connection yet. Records stay safe on this device.');
          }}
        >
          SYNC NOW
        </button>
      </div>
    </>
  );
}

/* ── settings ─────────────────────────────────────────────────────────── */

export function SettingsScreen() {
  const { session, theme, contrast, setTheme, setContrast, reference, refreshReference, signOut, showToast, pop, storage } =
    useApp();
  const referenceInput = useRef<HTMLInputElement>(null);

  return (
    <>
      <Header title="Settings" onBack={pop} />
      <Screen>
        <div className="card stack">
          <div>
            <span className="label">Signed in as</span>
            <div className="value">{session?.name}</div>
            <div className="small muted">
              {session?.employeeNo} · {session?.role.replace('_', ' ').toLowerCase()}
            </div>
          </div>
          <div>
            <span className="label">Deployment</span>
            <div className="small">
              {IS_STANDALONE
                ? 'Standalone — this device only, no server'
                : 'Networked — synchronises to the geology database'}
            </div>
          </div>
          {storage?.usable && !storage.persisted && (
            <div className="small muted">
              The browser has not granted persistent storage. Records are kept, but a device very low on space could
              evict them — hand over each shift rather than accumulating several.
            </div>
          )}
          {session?.offlineGrantExpiresAt && (
            <div className="small muted">
              Offline capture allowed until {new Date(session.offlineGrantExpiresAt).toLocaleString()}. Sign in on
              surface to extend it.
            </div>
          )}
        </div>

        <div className="card stack">
          <span className="label">Display</span>
          <div className="row-wrap">
            <button className="chip" aria-pressed={theme === 'dark'} onClick={() => void setTheme('dark')}>Dark</button>
            <button className="chip" aria-pressed={theme === 'light'} onClick={() => void setTheme('light')}>Light</button>
          </div>
          <div className="row-wrap">
            <button className="chip" aria-pressed={contrast === 'normal'} onClick={() => void setContrast('normal')}>Normal contrast</button>
            <button className="chip" aria-pressed={contrast === 'high'} onClick={() => void setContrast('high')}>High contrast</button>
          </div>
        </div>

        <div className="card stack">
          <span className="label">Reference data</span>
          <div className="small muted">
            {reference.fetchedAt
              ? `Last updated ${new Date(reference.fetchedAt).toLocaleString()} · ${reference.workplaces.length} workplaces`
              : IS_STANDALONE
                ? 'Using the built-in example data.'
                : 'Not yet downloaded — connect once on surface.'}
          </div>

          {IS_STANDALONE ? (
            <>
              <input
                ref={referenceInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const { importReference } = await import('../standalone.js');
                    const result = await importReference(JSON.parse(await file.text()));
                    showToast(result.message, result.ok ? 'normal' : 'danger');
                    if (result.ok) window.location.reload();
                  } catch {
                    showToast('That file could not be read as reference data.', 'danger');
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              <button className="btn" onClick={() => referenceInput.current?.click()}>
                Load the mine's reference file
              </button>
              <div className="small muted">
                The built-in geological terms and workplaces are neutral examples, not Unki terminology. Load the
                mine-approved file before this device is used for real work.
              </div>
            </>
          ) : (
            <button
              className="btn"
              onClick={async () => {
                try {
                  await refreshReference();
                  showToast('Reference data updated.');
                } catch {
                  showToast('No connection. The cached reference data is still in use.', 'danger');
                }
              }}
            >
              Update now
            </button>
          )}
        </div>

        <button
          className="btn btn-danger btn-block"
          onClick={async () => {
            try {
              await signOut();
            } catch (err) {
              showToast((err as Error).message, 'danger');
            }
          }}
        >
          Sign out
        </button>

        <p className="small muted">
          A geological information and data-capture tool. It does not replace mine safety procedures, ground-control
          procedures, survey standards, sampling protocols, formal hazard reporting or competent-person interpretation.
        </p>
      </Screen>
    </>
  );
}

/* ── on-device search (§6, §27) ───────────────────────────────────────── */

/**
 * Searches what is on this device, not the server.
 *
 * A technician underground asking "did I already log this face?" cannot reach
 * the server, and the answer they need is about their own records anyway. The
 * screen says plainly which records it can see, so an empty result is never
 * mistaken for "no such record exists".
 */
export function SearchScreen() {
  const { pop, push } = useApp();
  const [query, setQuery] = useState('');

  const term = query.trim().toUpperCase();

  const results = useLiveQuery(async () => {
    if (term.length < 2) return { logs: [], offsets: [], samples: [] };
    const [logs, offsets, samples] = await Promise.all([
      db.faceLogs.toArray(),
      db.offsets.toArray(),
      db.samples.toArray(),
    ]);
    const matches = (...fields: (string | null | undefined)[]) =>
      fields.some((f) => f && f.toUpperCase().includes(term));
    return {
      logs: logs.filter((l) => matches(l.recordId, l.surveyReference, l.notes, l.shift)),
      offsets: offsets.filter((o) => matches(o.recordId, o.markerRef, o.markerType, String(o.apparentOffset))),
      samples: samples.filter((s) => matches(s.sampleNumber, s.containerRef, s.barcode)),
    };
  }, [term], { logs: [], offsets: [], samples: [] });

  const total = results.logs.length + results.offsets.length + results.samples.length;

  return (
    <>
      <Header title="Search" onBack={pop} />
      <Screen>
        <input
          className="input input-mono"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Record ID, survey peg, sample number"
          autoCapitalize="characters"
        />
        <span className="small muted">
          Searches records held on this device. Records already synced and cleared from the device are found on the
          geology dashboard.
        </span>

        {term.length >= 2 && total === 0 && <div className="card muted">Nothing on this device matches “{query}”.</div>}

        {results.logs.map((log) => (
          <button key={log.localId} className="record-row" onClick={() => push({ name: 'faceLog', localId: log.localId })}>
            <div style={{ flex: 1 }}>
              <div>{log.recordId}</div>
              <div className="rec-id">{log.surveyReference ?? 'no reference'}</div>
            </div>
            <span className="state-badge" data-state={log.syncState}>
              FACE LOG
            </span>
          </button>
        ))}

        {results.offsets.map((offset) => (
          <div key={offset.localId} className="record-row">
            <div style={{ flex: 1 }}>
              <div className="value">
                {offset.apparentOffset} {offset.unit.toLowerCase()}
              </div>
              <div className="rec-id">{offset.recordId}</div>
            </div>
            <span className="state-badge" data-state={offset.syncState}>
              OFFSET
            </span>
          </div>
        ))}

        {results.samples.map((sample) => (
          <div key={sample.localId} className="record-row">
            <div style={{ flex: 1 }}>
              <div className="value">{sample.sampleNumber}</div>
              <div className="rec-id">{sample.sampleType}</div>
            </div>
            <span className="state-badge" data-state={sample.syncState}>
              SAMPLE
            </span>
          </div>
        ))}
      </Screen>
    </>
  );
}

/* ── shift hand-over (standalone deployment) ──────────────────────────── */

/**
 * Exporting a shift when there is no server.
 *
 * The same promise as synchronisation governs this screen: records are not
 * marked as handed over until the file has actually been written. If the
 * export fails, or the technician cancels the save, everything stays on the
 * device exactly as it was.
 */
export function HandoverScreen() {
  const { session, pop, showToast } = useApp();
  const [held, setHeld] = useState<number | null>(null);
  const [photos, setPhotos] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState<{ filename: string; checksum: string; count: number } | null>(null);

  const refresh = useCallback(async () => {
    const records = await collectOutstanding();
    setHeld(Object.values(records).reduce((total, list) => total + list.length, 0));
    setPhotos(records.photos.length);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const exportShift = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const records = await collectOutstanding();
      const result = await buildShiftExport(session);
      downloadFile(result.filename, result.json);

      // Only now, with the file written, are the records marked as handed over.
      await markHandedOver(records);
      setLastExport({
        filename: result.filename,
        checksum: result.checksum,
        count: Object.values(result.counts).reduce((a, b) => a + b, 0),
      });
      showToast('Shift file saved. The records stay on this device as well.');
      await refresh();
    } catch (err) {
      showToast(`Export failed: ${(err as Error).message} Nothing has been marked as handed over.`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title="Hand over shift" onBack={pop} />
      <Screen>
        <div className="card stack">
          <span className="label">Held on this device</span>
          <div className="value-lg">{held ?? '—'}</div>
          <div className="small muted">
            {held === 0
              ? 'Everything captured on this device has been handed over.'
              : 'Records captured but not yet given to the geologist.'}
          </div>
        </div>

        <button className="btn btn-primary btn-block btn-lg" onClick={() => void exportShift()} disabled={busy || held === 0}>
          {busy ? 'Writing file…' : 'EXPORT SHIFT FILE'}
        </button>

        {photos > 0 && (
          <button
            className="btn btn-block"
            onClick={async () => {
              const written = await exportPhotographs();
              showToast(`${written} photograph${written === 1 ? '' : 's'} saved.`);
            }}
          >
            Export {photos} photograph{photos === 1 ? '' : 's'} separately
          </button>
        )}

        {lastExport && (
          <div className="card stack" style={{ gap: 8 }}>
            <span className="label">Last export</span>
            <div className="small">{lastExport.filename}</div>
            <div className="small muted">{lastExport.count} records</div>
            <span className="label" style={{ marginTop: 4 }}>Checksum</span>
            <div className="small muted" style={{ wordBreak: 'break-all', fontFamily: 'var(--mono)' }}>
              {lastExport.checksum}
            </div>
            <div className="small muted">
              The geologist's dashboard checks this when the file is opened. A file that fails the check has been
              damaged in transfer and should be exported again.
            </div>
          </div>
        )}

        <div className="card small muted">
          <strong style={{ color: 'var(--text)' }}>Nothing is deleted by exporting.</strong> The records stay on this
          device after the file is written, so a lost file is never a lost observation. Hand the file to the geologist
          by whatever means the mine already uses for shift paperwork.
        </div>
      </Screen>
    </>
  );
}
