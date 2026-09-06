import { useEffect, useState } from 'react';
import { MINING_HEIGHT_FLAG_CM, toMetres } from '@geotech/core';
import { api, type WidthControlReport, type WidthControlRow } from '../api.js';
import { Empty, Panel, fmtDateTime } from '../components/ui.js';

/**
 * The management dashboard.
 *
 * Two audiences, one set of readings. The technician records centimetres
 * because that is what the tape says; management works in metres. The
 * conversion happens here and in the report endpoint, never at capture — a
 * reading converted on the way in is a reading that can be converted wrongly,
 * and there is then nothing to check it against.
 *
 * What management is here for is the exceptions, so the faces mined above the
 * flag height come first and are stated in the heading rather than left to be
 * counted off a table.
 */
export function ManagementView() {
  const [report, setReport] = useState<WidthControlReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .reportWidthControl()
      .then(setReport)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="banner">{error}</div>;
  if (!report) return <Empty>Loading…</Empty>;

  const flagged = report.rows.filter((r) => r.aboveFlagHeight === 'YES');
  const breaching = report.rows.filter((r) => r.hangingwallBreaches > 0 || r.footwallBreaches > 0);
  const flagHeightM = toMetres(MINING_HEIGHT_FLAG_CM);

  return (
    <>
      <h1 className="page-title">Management</h1>
      <p className="page-sub">
        {report.count} face{report.count === 1 ? '' : 's'} measured. Heights in metres; the readings behind them are
        recorded in centimetres at the face.
      </p>

      <div className="stat-row">
        <Stat label="Faces measured" value={String(report.count)} />
        <Stat
          label={`Mined above ${flagHeightM.toFixed(2)} m`}
          value={String(flagged.length)}
          tone={flagged.length > 0 ? 'danger' : undefined}
        />
        <Stat
          label="Outside cut limits"
          value={String(breaching.length)}
          tone={breaching.length > 0 ? 'danger' : undefined}
        />
      </div>

      <Panel title={`Mining heights above ${flagHeightM.toFixed(2)} m (${flagged.length})`}>
        {flagged.length === 0 ? (
          <Empty>No face was mined above {flagHeightM.toFixed(2)} m in this period.</Empty>
        ) : (
          <FaceTable rows={flagged} />
        )}
      </Panel>

      <Panel title={`Every measured face (${report.count})`}>
        {report.rows.length === 0 ? <Empty>Nothing measured yet.</Empty> : <FaceTable rows={report.rows} />}
      </Panel>

      <Panel title="Basis">
        <div className="panel-body small muted">
          {report.basis} Generated {fmtDateTime(report.generatedAt)}.
        </div>
      </Panel>
    </>
  );
}

function FaceTable({ rows }: { rows: WidthControlRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Record</th>
          <th>Date</th>
          <th>Section</th>
          <th>Working place</th>
          <th className="num">Mean height</th>
          <th className="num">Range</th>
          <th className="num">H/W</th>
          <th className="num">F/W</th>
          <th>Measured by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const high = r.aboveFlagHeight === 'YES';
          return (
            <tr key={r.recordId}>
              <td className="mono">{r.recordId}</td>
              <td className="small muted">{r.date}</td>
              <td>{r.section}</td>
              <td>{r.workplace}</td>
              <td className="num" style={high ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                {r.meanMiningHeightM === '' ? '—' : `${Number(r.meanMiningHeightM).toFixed(2)} m`}
              </td>
              <td className="num small muted">
                {r.minMiningHeightCm === ''
                  ? '—'
                  : `${toMetres(Number(r.minMiningHeightCm)).toFixed(2)}–${toMetres(Number(r.maxMiningHeightCm)).toFixed(2)} m`}
              </td>
              <td className="num" style={r.hangingwallBreaches > 0 ? { color: 'var(--danger)' } : undefined}>
                {r.hangingwallBreaches}
              </td>
              <td className="num" style={r.footwallBreaches > 0 ? { color: 'var(--danger)' } : undefined}>
                {r.footwallBreaches}
              </td>
              <td className="small muted">{r.measuredBy}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="stat" data-tone={tone}>
      <span className="label">{label}</span>
      <div className="stat-value" style={tone === 'danger' ? { color: 'var(--danger)' } : undefined}>
        {value}
      </div>
    </div>
  );
}
