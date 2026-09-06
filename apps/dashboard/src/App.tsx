import { useEffect, useState } from 'react';
import { type Role } from '@geotech/core';
import { api, hasSession, setTokens } from './api.js';
import { ManagementView } from './views/Management.js';
import { ReportsView } from './views/Tools.js';

/**
 * Two screens.
 *
 * The Chief Geologist cut the rest — overview, search, review queue, conflicts,
 * audit trail and administration — on the grounds that the application should
 * do one thing: get the offsets off the face and in front of the people who
 * act on them. The server still holds the review and audit machinery and still
 * enforces it; nothing here can reach it, which is a different thing from it
 * not being there.
 */
type View = { name: 'management' } | { name: 'reports' };

interface User {
  id: string;
  name: string;
  role: Role;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>({ name: 'management' });
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

  if (checking) return <div className="login-wrap">Loading…</div>;
  if (!user) return <LoginView onSignedIn={setUser} />;

  const go = (next: View) => setView(next);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">UNKI GEOTECH</div>
        <div className="brand-name">Geology</div>

        <NavItem label="Management" active={view.name === 'management'} onClick={() => go({ name: 'management' })} />
        <NavItem label="Reports" active={view.name === 'reports'} onClick={() => go({ name: 'reports' })} />

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
        {view.name === 'management' && <ManagementView />}
        {view.name === 'reports' && <ReportsView />}
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
