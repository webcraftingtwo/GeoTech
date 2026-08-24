import { useState } from 'react';
import { useApp } from '../state/app.js';

export function LoginScreen() {
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
