import type { StorageState } from '../deployment.js';

/**
 * Shown when the device cannot hold records.
 *
 * The application refuses to open rather than accepting a shift's work into
 * storage that will not keep it. This is the one screen where blocking the
 * technician is the correct behaviour: everything else in this product exists
 * to make sure an observation is never lost, and capture without storage
 * loses all of it.
 */
export function StorageBlocked({ state }: { state: Extract<StorageState, { usable: false }> }) {
  return (
    <div className="app">
      <div className="screen stack" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="header-title">UNKI GEOTECH</div>
          <h1 style={{ fontSize: 24, margin: '6px 0 0' }}>This device cannot save records</h1>
        </div>

        <div className="card card-danger stack">
          <div>
            <span className="label">What is wrong</span>
            <p style={{ margin: 0 }}>{state.reason}</p>
          </div>
          <div>
            <span className="label">What to do</span>
            <p style={{ margin: 0 }}>{state.remedy}</p>
          </div>
        </div>

        <div className="card small muted">
          Capture is deliberately blocked rather than allowed to fail quietly. An observation recorded here would be
          lost the moment the page closed, and a lost observation means a return trip underground.
        </div>

        <button className="btn btn-primary btn-block btn-lg" onClick={() => window.location.reload()}>
          TRY AGAIN
        </button>
      </div>
    </div>
  );
}
