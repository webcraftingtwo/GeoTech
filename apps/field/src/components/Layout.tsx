import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { describeSyncStatus } from '@geotech/core';
import { db } from '../db/database.js';
import { IS_STANDALONE } from '../deployment.js';
import { IconAttention, IconBack, IconOffline, IconSynced, IconSyncing } from './Icons.js';
import { useApp } from '../state/app.js';

export function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <header className="header">
      <div className="row">
        {onBack && (
          <button className="back-button" onClick={onBack} aria-label="Back">
            <IconBack />
          </button>
        )}
        <div>
          <div className="header-title">UNKI GEOTECH</div>
          <div className="header-name">{title}</div>
        </div>
        <div className="spacer" />
        {subtitle && <div className="small muted">{subtitle}</div>}
      </div>
    </header>
  );
}

/**
 * The sync indicator (§5). It is always visible, always specific, and never
 * asks the technician to do anything — synchronising is the application's job.
 */
export function SyncBar() {
  if (IS_STANDALONE) return <HandoverBar />;
  return <NetworkedSyncBar />;
}

/**
 * Standalone deployment: there is nothing to synchronise with, so the bar
 * reports what is waiting to be handed over instead. It never says "synced",
 * because nothing has been — that would be the one misleading word available.
 */
function HandoverBar() {
  const { push } = useApp();
  const held = useLiveQuery(
    async () => {
      const { countOutstanding } = await import('../db/handover.js');
      return countOutstanding();
    },
    [],
    0,
  );

  const state = held > 0 ? 'syncing' : 'synced';
  const Mark = held > 0 ? IconSyncing : IconSynced;

  return (
    <button className="sync-bar" data-state={state} onClick={() => push({ name: 'pending' })}>
      <Mark size={17} />
      <span>
        {held > 0
          ? `${held} record${held === 1 ? '' : 's'} to hand over`
          : 'All records handed over'}
      </span>
    </button>
  );
}

function NetworkedSyncBar() {
  const { sync, showToast } = useApp();

  // Counted straight from the queue rather than from the engine's last poll:
  // a record queued a second ago must be visible in the indicator now, not at
  // the next sync tick. Being told "everything saved" while a record is in fact
  // waiting is exactly the kind of quiet lie this application cannot tell.
  const queued = useLiveQuery(() => db.queue.toArray(), [], []);
  const outstanding = queued.filter((q) => !q.blocked).length;
  const attention = queued.filter((q) => q.blocked).length + sync.conflicts;

  const state =
    attention > 0 ? 'attention' : sync.running ? 'syncing' : !sync.online ? 'offline' : outstanding > 0 ? 'syncing' : 'synced';

  const text =
    attention > 0
      ? `${attention} record${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention`
      : describeSyncStatus({
          online: sync.online,
          pending: sync.running ? 0 : outstanding,
          failed: 0,
          conflicts: sync.conflicts,
          syncing: sync.running ? outstanding : 0,
        });

  // Each state has its own shape, not only its own colour (§33).
  const Mark =
    state === 'attention' ? IconAttention : state === 'offline' ? IconOffline : state === 'synced' ? IconSynced : IconSyncing;

  return (
    <button
      className="sync-bar"
      data-state={state}
      onClick={() => sync.lastMessage && showToast(sync.lastMessage)}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontWeight: 700 }}
    >
      <Mark size={17} />
      <span>{text}</span>
    </button>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="screen stack">{children}</div>;
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="action-bar">{children}</div>;
}

export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="step-dot" data-state={i < current ? 'done' : i === current ? 'current' : 'todo'} />
      ))}
    </div>
  );
}

export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className="toast" data-tone={toast.tone} role="status">
      {toast.message}
    </div>
  );
}
