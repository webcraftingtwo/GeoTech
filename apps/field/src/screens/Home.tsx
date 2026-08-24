import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database.js';
import { Header, Screen, SyncBar } from '../components/Layout.js';
import { useApp } from '../state/app.js';

/**
 * The home screen (§6).
 *
 * Six actions, each one tap from standing at a face. Everything else is
 * secondary and smaller. A technician arriving at a workplace should not have
 * to think about where anything is.
 */
export function HomeScreen() {
  const { session, push, showToast } = useApp();

  const openLog = useLiveQuery(
    () => db.faceLogs.filter((l) => l.status === 'DRAFT').reverse().first(),
    [],
  );
  const drafts = useLiveQuery(() => db.faceLogs.filter((l) => l.status === 'DRAFT').count(), [], 0);
  const mine = useLiveQuery(() => db.faceLogs.count(), [], 0);
  const queued = useLiveQuery(() => db.queue.count(), [], 0);

  /**
   * Every observation belongs to a face log. If none is open, start one — but
   * say so, because a screen that silently becomes a different screen is how
   * people lose their place underground.
   */
  const requireLog = (route: (faceLogLocalId: string) => void) => {
    if (openLog) return route(openLog.localId);
    showToast('Start a face log first — every observation is recorded against one.');
    push({ name: 'newFaceLog' });
  };

  const shift = new Date().getHours() < 14 ? 'Morning shift' : new Date().getHours() < 22 ? 'Afternoon shift' : 'Night shift';

  return (
    <>
      <Header title={session?.name ?? 'Technician'} subtitle={shift} />
      <Screen>
        <SyncBar />

        {openLog && (
          <button className="card card-accent record-row" onClick={() => push({ name: 'faceLog', localId: openLog.localId })}>
            <div style={{ flex: 1 }}>
              <span className="label">Open face log</span>
              <div className="rec-id">{openLog.recordId}</div>
              <div className="small muted">{openLog.surveyReference ?? 'No survey reference yet'}</div>
            </div>
            <span className="state-badge" data-state={openLog.syncState}>
              {openLog.status}
            </span>
          </button>
        )}

        <div className="stack">
          <button className="action-button" data-emphasis="primary" onClick={() => push({ name: 'newFaceLog' })}>
            <span className="glyph" aria-hidden>＋</span>
            <span>
              NEW FACE LOG
              <span className="sub">Start a log at this working place</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'offset', faceLogLocalId: id }))}>
            <span className="glyph" aria-hidden>📐</span>
            <span>
              RECORD OFFSET
              <span className="sub">Displacement across a structure</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'observation', faceLogLocalId: id }))}>
            <span className="glyph" aria-hidden>🪨</span>
            <span>
              GEOLOGICAL OBSERVATION
              <span className="sub">Reef, contact, structure, ground</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'photo', faceLogLocalId: id }))}>
            <span className="glyph" aria-hidden>📸</span>
            <span>
              FACE PHOTO
              <span className="sub">Photograph the face</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'sample', faceLogLocalId: id }))}>
            <span className="glyph" aria-hidden>🧪</span>
            <span>
              SAMPLE
              <span className="sub">Record a sample and its position</span>
            </span>
          </button>

          <button className="action-button" data-emphasis="hazard" onClick={() => requireLog((id) => push({ name: 'hazard', faceLogLocalId: id }))}>
            <span className="glyph" aria-hidden>⚠</span>
            <span>
              GEOLOGICAL HAZARD
              <span className="sub">Also report through the normal procedure</span>
            </span>
          </button>
        </div>

        <div className="grid-2">
          <button className="btn" onClick={() => push({ name: 'myLogs' })}>
            My logs ({mine})
          </button>
          <button className="btn" onClick={() => push({ name: 'pending' })}>
            Sync queue ({queued})
          </button>
          <button className="btn" onClick={() => push({ name: 'myLogs' })}>
            Drafts ({drafts})
          </button>
          <button className="btn" onClick={() => push({ name: 'settings' })}>
            Settings
          </button>
        </div>
      </Screen>
    </>
  );
}
