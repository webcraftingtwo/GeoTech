import { useEffect, useState } from 'react';
import { isAdministrator, isReviewer, type Role } from '@geotech/core';
import { api, hasSession, setTokens } from './api.js';
import { OverviewView } from './views/Overview.js';
import { FaceLogView, OffsetView, ReviewQueueView } from './views/Review.js';
import { AdminView, AuditView, ConflictsView, ReportsView, SearchView, StructureHistoryView } from './views/Tools.js';

type View =
  | { name: 'overview' }
  | { name: 'review' }
  | { name: 'faceLog'; id: string }
  | { name: 'offset'; id: string }
  | { name: 'history'; structureRef: string }
  | { name: 'search' }
  | { name: 'reports' }
  | { name: 'conflicts' }
  | { name: 'audit' }
  | { name: 'admin' };

interface User {
  id: string;
  name: string;
  role: Role;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: 'overview' });
  const [counts, setCounts] = useState<{ pendingReview: number; conflicts: number; openHazards: number }>({
    pendingReview: 0,
    conflicts: 0,
    openHazards: 0,
  });

  useEffect(() => {
    if (!hasSession()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then((me) => setUser({ id: me.id, name: me.name, role: me.role as Role }))
      .catch(() => setTokens(null, null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .overview()
      .then((s) =>
        setCounts({
          pendingReview: Number(s['pendingReview'] ?? 0),
          conflicts: Number(s['conflicts'] ?? 0),
          openHazards: Number(s['openHazards'] ?? 0),
        }),
      )
      .catch(() => undefined);
  }, [user, view]);

  if (checking) return <div className="login-wrap">Loading…</div>;
  if (!user) return <LoginView onSignedIn={setUser} />;

  const go = (next: View) => setView(next);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">UNKI GEOTECH</div>
        <div className="brand-name">Geology</div>

        <NavItem label="Overview" active={view.name === 'overview'} onClick={() => go({ name: 'overview' })} />
        {isReviewer(user.role) && (
          <NavItem
            label="Review queue"
            count={counts.pendingReview}
            tone={counts.pendingReview > 0 ? 'danger' : undefined}
            active={view.name === 'review' || view.name === 'faceLog'}
            onClick={() => go({ name: 'review' })}
          />
        )}
        <NavItem label="Search" active={view.name === 'search'} onClick={() => go({ name: 'search' })} />
        <NavItem label="Reports" active={view.name === 'reports'} onClick={() => go({ name: 'reports' })} />
        {isReviewer(user.role) && (
          <NavItem
            label="Conflicts"
            count={counts.conflicts}
            tone={counts.conflicts > 0 ? 'danger' : undefined}
            active={view.name === 'conflicts'}
            onClick={() => go({ name: 'conflicts' })}
          />
        )}
        {isReviewer(user.role) && <NavItem label="Audit trail" active={view.name === 'audit'} onClick={() => go({ name: 'audit' })} />}
        {isAdministrator(user.role) && <NavItem label="Administration" active={view.name === 'admin'} onClick={() => go({ name: 'admin' })} />}

        <div style={{ flex: 1 }} />

        <div className="small muted" style={{ padding: '10px 12px' }}>
          {user.name}
          <div>{user.role.replace(/_/g, ' ').toLowerCase()}</div>
        </div>
        <button
          className="nav-item"
          onClick={() => {
            setTokens(null, null);
            setUser(null);
          }}
        >
          Sign out
        </button>
        <p className="small muted" style={{ padding: '10px 12px', margin: 0, lineHeight: 1.45 }}>
          Geological information tool. Interpretation remains subject to competent-person review under the mine approved
          procedures.
        </p>
      </nav>

      <main className="main">
        {view.name === 'overview' && <OverviewView onOpenOffset={(id) => go({ name: 'offset', id })} />}
        {view.name === 'review' && <ReviewQueueView onOpenLog={(id) => go({ name: 'faceLog', id })} />}
        {view.name === 'faceLog' && (
          <FaceLogView id={view.id} onOpenOffset={(id) => go({ name: 'offset', id })} onBack={() => go({ name: 'review' })} />
        )}
        {view.name === 'offset' && (
          <OffsetView
            id={view.id}
            onBack={() => go({ name: 'overview' })}
            onOpenHistory={(structureRef) => go({ name: 'history', structureRef })}
          />
        )}
        {view.name === 'history' && (
          <StructureHistoryView structureRef={view.structureRef} onOpenOffset={(id) => go({ name: 'offset', id })} />
        )}
        {view.name === 'search' && (
          <SearchView onOpenLog={(id) => go({ name: 'faceLog', id })} onOpenOffset={(id) => go({ name: 'offset', id })} />
        )}
        {view.name === 'reports' && <ReportsView />}
        {view.name === 'conflicts' && <ConflictsView />}
        {view.name === 'audit' && <AuditView />}
        {view.name === 'admin' && <AdminView />}
      </main>
    </div>
  );
}

function NavItem({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  tone?: 'danger';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className="nav-item" aria-current={active ? 'page' : undefined} onClick={onClick}>
      {label}
      {count !== undefined && count > 0 && (
        <span className="count" data-tone={tone}>
          {count}
        </span>
      )}
    </button>
  );
}

function LoginView({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(identifier, password);
      setTokens(result.accessToken, result.refreshToken);
      onSignedIn({ id: result.user.id, name: result.user.name, role: result.user.role as Role });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <div className="brand">UNKI GEOTECH</div>
          <h1 style={{ fontSize: 22, margin: '4px 0 0' }}>Geology dashboard</h1>
        </div>
        <label>
          <span className="label">Employee number</span>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          <span className="label">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="banner">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
