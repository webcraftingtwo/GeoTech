import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PLACEHOLDER_REFERENCE_DATA,
  buildOffsetDiagram,
  labelFor,
  summariseFaceMeasurement,
  type Confidence,
  type GeologicalOffset,
  type StoredFaceMeasurement,
} from '@geotech/core';
import {
  Empty,
  FaceSectionChart,
  OffsetDiagram,
  Panel,
  Pill,
  ProvenancePair,
  fmtDate,
  fmtDateTime,
} from '../components/ui.js';
import {
  addInterpretation,
  addReview,
  clearAll,
  currentInterpretation,
  download,
  faceMeasurementRows,
  faceMeasurementsFor,
  getState,
  interpretationsFor,
  latestReview,
  offsetRows,
  openFile,
  persistenceWorking,
  restore,
  reviewedBundle,
  reviewsFor,
  sampleRows,
  setReviewer,
  subscribe,
  toCsv,
  type OpenResult,
} from './store.js';

/**
 * The geologist's side of a standalone deployment.
 *
 * Reads the hand-over files a device exports, and provides the part of the
 * review workflow that does not require a server: observed values displayed
 * beside interpreted ones, interpretation history, review decisions, and
 * export.
 *
 * What it deliberately does not pretend to have is stated on screen rather
 * than left for someone to discover: no server-side authorisation, and an
 * audit trail confined to this machine.
 */

type View = 'files' | 'offsets' | 'logs' | 'widths' | 'structures' | 'export';

export function StandaloneApp() {
  const [, force] = useState(0);
  const [view, setView] = useState<View>('files');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    restore();
    force((n) => n + 1);
    return subscribe(() => force((n) => n + 1));
  }, []);

  const state = getState();
  const loaded = state.files.length > 0;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">UNKI GEOTECH</div>
        <div className="brand-name">Geology — standalone</div>

        <NavItem label="Shift files" count={state.files.length} active={view === 'files'} onClick={() => setView('files')} />
        <NavItem label="Offsets" count={state.records.offsets.length} active={view === 'offsets'} onClick={() => setView('offsets')} disabled={!loaded} />
        <NavItem label="Face logs" count={state.records.faceLogs.length} active={view === 'logs'} onClick={() => setView('logs')} disabled={!loaded} />
        <NavItem
          label="Width control"
          count={state.records.faceMeasurements.length}
          active={view === 'widths'}
          onClick={() => setView('widths')}
          disabled={!loaded}
        />
        <NavItem label="Structures" active={view === 'structures'} onClick={() => setView('structures')} disabled={!loaded} />
        <NavItem label="Export" active={view === 'export'} onClick={() => setView('export')} disabled={!loaded} />

        <div style={{ flex: 1 }} />

        <label style={{ padding: '10px 12px' }}>
          <span className="label">Reviewing as</span>
          <input
            className="input"
            value={state.reviewer}
            placeholder="Your name"
            onChange={(e) => setReviewer(e.target.value)}
          />
          <span className="small muted" style={{ display: 'block', marginTop: 6 }}>
            Recorded against every interpretation you make.
          </span>
        </label>

        <p className="small muted" style={{ padding: '10px 12px', margin: 0, lineHeight: 1.45 }}>
          Standalone: this machine only. No server-side authorisation, and the audit trail is not central.
          Interpretation remains subject to competent-person review under the mine approved procedures.
        </p>
      </nav>

      <main className="main">
        {!persistenceWorking() && (
          <div className="banner" style={{ marginBottom: 16 }}>
            This browser is not saving your work locally. Everything below is held in memory only and will be lost if
            you reload — export before you close this tab.
          </div>
        )}

        {view === 'files' && <FilesView />}
        {view === 'offsets' && <OffsetsView selected={selected} onSelect={setSelected} />}
        {view === 'logs' && <LogsView />}
        {view === 'widths' && <WidthsView />}
        {view === 'structures' && <StructuresView onOpenOffset={(id) => { setSelected(id); setView('offsets'); }} />}
        {view === 'export' && <ExportView />}
      </main>
    </div>
  );
}

