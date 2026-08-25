import { useEffect, useState } from 'react';
import { api, type RecentRow } from '../api.js';
import { Empty, Panel, Pill, Tile, fmtDateTime } from '../components/ui.js';

/** The overview counters and recent-observations table (§22). */
export function OverviewView({ onOpenOffset }: { onOpenOffset: (id: string) => void }) {
  const [stats, setStats] = useState<Record<string, number | string> | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.overview(), api.recent(25)])
      .then(([s, r]) => {
        setStats(s);
        setRecent(r);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="banner">{error}</div>;
  if (!stats) return <Empty>Loading…</Empty>;

  return (
    <>
      <h1 className="page-title">Overview</h1>
      <p className="page-sub">Geological capture for {stats['date']}</p>

      <div className="tiles">
        <Tile label="Logs today" value={stats['logsToday']} />
        <Tile label="Pending review" value={stats['pendingReview']} tone={Number(stats['pendingReview']) > 0 ? 'warn' : undefined} />
        <Tile label="Observations" value={stats['observations']} />
        <Tile label="Offsets" value={stats['offsets']} />
        <Tile label="Samples" value={stats['samples']} />
        <Tile label="Open hazards" value={stats['openHazards']} tone={Number(stats['openHazards']) > 0 ? 'danger' : undefined} />
        <Tile label="Sync failures" value={stats['syncFailures']} tone={Number(stats['syncFailures']) > 0 ? 'danger' : undefined} />
        <Tile label="Conflicts" value={stats['conflicts']} tone={Number(stats['conflicts']) > 0 ? 'danger' : undefined} />
      </div>

      <Panel title="Recent observations">
        {recent.length === 0 ? (
          <Empty>No observations have synced yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Workplace</th>
                <th>Type</th>
                <th>Observation</th>
                <th>Technician</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} data-clickable="true" onClick={() => onOpenOffset(row.id)}>
                  <td className="mono">{row.recordId}</td>
                  <td>{row.workplace}</td>
                  <td>{row.type}</td>
                  <td>
                    {row.observation}
                    {row.interpreted && (
                      <span className="small" style={{ color: 'var(--interpreted)', marginLeft: 8 }}>
                        interpreted
                      </span>
                    )}
                  </td>
                  <td>{row.technician}</td>
                  <td>
                    <Pill confidence={row.confidence} />
                  </td>
                  <td>
                    <Pill status={row.status} />
                  </td>
                  <td className="small muted">{fmtDateTime(row.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
