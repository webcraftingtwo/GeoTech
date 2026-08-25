import { useState } from 'react';
import { IS_STANDALONE } from '../deployment.js';
import { useApp } from '../state/app.js';

export function LoginScreen() {
  if (IS_STANDALONE) return <LocalSignIn />;
  return <ServerSignIn />;
}

/**
 * Standalone deployment: identification, not authentication.
 *
 * There is no password box, and the screen says why. Without a server there is
 * nothing to check a password against, and a box that accepts anything implies
 * a protection that does not exist.
 */
function LocalSignIn() {
  const { signInLocally } = useApp();
  const [name, setName] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInLocally(name, employeeNo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="screen stack" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div className="header-title">UNKI GEOTECH</div>
          <h1 style={{ fontSize: 26, margin: '6px 0 0' }}>Geological field capture</h1>
          <div className="small muted" style={{ marginTop: 6 }}>Standalone — this device only</div>
        </div>

        <form className="card stack" onSubmit={submit}>
          <label>
            <span className="label">Your name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label>
            <span className="label">Employee number</span>
            <input
              className="input input-mono"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              autoCapitalize="characters"
              required
            />
          </label>

          {error && (
            <div className="issue" data-severity="ERROR">
              <span className="issue-tag">FIX</span>
              <span>{error}</span>
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
            {busy ? 'Starting…' : 'START SHIFT'}
          </button>
        </form>

        <div className="card small muted">
          <strong style={{ color: 'var(--text)' }}>No password, and no server.</strong> This build records your
          name against every observation so the geologist knows who made it. It cannot verify who you are — anyone
          holding this device can capture records as anyone. Use the networked build where that matters.
        </div>

        <p className="small muted" style={{ textAlign: 'center', padding: '0 12px' }}>
          A geological data-capture tool. It does not replace mine safety, ground-control or formal hazard
          reporting procedures.
        </p>
      </div>
    </div>
  );
}

function ServerSignIn() {
  const { signIn } = useApp();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'ApiUnavailable'
          ? 'No connection to the server. Sign in on surface before going underground — after that the app works offline for a full shift.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="screen stack" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div className="header-title">UNKI GEOTECH</div>
          <h1 style={{ fontSize: 26, margin: '6px 0 0' }}>Geological field capture</h1>
        </div>

        <form className="card stack" onSubmit={submit}>
          <label>
            <span className="label">Employee number</span>
            <input
              className="input input-mono"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoCapitalize="characters"
              autoComplete="username"
              inputMode="text"
              required
            />
          </label>
          <label>
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="issue" data-severity="ERROR">
              <span className="issue-tag">FIX</span>
              <span>{error}</span>
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'SIGN IN'}
          </button>
        </form>

        <p className="small muted" style={{ textAlign: 'center', padding: '0 12px' }}>
          Sign in while you still have a connection. Your workplace list and geological reference data are then held on
          this device, and you can capture a full shift underground with no network at all.
        </p>
        <p className="small muted" style={{ textAlign: 'center', padding: '0 12px' }}>
          A geological data-capture tool. It does not replace mine safety, ground-control or formal hazard reporting
          procedures.
        </p>
      </div>
    </div>
  );
}
