import { useCallback, useEffect, useState } from 'react';
import { PLACEHOLDER_REFERENCE_DATA, labelFor } from '@geotech/core';
import { api, type FaceLogDetail, type FaceLogRow, type HazardRow, type OffsetDetail } from '../api.js';
import { Empty, FaceSectionChart, OffsetDiagram, Panel, Pill, ProvenancePair, fmtDate, fmtDateTime } from '../components/ui.js';

/** The review queue: hazards pinned above, then oldest work first (§20, §22). */
export function ReviewQueueView({ onOpenLog }: { onOpenLog: (id: string) => void }) {
  const [queue, setQueue] = useState<{ openHazards: HazardRow[]; faceLogs: FaceLogRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reviewQueue().then(setQueue).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="banner">{error}</div>;
  if (!queue) return <Empty>Loading…</Empty>;

  return (
    <>
      <h1 className="page-title">Review queue</h1>
      <p className="page-sub">Oldest submissions first. Open hazards are pinned above regardless of age.</p>

      {queue.openHazards.length > 0 && (
        <Panel title={`Open geological hazards (${queue.openHazards.length})`}>
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Workplace</th>
                <th>Description</th>
                <th>Raised</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.openHazards.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.recordId}</td>
                  <td>{h.hazardType}</td>
                  <td>
                    <Pill status={h.severity === 'HIGH' ? 'OPEN' : undefined} confidence={h.severity} />
                  </td>
                  <td>{h.faceLog?.workplace?.code}</td>
                  <td>{h.description}</td>
                  <td className="small muted">{fmtDateTime(h.raisedAt)}</td>
                  <td>
                    <Pill status={h.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title={`Face logs awaiting review (${queue.faceLogs.length})`}>
        {queue.faceLogs.length === 0 ? (
          <Empty>Nothing is waiting for review.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Section / working place</th>
                <th>Technician</th>
                <th>Shift</th>
                <th className="num">Obs</th>
                <th className="num">Photos</th>
                <th className="num">Samples</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.faceLogs.map((log) => (
                <tr key={log.id} data-clickable="true" onClick={() => onOpenLog(log.id)}>
                  <td className="mono">{log.recordId}</td>
                  <td>
                    {log.workplace.section.name} · {log.workplace.code}
                  </td>
                  <td>{log.technician.name}</td>
                  <td>
                    {fmtDate(log.shiftDate)} {log.shift}
                  </td>
                  <td className="num">{log._count?.observations ?? 0}</td>
                  <td className="num">{log._count?.photos ?? 0}</td>
                  <td className="num">{log._count?.samples ?? 0}</td>
                  <td className="small muted">{fmtDateTime(log.submittedAt)}</td>
                  <td>
                    <Pill status={log.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ── one face log ─────────────────────────────────────────────────────── */

export function FaceLogView({ id, onOpenOffset, onBack }: { id: string; onOpenOffset: (id: string) => void; onBack: () => void }) {
  const [log, setLog] = useState<FaceLogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.faceLog(id).then(setLog).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(load, [load]);

  const decide = async (status: string) => {
    if (status !== 'ACCEPTED' && !comment.trim()) {
      setError('Add a comment explaining the decision — the technician needs to know what to do next.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.review('FACE_LOG', id, { status, comment: comment.trim() || undefined });
      setNotice(`Recorded as ${status.replace(/_/g, ' ').toLowerCase()}.`);
      setComment('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !log) return <div className="banner">{error}</div>;
  if (!log) return <Empty>Loading…</Empty>;

  const offsets = log.observations.flatMap((o) => o.structures.flatMap((s) => s.offsets.map((off) => ({ ...off, structure: s }))));

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={onBack}>
          ← Back
        </button>
      </div>
      <h1 className="page-title">{log.recordId}</h1>
      <p className="page-sub">
        {log.workplace.section.name} · {log.workplace.code} · {log.technician.name} · {fmtDate(log.shiftDate)} {log.shift} ·{' '}
        <Pill status={log.status} />
      </p>

      {notice && (
        <div className="banner" data-tone="ok" style={{ marginBottom: 14 }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="banner" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <Panel title="Location and shift">
        <div className="panel-body row" style={{ gap: 28 }}>
          <Field label="Survey reference" value={log.surveyReference ?? '—'} />
          <Field label="Data quality" value={log.dataQuality != null ? `${log.dataQuality}%` : '—'} />
          <Field label="Versions kept" value={String(log.versionCount)} />
          <Field label="Submitted" value={fmtDateTime(log.submittedAt)} />
        </div>
        {log.notes && <div className="panel-body small" style={{ borderTop: '1px solid var(--line)' }}>{log.notes}</div>}
      </Panel>

      {offsets.length > 0 && (
        <Panel title={`Offsets (${offsets.length})`}>
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Structure</th>
                <th>Ref</th>
                <th className="num">Observed</th>
                <th className="num">Interpreted throw</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {offsets.map((o) => (
                <tr key={o.id} data-clickable="true" onClick={() => onOpenOffset(o.id)}>
                  <td className="mono">{o.recordId}</td>
                  <td>{o.structure.structureType}</td>
                  <td className="mono">{o.structure.structureRef ?? '—'}</td>
                  <td className="num" style={{ color: 'var(--observed)' }}>
                    {o.apparentOffset} {o.unit.toLowerCase()}
                  </td>
                  <td className="num" style={{ color: 'var(--interpreted)' }}>
                    {o.interpretedThrow != null ? `${o.interpretedThrow} m` : '—'}
                  </td>
                  <td>
                    <Pill confidence={o.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {log.observations.length > 0 && (
        <Panel title={`Observations (${log.observations.length})`}>
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Type</th>
                <th>Structures</th>
                <th>Orientation</th>
                <th>Source</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {log.observations.map((o) => {
                const s = o.structures[0];
                return (
                  <tr key={o.id}>
                    <td className="mono">{o.recordId}</td>
                    <td>{o.observationType}</td>
                    <td>{o.structures.map((x) => x.structureType).join(', ') || '—'}</td>
                    <td className="mono">
                      {s && s.strike != null ? `${s.strike}/${s.dip ?? '—'}/${s.dipDirection ?? '—'}` : '—'}
                    </td>
                    {/* A sensor reading and a hand-held reading are not the same
                        measurement, so the source travels with the value (§15). */}
                    <td className="small muted">{s?.measurementSource ?? '—'}</td>
                    <td>
                      <Pill confidence={o.confidence} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {(log.faceMeasurements ?? []).length > 0 && (
        <Panel title={`Face measurements — BMSZ tape offsets (${log.faceMeasurements.length})`}>
          {log.faceMeasurements.map((m) => (
            <div key={m.id} className="panel-body stack" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                <span className="mono">{m.recordId}</span>
                <span className="small muted">
                  {m.measuredBy.name} · {fmtDateTime(m.measuredAt)}
                </span>
                <div className="spacer" />
                <span className="small muted">
                  limits {m.limitSetCode} · H/W {m.limitHangingwall.toFixed(2)} · F/W {m.limitFootwall.toFixed(2)}
                </span>
              </div>

              <FaceSectionChart
                measurement={{
                  distanceFromPeg: m.distanceFromPeg,
                  faceLength: m.faceLength,
                  stationInterval: m.stationInterval,
                  traverseDirection: 'DOWN_DIP_TO_UP_DIP',
                  limits: {
                    code: m.limitSetCode,
                    label: m.limitSetCode,
                    hangingwall: m.limitHangingwall,
                    footwall: m.limitFootwall,
                  },
                  stations: m.stations,
                }}
              />

              <div className="row" style={{ gap: 26 }}>
                <Field label="Stations" value={`${m.measuredCount} / ${m.stationCount} at ${m.stationInterval} m`} />
                <Field label="H/W breaches" value={String(m.hangingwallBreaches)} />
                <Field label="F/W breaches" value={String(m.footwallBreaches)} />
                <Field
                  label="Mean over-break"
                  value={m.meanHangingwallOverbreak !== null ? `${m.meanHangingwallOverbreak.toFixed(2)} m` : '—'}
                />
                <Field
                  label="Mean stope width"
                  value={m.meanStopeWidth !== null ? `${m.meanStopeWidth.toFixed(2)} m` : '—'}
                />
                <Field
                  label="Range"
                  value={
                    m.minStopeWidth !== null
                      ? `${m.minStopeWidth.toFixed(2)}–${m.maxStopeWidth!.toFixed(2)} m`
                      : '—'
                  }
                />
                <Field label="Peg to face" value={m.distanceFromPeg !== null ? `${m.distanceFromPeg} m` : '—'} />
              </div>

              {m.stations.some((st) => st.reason) && (
                <div className="small muted">
                  Breach reasons:{' '}
                  {[...new Set(m.stations.map((st) => st.reason).filter(Boolean))]
                    .map((code) => labelFor(PLACEHOLDER_REFERENCE_DATA, 'face_breach_reason', code))
                    .join('; ')}
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}

      {log.samples.length > 0 && (
        <Panel title={`Samples (${log.samples.length})`}>
          <table>
            <thead>
              <tr>
                <th>Sample</th>
                <th>Type</th>
                <th className="num">Length</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {log.samples.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.sampleNumber}</td>
                  <td>{s.sampleType}</td>
                  <td className="num">{s.length != null ? `${s.length} m` : '—'}</td>
                  <td>
                    <Pill status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Review history">
        {log.reviews.length === 0 ? (
          <Empty>No review decisions recorded yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Decision</th>
                <th>Reviewer</th>
                <th>Comment</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {log.reviews.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Pill status={r.status} />
                  </td>
                  <td>
                    {r.reviewer.name} <span className="small muted">{r.reviewer.role.replace(/_/g, ' ').toLowerCase()}</span>
                  </td>
                  <td>{r.comment ?? '—'}</td>
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
            <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Required for anything other than a plain acceptance." />
          </label>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => void decide('ACCEPTED')}>
              Accept
            </button>
            <button className="btn" disabled={busy} onClick={() => void decide('CLARIFICATION_REQUESTED')}>
              Request clarification
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void decide('REJECTED')}>
              Reject
            </button>
            <div className="spacer" />
            <button className="btn btn-primary" disabled={busy} onClick={() => void decide('VALIDATED')}>
              Mark validated
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            A decision never alters what the technician recorded. Requesting clarification returns the log to them with
            your comment; the original observation stays exactly as it was captured.
          </p>
        </div>
      </Panel>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mono" style={{ fontSize: 14 }}>
        {value}
      </div>
    </div>
  );
}

/* ── one offset: the observed / interpreted screen (§13) ──────────────── */

export function OffsetView({ id, onBack, onOpenHistory }: { id: string; onBack: () => void; onOpenHistory: (ref: string) => void }) {
  const [detail, setDetail] = useState<OffsetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [field, setField] = useState<'throw' | 'heave'>('throw');
  const [value, setValue] = useState('');
  const [confidence, setConfidence] = useState('MEDIUM');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.offset(id).then(setDetail).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(load, [load]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.interpret({
        entityType: 'OFFSET',
        entityId: id,
        field,
        value: Number(value),
        confidence,
        comment: comment.trim() || undefined,
      });
      setNotice(`Interpreted ${field} recorded alongside the observation.`);
      setValue('');
      setComment('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) return <div className="banner">{error}</div>;
  if (!detail) return <Empty>Loading…</Empty>;

  const o = detail.observed;
  const structureRef = detail.record.structure.structureRef;

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={onBack}>
          ← Back
        </button>
        {structureRef && (
          <button className="btn btn-sm" onClick={() => onOpenHistory(structureRef)}>
            History of {structureRef} →
          </button>
        )}
      </div>

      <h1 className="page-title">{detail.record.recordId}</h1>
      <p className="page-sub">
        {detail.record.structure.structureType}
        {structureRef ? ` · ${structureRef}` : ''} · recorded by {o.observedBy.name} on {fmtDateTime(o.observedAt)}
      </p>

      {notice && <div className="banner" data-tone="ok" style={{ marginBottom: 14 }}>{notice}</div>}
      {error && <div className="banner" style={{ marginBottom: 14 }}>{error}</div>}

      <div style={{ marginBottom: 20 }}>
        <ProvenancePair
          observedLabel="Apparent offset measured at the face"
          observedValue={`${o.apparentOffset} ${String(o.unit).toLowerCase()}`}
          observedMeta={
            <>
              Confidence <Pill confidence={o.confidence} /> · {String(o.measurementMethod ?? 'method not recorded')} ·{' '}
              {String(o.measurementSource ?? 'source not recorded')}
            </>
          }
          interpretedLabel="Throw"
          interpretedValue={detail.interpreted?.throw != null ? `${detail.interpreted.throw} m` : null}
          interpretedMeta={
            detail.interpreted ? (
              <>
                Confidence <Pill confidence={detail.interpreted.confidence} /> · {fmtDateTime(detail.interpreted.interpretedAt)}
              </>
            ) : null
          }
        />
      </div>

      <Panel title="Generated section">
        <div className="panel-body">
          <OffsetDiagram
            input={{
              apparentOffset: o.apparentOffset,
              unit: String(o.unit).toLowerCase(),
              markerLabel: String(o.markerType ?? 'Marker'),
              structureLabel: detail.record.structure.structureType,
              verticalSense: (o.verticalSense as 'UP' | 'DOWN' | null) ?? null,
              lateralSense: (o.lateralSense as 'LEFT' | 'RIGHT' | null) ?? null,
            }}
          />
        </div>
      </Panel>

      <Panel title="Interpretation history">
        {detail.interpretationHistory.length === 0 ? (
          <Empty>No interpretation has been recorded against this observation.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th className="num">Value</th>
                <th>Confidence</th>
                <th>Interpreter</th>
                <th>Comment</th>
                <th>When</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {detail.interpretationHistory.map((i) => (
                <tr key={i.id}>
                  <td>{i.field}</td>
                  <td className="num" style={{ color: 'var(--interpreted)' }}>
                    {String(i.value)}
                  </td>
                  <td>
                    <Pill confidence={i.confidence} />
                  </td>
                  <td>{i.interpretedBy.name}</td>
                  <td>{i.comment ?? '—'}</td>
                  <td className="small muted">{fmtDateTime(i.interpretedAt)}</td>
                  {/* Superseded readings stay on the record. The reasoning
                      history is part of the geological record (§13). */}
                  <td className="small muted">{i.supersededById ? 'superseded' : 'current'}</td>
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
            <label style={{ width: 160 }}>
              <span className="label">Interpretation confidence</span>
              <select className="select" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
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
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !value} onClick={() => void submit()}>
              Record interpretation
            </button>
            <span className="small muted">
              This is written alongside the technician's measurement of {o.apparentOffset} {String(o.unit).toLowerCase()},
              which stays exactly as recorded.
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}
