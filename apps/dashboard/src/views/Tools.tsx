import { useCallback, useEffect, useState } from 'react';
import type { MeasurementConvention, RefList } from '@geotech/core';
import {
  api,
  type AuditRow,
  type ConflictRow,
  type DailyReport,
  type HandoverReport,
  type SearchResult,
  type StructureHistory,
  type UserRow,
} from '../api.js';
import { Empty, Panel, Pill, fmtDate, fmtDateTime } from '../components/ui.js';

/* ── structure history (§23) ──────────────────────────────────────────── */

export function StructureHistoryView({ structureRef, onOpenOffset }: { structureRef: string; onOpenOffset: (id: string) => void }) {
  const [history, setHistory] = useState<StructureHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHistory(null);
    setError(null);
    api.structureHistory(structureRef).then(setHistory).catch((e) => setError((e as Error).message));
  }, [structureRef]);

  if (error) return <div className="banner">{error}</div>;
  if (!history) return <Empty>Loading…</Empty>;

  const max = history.summary?.max ?? 1;

  return (
    <>
      <h1 className="page-title">{history.structureRef}</h1>
      <p className="page-sub">
        {history.structureType} · observed at {history.occurrences} face{history.occurrences === 1 ? '' : 's'}
        {history.summary && ` · ${history.summary.min}–${history.summary.max} m, mean ${history.summary.mean} m`}
      </p>

      <Panel title="Apparent offset by observation">
        <div className="panel-body">
          {history.observations.map((o) => (
            <div key={o.offsetId} className="hist-row">
              <span className="mono">{o.level} {o.workplace}</span>
              <span className="num mono" style={{ color: 'var(--observed)' }}>
                {o.apparentOffset} {o.unit.toLowerCase()}
              </span>
              <div className="hist-track" title={`${o.apparentOffset} ${o.unit}`}>
                <div className="hist-fill" style={{ width: `${Math.max(2, (o.apparentOffset / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Observations">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Level</th>
              <th>Workplace</th>
              <th>Date</th>
              <th>Technician</th>
              <th className="num">Observed</th>
              <th className="num">Interpreted throw</th>
              <th>Orientation</th>
              <th>Confidence</th>
              <th className="num">Photos</th>
            </tr>
          </thead>
          <tbody>
            {history.observations.map((o) => (
              <tr key={o.offsetId} data-clickable="true" onClick={() => onOpenOffset(o.offsetId)}>
                <td className="mono">{o.recordId}</td>
                <td>{o.level}</td>
                <td>{o.workplace}</td>
                <td className="small">{fmtDate(o.date)}</td>
                <td>{o.technician}</td>
                <td className="num" style={{ color: 'var(--observed)' }}>
                  {o.apparentOffset} {o.unit.toLowerCase()}
                </td>
                <td className="num" style={{ color: 'var(--interpreted)' }}>
                  {o.interpretedThrow != null ? `${o.interpretedThrow} m` : '—'}
                </td>
                <td className="mono">{o.strike != null ? `${o.strike}/${o.dip ?? '—'}` : '—'}</td>
                <td>
                  <Pill confidence={o.confidence} />
                </td>
                <td className="num">{o.photoCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

/* ── search (§27) ─────────────────────────────────────────────────────── */

export function SearchView({ onOpenLog, onOpenOffset }: { onOpenLog: (id: string) => void; onOpenOffset: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.search(q));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Search</h1>
      <p className="page-sub">
        Record identifiers are looked up exactly. Everything else is read as a question — try <code>faults &gt; 2m level L12</code>.
      </p>

      <div className="row" style={{ marginBottom: 18 }}>
        <input
          className="input"
          style={{ maxWidth: 460 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run(query)}
          placeholder="UNK-OFS-2026-000012, or faults > 2m level L12"
        />
        <button className="btn btn-primary" disabled={busy} onClick={() => void run(query)}>
          Search
        </button>
      </div>

      {error && <div className="banner">{error}</div>}

      {result && (
        <>
          <Panel title="How this was read">
            <div className="panel-body mono small">{JSON.stringify(result.parsed)}</div>
          </Panel>

          <Panel title={`Offsets (${result.offsets.length})`}>
            {result.offsets.length === 0 ? (
              <Empty>No matching offsets.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Structure</th>
                    <th>Workplace</th>
                    <th className="num">Observed</th>
                    <th className="num">Interpreted</th>
                  </tr>
                </thead>
                <tbody>
                  {result.offsets.map((o) => (
                    <tr key={o.id} data-clickable="true" onClick={() => onOpenOffset(o.id)}>
                      <td className="mono">{o.recordId}</td>
                      <td>{o.structure?.structureType}</td>
                      <td>
                        {o.structure?.observation?.faceLog?.workplace?.section?.level?.code} /{' '}
                        {o.structure?.observation?.faceLog?.workplace?.code}
                      </td>
                      <td className="num" style={{ color: 'var(--observed)' }}>
                        {o.apparentOffset} {o.unit?.toLowerCase()}
                      </td>
                      <td className="num" style={{ color: 'var(--interpreted)' }}>
                        {o.interpretedThrow ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title={`Face logs (${result.faceLogs.length})`}>
            {result.faceLogs.length === 0 ? (
              <Empty>No matching face logs.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Workplace</th>
                    <th>Reference</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.faceLogs.map((l) => (
                    <tr key={l.id} data-clickable="true" onClick={() => onOpenLog(l.id)}>
                      <td className="mono">{l.recordId}</td>
                      <td>{l.workplace?.code}</td>
                      <td className="mono">{l.surveyReference ?? '—'}</td>
                      <td>
                        <Pill status={l.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

/* ── reports (§26) ────────────────────────────────────────────────────── */

export function ReportsView() {
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [handover, setHandover] = useState<HandoverReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.reportDaily(), api.reportHandover()])
      .then(([d, h]) => {
        setDaily(d);
        setHandover(h);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const download = async (kind: 'daily' | 'structures' | 'samples') => {
    const csv = await api.reportCsv(kind);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <div className="banner">{error}</div>;
  if (!daily || !handover) return <Empty>Loading…</Empty>;

  return (
    <>
      <h1 className="page-title">Reports</h1>
      <p className="page-sub">
        CSV downloads open directly in Excel. Use the browser's print dialogue to produce a PDF of any report on screen.
      </p>

      <Panel
        title={`${daily.title} — ${daily.date}`}
        actions={
          <button className="btn btn-sm" onClick={() => void download('daily')}>
            Download CSV
          </button>
        }
      >
        <div className="tiles" style={{ padding: 16, margin: 0 }}>
          {Object.entries(daily.summary).map(([key, value]) => (
            <div className="tile" key={key}>
              <div className="tile-label">{key.replace(/([A-Z])/g, ' $1')}</div>
              <div className="tile-value">{value}</div>
            </div>
          ))}
        </div>
        <div className="panel-body small muted" style={{ borderTop: '1px solid var(--line)' }}>
          {daily.disclaimer}
        </div>
      </Panel>

      <Panel title={`${handover.title} — ${handover.date}`}>
        <div className="panel-body stack">
          <div>
            <span className="label">Significant offsets</span>
            {handover.significantOffsets.length === 0 ? (
              <div className="muted small">None recorded.</div>
            ) : (
              <pre className="mono small" style={{ margin: 0, overflowX: 'auto' }}>
                {handover.significantOffsets.map((o) => `${o.workplace.padEnd(16)} ${o.diagram}`).join('\n')}
              </pre>
            )}
          </div>
          <div>
            <span className="label">Open hazards ({handover.openHazards.length})</span>
            {handover.openHazards.map((h) => (
              <div key={h.recordId} className="small">
                <span className="mono">{h.recordId}</span> · {h.type} · {h.severity} · {h.workplace} — {h.description}
              </div>
            ))}
          </div>
          <div className="small muted">Outstanding reviews: {handover.outstandingReviews}</div>
          <div className="small muted">{handover.disclaimer}</div>
        </div>
      </Panel>

      <Panel
        title="Other reports"
        actions={
          <div className="row">
            <button className="btn btn-sm" onClick={() => void download('structures')}>
              Structures CSV
            </button>
            <button className="btn btn-sm" onClick={() => void download('samples')}>
              Sampling CSV
            </button>
          </div>
        }
      >
        <div className="panel-body small muted">
          Structure and sampling reports keep observed and interpreted values in separate columns, so a report can never
          present a geologist's conclusion as a technician's measurement.
        </div>
      </Panel>
    </>
  );
}

/* ── audit trail (§21, §40) ───────────────────────────────────────────── */

export function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entity, setEntity] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .audit({ entity: entity || undefined, take: 100 })
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError((e as Error).message));
  }, [entity]);
  useEffect(load, [load]);

  if (error) return <div className="banner">{error}</div>;

  return (
    <>
      <h1 className="page-title">Audit trail</h1>
      <p className="page-sub">
        Append-only. No route in this system modifies or deletes an audit entry, at any role.
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <select className="select" style={{ maxWidth: 220 }} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All record types</option>
          {['FACE_LOG', 'OBSERVATION', 'STRUCTURE', 'OFFSET', 'SAMPLE', 'HAZARD', 'PHOTO', 'User'].map((e) => (
            <option key={e} value={e}>
              {e.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <span className="small muted">{total} entries</span>
      </div>

      <Panel title="Entries">
        {rows.length === 0 ? (
          <Empty>No audit entries.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Device</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small muted">{fmtDateTime(r.timestamp)}</td>
                  <td>
                    {r.user?.name ?? 'system'}
                    {r.user && <div className="small muted">{r.user.role.replace(/_/g, ' ').toLowerCase()}</div>}
                  </td>
                  <td className="mono small">{r.action}</td>
                  <td className="mono small">
                    {r.entity}
                    <div className="muted">{r.entityId.slice(0, 8)}</div>
                  </td>
                  <td className="mono small muted">{r.deviceId?.slice(0, 12) ?? '—'}</td>
                  <td className="mono small muted" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {summariseChange(r)}
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

function summariseChange(row: AuditRow): string {
  const next = row.newValue as Record<string, unknown> | null;
  if (!next) return '—';
  if ('field' in next) return `${String(next['field'])} = ${JSON.stringify(next['value'])}`;
  if ('status' in next) return `status = ${String(next['status'])}`;
  if ('apparentOffset' in next) return `apparent offset = ${String(next['apparentOffset'])}`;
  return Object.keys(next).slice(0, 4).join(', ');
}

/* ── sync conflicts (§30) ─────────────────────────────────────────────── */

export function ConflictsView() {
  const [rows, setRows] = useState<ConflictRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api.conflicts().then(setRows).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const resolve = async (id: string, keep: 'LOCAL' | 'SERVER') => {
    await api.resolveConflict(id, keep);
    setNotice(`Kept the ${keep.toLowerCase()} version. Both remain in the audit trail.`);
    load();
  };

  if (error) return <div className="banner">{error}</div>;

  return (
    <>
      <h1 className="page-title">Sync conflicts</h1>
      <p className="page-sub">
        A conflict is never resolved automatically. Both versions are preserved, and whichever is kept, the other stays
        in the audit trail.
      </p>
      {notice && <div className="banner" data-tone="ok" style={{ marginBottom: 14 }}>{notice}</div>}

      {rows.length === 0 ? (
        <Panel title="Conflicts">
          <Empty>No conflicts are waiting.</Empty>
        </Panel>
      ) : (
        rows.map((row) => (
          <Panel
            key={row.id}
            title={`${row.entityType.replace(/_/g, ' ')} · ${row.batch.deviceId}`}
            actions={
              <div className="row">
                <button className="btn btn-sm" onClick={() => void resolve(row.id, 'LOCAL')}>
                  Keep device version
                </button>
                <button className="btn btn-sm" onClick={() => void resolve(row.id, 'SERVER')}>
                  Keep server version
                </button>
              </div>
            }
          >
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>On the device</th>
                  <th>On the server</th>
                </tr>
              </thead>
              <tbody>
                {(row.conflict?.conflictingFields ?? []).map((f) => (
                  <tr key={f}>
                    <td className="mono">{f}</td>
                    <td className="mono">{JSON.stringify(row.conflict?.localVersion?.[f])}</td>
                    <td className="mono">{JSON.stringify(row.conflict?.serverVersion?.[f])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))
      )}
    </>
  );
}

/* ── administration (§38, §39) ────────────────────────────────────────── */

export function AdminView() {
  const [lists, setLists] = useState<RefList[]>([]);
  const [convention, setConvention] = useState<MeasurementConvention | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<string>('structure_type');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(() => {
    Promise.all([api.referenceLists(), api.convention(), api.users().catch(() => [])])
      .then(([l, c, u]) => {
        setLists(l);
        setConvention(c);
        setUsers(u);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const list = lists.find((l) => l.code === selected);

  const addItem = async () => {
    if (!newCode || !newLabel) return;
    try {
      await api.upsertRefItem(selected, { code: newCode.toUpperCase(), label: newLabel, sortOrder: (list?.items.length ?? 0) * 10 + 10 });
      setNotice(`Added ${newCode.toUpperCase()} to ${selected}.`);
      setNewCode('');
      setNewLabel('');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const retire = async (code: string) => {
    try {
      await api.retireRefItem(selected, code);
      setNotice(`${code} retired. Records already using it stay readable.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h1 className="page-title">Administration</h1>
      <p className="page-sub">
        Geological terminology, measurement conventions and validation rules are configuration, not code.
      </p>

      <div className="banner" data-tone="ok" style={{ marginBottom: 16, borderColor: 'var(--warn)', color: 'var(--warn)' }}>
        The lists below are seeded with neutral placeholder terminology for development. They are not official Unki
        geological codes — replace them with the mine-approved values before production use.
      </div>

      {notice && <div className="banner" data-tone="ok" style={{ marginBottom: 14 }}>{notice}</div>}
      {error && <div className="banner" style={{ marginBottom: 14 }}>{error}</div>}

      <Panel title="Reference lists">
        <div className="panel-body row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <select className="select" style={{ maxWidth: 260 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
            {lists.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} {l.mineSpecific ? '· mine-specific' : ''}
              </option>
            ))}
          </select>
          <div className="small muted" style={{ flex: 1 }}>
            {list?.description}
          </div>
        </div>
        {list && (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th className="num">Order</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((i) => (
                <tr key={i.code}>
                  <td className="mono">{i.code}</td>
                  <td>{i.label}</td>
                  <td className="num">{i.sortOrder}</td>
                  <td>{i.active ? <Pill status="ACCEPTED" /> : <Pill status="DRAFT" />}</td>
                  <td>
                    {i.active && (
                      <button className="btn btn-sm" onClick={() => void retire(i.code)}>
                        Retire
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="panel-body row" style={{ borderTop: '1px solid var(--line)' }}>
          <input className="input" style={{ maxWidth: 160 }} placeholder="CODE" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
          <input className="input" style={{ maxWidth: 260 }} placeholder="Label shown to technicians" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button className="btn btn-primary" onClick={() => void addItem()}>
            Add term
          </button>
          <span className="small muted">Retiring hides a term from new capture but leaves historical records readable.</span>
        </div>
      </Panel>

      {convention && (
        <Panel title="Measurement convention">
          <table>
            <tbody>
              {Object.entries(convention).map(([key, value]) => (
                <tr key={key}>
                  <td>{key.replace(/([A-Z])/g, ' $1')}</td>
                  <td className="mono">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="panel-body small muted" style={{ borderTop: '1px solid var(--line)' }}>
            These bounds decide what counts as a valid geological measurement across the whole mine, on the device and on
            the server alike. Changing them is audited like a data change.
          </div>
        </Panel>
      )}

      {users.length > 0 && (
        <Panel title="Users">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Last sign-in</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.employeeNo}</td>
                  <td>{u.name}</td>
                  <td>{u.role.replace(/_/g, ' ').toLowerCase()}</td>
                  <td>{u.department ?? '—'}</td>
                  <td className="small muted">{fmtDateTime(u.lastLoginAt)}</td>
                  <td>{u.active ? <Pill status="ACCEPTED" /> : <Pill status="REJECTED" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
