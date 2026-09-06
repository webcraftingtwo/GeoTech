import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { api, type FieldNotification } from '../api/client.js';
import { db } from '../db/database.js';
import { IS_STANDALONE } from '../deployment.js';
import {
  IconFaceLog,
  IconFaceMeasurement,
  IconObservation,
  IconOffset,
  IconPhoto,
  IconSample,
} from '../components/Icons.js';
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
  const handover = useLiveQuery(
    async () => {
      if (!IS_STANDALONE) return 0;
      const { countOutstanding } = await import('../db/handover.js');
      return countOutstanding();
    },
    [],
    0,
  );

  /**
   * Notifications (§28). Only things that need the technician to do something
   * reach this screen — a geologist asking for clarification, a record that
   * needs correcting. Sync progress is already in the header, and repeating it
   * here would train people to ignore the one place that matters.
   *
   * Fetching fails silently underground; that is not an error worth reporting.
   */
  const [notifications, setNotifications] = useState<FieldNotification[]>([]);
  const loadNotifications = useCallback(() => {
    if (IS_STANDALONE) return;
    api.notifications().then(setNotifications).catch(() => undefined);
  }, []);
  useEffect(loadNotifications, [loadNotifications]);

  const dismiss = async (id: string) => {
    setNotifications((n) => n.filter((x) => x.id !== id));
    await api.markNotificationRead(id).catch(() => undefined);
  };

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

        {notifications.map((n) => (
          <div key={n.id} className="card card-danger stack" style={{ gap: 8 }}>
            <div>
              <span className="label">From the geologist</span>
              <div style={{ fontWeight: 700 }}>{n.title}</div>
              {n.body && <div className="small muted">{n.body}</div>}
            </div>
            <div className="row">
              {n.entityType === 'FACE_LOG' && n.entityId && (
                <button className="btn" onClick={() => push({ name: 'myLogs' })}>
                  Open my logs
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => void dismiss(n.id)}>
                Got it
              </button>
            </div>
          </div>
        ))}

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
          <button className="action-button" onClick={() => push({ name: 'newFaceLog' })}>
            <span className="glyph"><IconFaceLog size={30} /></span>
            <span>
              NEW FACE LOG
              <span className="sub">Start a log at this working place</span>
            </span>
          </button>

          <button
            className="action-button"
            data-emphasis="primary"
            onClick={() => requireLog((id) => push({ name: 'faceMeasurement', faceLogLocalId: id }))}
          >
            <span className="glyph"><IconFaceMeasurement size={30} /></span>
            <span>
              RECORD OFFSETS
              <span className="sub">BMSZ tape offsets across the face, in cm</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'offset', faceLogLocalId: id }))}>
            <span className="glyph"><IconOffset size={30} /></span>
            <span>
              STRUCTURE DISPLACEMENT
              <span className="sub">Offset across a fault or shear</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'observation', faceLogLocalId: id }))}>
            <span className="glyph"><IconObservation size={30} /></span>
            <span>
              GEOLOGICAL OBSERVATION
              <span className="sub">Reef, contact, structure, ground</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'photo', faceLogLocalId: id }))}>
            <span className="glyph"><IconPhoto size={30} /></span>
            <span>
              FACE PHOTO
              <span className="sub">Photograph the face</span>
            </span>
          </button>

          <button className="action-button" onClick={() => requireLog((id) => push({ name: 'sample', faceLogLocalId: id }))}>
            <span className="glyph"><IconSample size={30} /></span>
            <span>
              SAMPLE
              <span className="sub">Record a sample and its position</span>
            </span>
          </button>

        </div>

        <div className="grid-2">
          <button className="btn" onClick={() => push({ name: 'myLogs' })}>
            My logs ({mine}){drafts > 0 ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}
          </button>
          <button className="btn" onClick={() => push({ name: 'pending' })}>
            {IS_STANDALONE ? `Hand over (${handover})` : `Sync queue (${queued})`}
          </button>
          <button className="btn" onClick={() => push({ name: 'search' })}>
            Search
          </button>
          <button className="btn" onClick={() => push({ name: 'settings' })}>
            Settings
          </button>
        </div>
      </Screen>
    </>
  );
}