function NavItem({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="nav-item" aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick}>
      {label}
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </button>
  );
}

/* ── files ───────────────────────────────────────────────────────────── */

function FilesView() {
  const input = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<OpenResult[]>([]);
  const state = getState();

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    const outcomes: OpenResult[] = [];
    for (const file of Array.from(files)) {
      outcomes.push(await openFile(file.name, await file.text()));
    }
    setResults(outcomes);
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <h1 className="page-title">Shift files</h1>
      <p className="page-sub">
        Open the files exported from the technicians' devices. Each is checked against the checksum written when it
        was exported before any of its records are shown.
      </p>

      <input ref={input} type="file" accept="application/json,.json" multiple hidden onChange={(e) => void handle(e.target.files)} />

      <div className="row" style={{ marginBottom: 18 }}>
        <button className="btn btn-primary" onClick={() => input.current?.click()}>
          Open shift files
        </button>
        {state.files.length > 0 && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('Remove all loaded records and interpretations from this machine?')) clearAll();
            }}
          >
            Clear everything
          </button>
        )}
      </div>

      {results.map((result) => (
        <div key={result.filename + result.problems.join()} className="banner" data-tone={result.ok ? 'ok' : undefined} style={{ marginBottom: 10 }}>
          <strong>{result.filename}</strong>
          {result.ok ? ` — loaded, ${result.added} new records.` : ''}
          {result.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
          {result.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ))}

      <Panel title={`Loaded files (${state.files.length})`}>
        {state.files.length === 0 ? (
          <Empty>No shift files open yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Technician</th>
                <th>Device</th>
                <th>Exported</th>
                <th className="num">Records</th>
                <th>Checksum</th>
              </tr>
            </thead>
            <tbody>
              {state.files.map((file) => (
                <tr key={file.filename + file.exportedAt}>
                  <td className="mono">{file.filename}</td>
                  <td>{file.technician}</td>
                  <td className="mono small">{file.deviceId.slice(0, 14)}</td>
                  <td className="small muted">{fmtDateTime(file.exportedAt)}</td>
                  <td className="num">{Object.values(file.counts).reduce((a, b) => a + b, 0)}</td>
                  <td>{file.checksumVerified ? <Pill status="ACCEPTED" /> : <Pill status="DRAFT" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ── offsets and interpretation ──────────────────────────────────────── */

function OffsetsView({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const state = getState();
  const offset = state.records.offsets.find((o) => o.localId === selected);

  if (offset) return <OffsetDetail offset={offset} onBack={() => onSelect(null)} />;

  return (
    <>
      <h1 className="page-title">Offsets</h1>
      <p className="page-sub">Observed values as captured. Select a record to add or revise an interpretation.</p>

      <Panel title={`Recorded offsets (${state.records.offsets.length})`}>
        {state.records.offsets.length === 0 ? (
          <Empty>No offsets in the loaded files.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Structure</th>
                <th>Reference</th>
                <th className="num">Observed</th>
                <th className="num">Interpreted throw</th>
                <th>Observation confidence</th>
              </tr>
            </thead>
            <tbody>
              {state.records.offsets.map((row) => {
                const structure = state.records.structures.find((s) => s.localId === row.structureLocalId);
                const interpreted = currentInterpretation(row.localId, 'throw');
                return (
                  <tr key={row.localId} data-clickable="true" onClick={() => onSelect(row.localId)}>
                    <td className="mono">{row.recordId}</td>
                    <td>{structure?.structureType ?? '—'}</td>
                    <td className="mono">{structure?.structureRef ?? '—'}</td>
                    <td className="num" style={{ color: 'var(--observed)' }}>
                      {row.apparentOffset} {row.unit.toLowerCase()}
                    </td>
                    <td className="num" style={{ color: 'var(--interpreted)' }}>
                      {interpreted ? `${interpreted.value} m` : '—'}
                    </td>
                    <td>
                      <Pill confidence={row.confidence} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function OffsetDetail({ offset, onBack }: { offset: GeologicalOffset; onBack: () => void }) {
  const state = getState();
  const structure = state.records.structures.find((s) => s.localId === offset.structureLocalId);
  const history = interpretationsFor(offset.localId);
  const throwNow = currentInterpretation(offset.localId, 'throw');

  const [field, setField] = useState<'throw' | 'heave'>('throw');
  const [value, setValue] = useState('');
  const [confidence, setConfidence] = useState<Confidence>('MEDIUM');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      setError('Enter the interpreted value as a number, in metres.');
      return;
    }
    if (Math.abs(numeric) > Math.abs(offset.apparentOffset) + 1e-9) {
      setError(
        `An interpreted ${field} of ${numeric} m is larger than the apparent offset of ${offset.apparentOffset} m measured along the structure. Check which measurement was taken before recording this.`,
      );
      return;
    }
    setError(null);
    addInterpretation({ entityId: offset.localId, field, value: numeric, confidence, comment });
    setValue('');
    setComment('');
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={onBack}>
          &larr; Back to offsets
        </button>
      </div>

      <h1 className="page-title">{offset.recordId}</h1>
      <p className="page-sub">
        {structure?.structureType ?? 'Structure'}
        {structure?.structureRef ? ` · ${structure.structureRef}` : ''} · recorded {fmtDateTime(offset.observedAt)}
      </p>

      <div style={{ marginBottom: 20 }}>
        <ProvenancePair
          observedLabel="Apparent offset measured at the face"
          observedValue={`${offset.apparentOffset} ${offset.unit.toLowerCase()}`}
          observedMeta={
            <>
              Confidence <Pill confidence={offset.confidence} /> · {offset.measurementMethod ?? 'method not recorded'} ·{' '}
              {offset.measurementSource ?? 'source not recorded'}
            </>
          }
          interpretedLabel="Throw"
          interpretedValue={throwNow ? `${throwNow.value} m` : null}
          interpretedMeta={
            throwNow ? (
              <>
                Confidence <Pill confidence={throwNow.confidence} /> · {throwNow.interpretedBy} ·{' '}
                {fmtDateTime(throwNow.interpretedAt)}
              </>
            ) : null
          }
        />
      </div>

      <Panel title="Generated section">
        <div className="panel-body">
          <OffsetDiagram
            input={{
              apparentOffset: offset.apparentOffset,
              unit: offset.unit.toLowerCase(),
              markerLabel: offset.markerType,
              structureLabel: structure?.structureType ?? 'Structure',
              verticalSense: offset.verticalSense ?? null,
              lateralSense: offset.lateralSense ?? null,
            }}
          />
        </div>
      </Panel>

      <Panel title="Interpretation history">
        {history.length === 0 ? (
          <Empty>No interpretation recorded against this observation.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th className="num">Value</th>
                <th>Confidence</th>
                <th>Interpreter</th>
                <th>Comment</th>
                <th>Recorded</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{row.field}</td>
                  <td className="num" style={{ color: 'var(--interpreted)' }}>
                    {row.value}
                  </td>
                  <td>
                    <Pill confidence={row.confidence} />
                  </td>
                  <td>{row.interpretedBy}</td>
                  <td>{row.comment || '—'}</td>
                  <td className="small muted">{fmtDateTime(row.interpretedAt)}</td>
                  <td className="small muted">{row.supersededById ? 'superseded' : 'current'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Add interpretation">
        <div className="panel-body stack">
          <div className="row">
            <label style={{ width: 140 }}>
              <span className="label">Field</span>
              <select className="select" value={field} onChange={(e) => setField(e.target.value as 'throw' | 'heave')}>
                <option value="throw">Throw</option>
                <option value="heave">Heave</option>
              </select>
            </label>
            <label style={{ width: 140 }}>
              <span className="label">Value (m)</span>
              <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <label style={{ width: 170 }}>
              <span className="label">Interpretation confidence</span>
              <select className="select" value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
                <option>HIGH</option>
                <option>MEDIUM</option>
                <option>LOW</option>
              </select>
            </label>
          </div>
          <label>
            <span className="label">Reasoning</span>
            <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {error && <div className="banner">{error}</div>}
          <div className="row">
            <button className="btn btn-primary" disabled={!value} onClick={submit}>
              Record interpretation
            </button>
            <span className="small muted">
              Written alongside the technician's measurement of {offset.apparentOffset} {offset.unit.toLowerCase()},
              which is not altered.
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}

/* ── face logs and review ────────────────────────────────────────────── */

function LogsView() {
  const state = getState();
  const [open, setOpen] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const log = state.records.faceLogs.find((l) => l.localId === open);

  const decide = (status: 'ACCEPTED' | 'CLARIFICATION_REQUESTED' | 'REJECTED' | 'VALIDATED') => {
    if (!log) return;
    if (status !== 'ACCEPTED' && !comment.trim()) {
      setError('Add a comment explaining the decision — it is the only record of why.');
      return;
    }
    setError(null);
    addReview({ entityId: log.localId, status, comment: comment.trim() });
    setComment('');
  };

  if (log) {
    const observations = state.records.observations.filter((o) => o.faceLogLocalId === log.localId);
    const measurements = faceMeasurementsFor(log.localId);
    const samples = state.records.samples.filter((s) => s.faceLogLocalId === log.localId);
    const hazards = state.records.hazards.filter((h) => h.faceLogLocalId === log.localId);
    const history = reviewsFor(log.localId);

    return (
      <>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn btn-sm" onClick={() => setOpen(null)}>
            &larr; Back to face logs
          </button>
        </div>
        <h1 className="page-title">{log.recordId}</h1>
        <p className="page-sub">
          {log.workplaceId} · {fmtDate(log.shiftDate)} {log.shift} · {log.surveyReference ?? 'no survey reference'}
        </p>

        <Panel title={`Observations (${observations.length})`}>
          {observations.length === 0 ? (
            <Empty>None recorded.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Type</th>
                  <th>Confidence</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o) => (
                  <tr key={o.localId}>
                    <td className="mono">{o.recordId}</td>
                    <td>{o.observationType}</td>
                    <td>
                      <Pill confidence={o.confidence} />
                    </td>
                    <td>{o.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {measurements.length > 0 && (
          <Panel title={`Face measurements \u2014 BMSZ tape offsets (${measurements.length})`}>
            {measurements.map((m) => (
              <FaceMeasurementDetail key={m.localId} measurement={m} />
            ))}
          </Panel>
        )}

        {samples.length > 0 && (
          <Panel title={`Samples (${samples.length})`}>
            <table>
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>Type</th>
                  <th className="num">Length</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.localId}>
                    <td className="mono">{s.sampleNumber}</td>
                    <td>{s.sampleType}</td>
                    <td className="num">{s.length ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {hazards.length > 0 && (
          <Panel title={`Hazards (${hazards.length})`}>
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {hazards.map((h) => (
                  <tr key={h.localId}>
                    <td className="mono">{h.recordId}</td>
                    <td>{h.hazardType}</td>
                    <td>{h.severity}</td>
                    <td>{h.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <Panel title="Review history">
          {history.length === 0 ? (
            <Empty>No decision recorded yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Reviewer</th>
                  <th>Comment</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Pill status={r.status} />
                    </td>
                    <td>{r.reviewer}</td>
                    <td>{r.comment || '—'}</td>
                    <td className="small muted">{fmtDateTime(r.reviewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Decision">
          <div className="panel-body stack">
            <label>
              <span className="label">Comment</span>
              <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            {error && <div className="banner">{error}</div>}
            <div className="row">
              <button className="btn" onClick={() => decide('ACCEPTED')}>Accept</button>
              <button className="btn" onClick={() => decide('CLARIFICATION_REQUESTED')}>Request clarification</button>
              <button className="btn btn-danger" onClick={() => decide('REJECTED')}>Reject</button>
              <div className="spacer" />
              <button className="btn btn-primary" onClick={() => decide('VALIDATED')}>Mark validated</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              A decision does not alter what the technician recorded. Without a server there is no way to notify them
              — a clarification request has to be passed on by the usual means.
            </p>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Face logs</h1>
      <p className="page-sub">Every face log in the loaded shift files.</p>

      <Panel title={`Face logs (${state.records.faceLogs.length})`}>
        {state.records.faceLogs.length === 0 ? (
          <Empty>No face logs in the loaded files.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Workplace</th>
                <th>Shift</th>
                <th>Survey reference</th>
                <th className="num">Observations</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {state.records.faceLogs.map((log) => {
                const review = latestReview(log.localId);
                return (
                  <tr key={log.localId} data-clickable="true" onClick={() => setOpen(log.localId)}>
                    <td className="mono">{log.recordId}</td>
                    <td>{log.workplaceId}</td>
                    <td>
                      {fmtDate(log.shiftDate)} {log.shift}
                    </td>
                    <td className="mono">{log.surveyReference ?? '—'}</td>
                    <td className="num">
                      {state.records.observations.filter((o) => o.faceLogLocalId === log.localId).length}
                    </td>
                    <td>{review ? <Pill status={review.status} /> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ── structure history ──────────────────────────────────────────────── */

function StructuresView({ onOpenOffset }: { onOpenOffset: (id: string) => void }) {
  const state = getState();

  const grouped = useMemo(() => {
    const map = new Map<string, { ref: string; type: string; rows: { offset: GeologicalOffset; workplace: string }[] }>();
    for (const structure of state.records.structures) {
      if (!structure.structureRef) continue;
      const observation = state.records.observations.find((o) => o.localId === structure.observationLocalId);
      const faceLog = observation && state.records.faceLogs.find((l) => l.localId === observation.faceLogLocalId);
      const offsets = state.records.offsets.filter((o) => o.structureLocalId === structure.localId);
      const entry = map.get(structure.structureRef) ?? {
        ref: structure.structureRef,
        type: structure.structureType,
        rows: [],
      };
      for (const offset of offsets) entry.rows.push({ offset, workplace: faceLog?.workplaceId ?? 'unknown' });
      map.set(structure.structureRef, entry);
    }
    return [...map.values()].filter((g) => g.rows.length > 0);
  }, [state.records]);

  return (
    <>
      <h1 className="page-title">Structures</h1>
      <p className="page-sub">
        Structures observed at more than one face, correlated by the reference the technician recorded.
      </p>

      {grouped.length === 0 ? (
        <Panel title="Structures">
          <Empty>
            No structure references in the loaded files. A structure is correlated only when the technician records a
            reference such as F-012 against it.
          </Empty>
        </Panel>
      ) : (
        grouped.map((group) => {
          const max = Math.max(...group.rows.map((r) => r.offset.apparentOffset));
          return (
            <Panel key={group.ref} title={`${group.ref} — ${group.type} · ${group.rows.length} observations`}>
              <div className="panel-body">
                {group.rows.map((row) => (
                  <div key={row.offset.localId} className="hist-row" style={{ cursor: 'pointer' }} onClick={() => onOpenOffset(row.offset.localId)}>
                    <span className="mono">{row.workplace}</span>
                    <span className="num mono" style={{ color: 'var(--observed)' }}>
                      {row.offset.apparentOffset} {row.offset.unit.toLowerCase()}
                    </span>
                    <div className="hist-track">
                      <div className="hist-fill" style={{ width: `${Math.max(3, (row.offset.apparentOffset / max) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          );
        })
      )}
    </>
  );
}

/* ── width control (§9.8) ──────────────────────────────────── */

function FaceMeasurementField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mono" style={{ fontSize: 14 }}>
        {value}
      </div>
    </div>
  );
}

/**
 * One measured face.
 *
 * The limits are shown beside the section rather than left implicit: a bord
 * and a decline are cut to different profiles, and a reading that breaches one
 * is well inside the other. Which set the technician applied underground is
 * part of the reading, not a lookup done at review time — so it is what is
 * displayed, taken from the record itself.
 */
function FaceMeasurementDetail({ measurement }: { measurement: StoredFaceMeasurement }) {
  const summary = summariseFaceMeasurement(measurement);
  // Codes are stored; the geologist reads labels. A mine that has replaced the
  // seeded list falls back to its own code rather than to nothing.
  const reasons = [...new Set(measurement.stations.map((st) => st.reason).filter(Boolean))].map((code) =>
    labelFor(PLACEHOLDER_REFERENCE_DATA, 'face_breach_reason', code),
  );

  return (
    <div className="panel-body stack" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="row">
        <span className="mono">{measurement.recordId}</span>
        <span className="small muted">{fmtDateTime(measurement.measuredAt)}</span>
        <div className="spacer" />
        <span className="small muted">
          {measurement.limits.label} · H/W {measurement.limits.hangingwall.toFixed(2)} · F/W{' '}
          {measurement.limits.footwall.toFixed(2)}
        </span>
      </div>

      <FaceSectionChart measurement={measurement} />

      <div className="row" style={{ gap: 26, flexWrap: 'wrap' }}>
        <FaceMeasurementField
          label="Stations"
          value={`${summary.measured} / ${summary.total} at ${measurement.stationInterval} m`}
        />
        <FaceMeasurementField label="H/W breaches" value={String(summary.hangingwallBreaches)} />
        <FaceMeasurementField label="F/W breaches" value={String(summary.footwallBreaches)} />
        <FaceMeasurementField
          label="Mean over-break"
          value={summary.meanHangingwallOverbreak !== null ? `${summary.meanHangingwallOverbreak.toFixed(2)} m` : '—'}
        />
        <FaceMeasurementField
          label="Mean stope width"
          value={summary.meanStopeWidth !== null ? `${summary.meanStopeWidth.toFixed(2)} m` : '—'}
        />
        <FaceMeasurementField
          label="Range"
          value={
            summary.minStopeWidth !== null
              ? `${summary.minStopeWidth.toFixed(2)}–${summary.maxStopeWidth!.toFixed(2)} m`
              : '—'
          }
        />
        <FaceMeasurementField
          label="Peg to face"
          value={measurement.distanceFromPeg !== null ? `${measurement.distanceFromPeg} m` : '—'}
        />
      </div>

      {summary.breachesWithoutReason > 0 && (
        <div className="banner">
          {summary.breachesWithoutReason} breaching station
          {summary.breachesWithoutReason === 1 ? ' has' : 's have'} no reason recorded. The reading stands as measured;
          the explanation has to be obtained from the technician.
        </div>
      )}

      {reasons.length > 0 && <div className="small muted">Breach reasons: {reasons.join('; ')}</div>}
    </div>
  );
}

/**
 * Width control across every file open on this machine.
 *
 * Ordered worst first. A geologist opening this wants the faces that were cut
 * outside the limits, not a chronological list — the chronology is in the face
 * logs.
 */
function WidthsView() {
  const state = getState();
  const faceLogs = new Map(state.records.faceLogs.map((l) => [l.localId, l]));

  const rows = state.records.faceMeasurements
    .map((measurement) => ({ measurement, summary: summariseFaceMeasurement(measurement) }))
    .sort(
      (a, b) =>
        b.summary.breachingStations - a.summary.breachingStations ||
        b.measurement.measuredAt.localeCompare(a.measurement.measuredAt),
    );

  const breaching = rows.filter((r) => r.summary.breachingStations > 0).length;

  return (
    <>
      <h1 className="page-title">Width control</h1>
      <p className="page-sub">
        Tape offsets from the BMSZ, as measured at the face. {rows.length} face
        {rows.length === 1 ? '' : 's'} measured, {breaching} with at least one station outside the limits it was cut
        to.
      </p>

      <Panel title="Measured faces">
        {rows.length === 0 ? (
          <Empty>No face measurements in the files opened on this machine.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Working place</th>
                <th>Shift</th>
                <th>Limits</th>
                <th className="num">Stations</th>
                <th className="num">H/W</th>
                <th className="num">F/W</th>
                <th className="num">Mean width</th>
                <th className="num">Over-break</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ measurement, summary }) => {
                const log = faceLogs.get(measurement.faceLogLocalId);
                return (
                  <tr key={measurement.localId}>
                    <td className="mono">{measurement.recordId}</td>
                    <td>{log?.workplaceId ?? '—'}</td>
                    <td className="small muted">{fmtDate(log?.shiftDate)}</td>
                    <td className="small">{measurement.limits.code}</td>
                    <td className="num">
                      {summary.measured} / {summary.total}
                    </td>
                    <td className="num" style={summary.hangingwallBreaches > 0 ? { color: 'var(--danger)' } : undefined}>
                      {summary.hangingwallBreaches}
                    </td>
                    <td className="num" style={summary.footwallBreaches > 0 ? { color: 'var(--danger)' } : undefined}>
                      {summary.footwallBreaches}
                    </td>
                    <td className="num">
                      {summary.meanStopeWidth !== null ? `${summary.meanStopeWidth.toFixed(2)} m` : '—'}
                    </td>
                    <td className="num">
                      {summary.meanHangingwallOverbreak !== null
                        ? `${summary.meanHangingwallOverbreak.toFixed(2)} m`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {rows.map(({ measurement }) => (
        <Panel key={measurement.localId} title={`${measurement.recordId} — ${faceLogs.get(measurement.faceLogLocalId)?.workplaceId ?? 'working place unknown'}`}>
          <FaceMeasurementDetail measurement={measurement} />
        </Panel>
      ))}
    </>
  );
}

/* ── export ──────────────────────────────────────────────────────────── */

function ExportView() {
  const state = getState();
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <>
      <h1 className="page-title">Export</h1>
      <p className="page-sub">
        Observed and interpreted values are kept in separate columns, so a report can never present a conclusion as a
        measurement.
      </p>

      <Panel title="Spreadsheets">
        <div className="panel-body row">
          <button
            className="btn"
            onClick={() => download(`geotech-offsets-${stamp}.csv`, toCsv(offsetRows()), 'text/csv')}
            disabled={state.records.offsets.length === 0}
          >
            Offsets CSV ({state.records.offsets.length})
          </button>
          <button
            className="btn"
            onClick={() => download(`geotech-samples-${stamp}.csv`, toCsv(sampleRows()), 'text/csv')}
            disabled={state.records.samples.length === 0}
          >
            Samples CSV ({state.records.samples.length})
          </button>
          <button
            className="btn"
            onClick={() => download(`geotech-width-control-${stamp}.csv`, toCsv(faceMeasurementRows()), 'text/csv')}
            disabled={state.records.faceMeasurements.length === 0}
          >
            Width control CSV ({state.records.faceMeasurements.length})
          </button>
        </div>
      </Panel>

      <Panel title="Full working set">
        <div className="panel-body stack">
          <button className="btn btn-primary" onClick={() => download(`geotech-reviewed-${stamp}.json`, reviewedBundle(), 'application/json')}>
            Export records, interpretations and decisions
          </button>
          <span className="small muted">
            Keeps every captured value exactly as recorded, with your interpretations and review decisions alongside.
            This is the file to retain, and the file to load into the central database if the mine later runs the
            networked deployment.
          </span>
        </div>
      </Panel>

      <Panel title="What this export is not">
        <div className="panel-body small muted">
          Photographs are referenced but not included — they remain on the capturing devices. There is no central
          audit trail behind these files: they record what this machine was given and what was done with it here.
        </div>
      </Panel>
    </>
  );
}
