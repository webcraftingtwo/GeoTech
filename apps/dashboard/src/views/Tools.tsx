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
