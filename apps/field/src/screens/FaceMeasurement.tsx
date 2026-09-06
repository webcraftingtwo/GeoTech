import { useMemo, useState } from 'react';
import {
  DEFAULT_FACE_LIMITS,
  STATION_INTERVAL_M,
  activeItems,
  layOutStations,
  MANDATORY_STATIONS_M,
  mintProvisionalRecordId,
  newLocalId,
  summariseFaceMeasurement,
  validateFaceMeasurement,
  type FaceLimits,
  type FaceMeasurement,
  type FaceStation,
} from '@geotech/core';
import { ChipGroup } from '../components/Chips.js';
import { FaceSection } from '../components/FaceSection.js';
import { NumericKeypad } from '../components/Keypad.js';
import { Header, Screen, Steps } from '../components/Layout.js';
import { useOptions } from '../components/refs.js';
import { db } from '../db/database.js';
import { useApp } from '../state/app.js';

/**
 * Face measurement — tape offsets from the BMSZ (STD-201 §9.8).
 *
 * This is the Face Marking Sheet, done on the device. The workflow follows the
 * order the technician actually works in: set the face up once, then walk the
 * stations from the down-dip side to the up-dip side entering two readings at
 * each, then check the section and submit.
 *
 * The section redraws as each reading lands, so a transposed sign or a mistyped
 * decimal shows up as a kink in the trace while the technician is still at the
 * face — the same reason the offset workflow draws its section back.
 */
const STEPS = ['Set up the face', 'Walk the stations', 'Check and submit'];

export function FaceMeasurementScreen({ faceLogLocalId }: { faceLogLocalId: string }) {
  const { session, reference, pop, showToast } = useApp();
  const [step, setStep] = useState(0);

  /* ── setup ─────────────────────────────────────────────────────────── */
  const limitOptions = useMemo(() => {
    const configured = activeItems(reference.lists, 'face_limit_set');
    if (configured.length === 0) return DEFAULT_FACE_LIMITS;
    return configured.map((entry) => ({
      code: entry.code,
      label: entry.label,
      hangingwall: Number(entry.meta?.['hangingwall'] ?? 0),
      footwall: Number(entry.meta?.['footwall'] ?? 0),
    }));
  }, [reference.lists]);

  const methodOptions = useOptions('face_measurement_method');
  const reasonOptions = useOptions('face_breach_reason');

  const [limitCode, setLimitCode] = useState<string | null>(limitOptions[0]?.code ?? null);
  const [faceLength, setFaceLength] = useState('');
  const [distanceFromPeg, setDistanceFromPeg] = useState('');
  const [method, setMethod] = useState<string | null>(null);
  const [designHangingwall, setDesignHangingwall] = useState('');
  const [designFootwall, setDesignFootwall] = useState('');

  /**
   * When the technician started at the BMSZ. Stored with the measurement so
   * the geologist can see how long a face took to walk — a face measured in
   * three minutes and one measured in twenty are not equally trustworthy.
   */
  const [startedAt, setStartedAt] = useState<string | null>(null);

  /* ── capture ───────────────────────────────────────────────────────── */
  const [stations, setStations] = useState<FaceStation[]>([]);
  const [active, setActive] = useState(0);
  const [field, setField] = useState<'hangingwall' | 'footwall'>('hangingwall');
  const [entry, setEntry] = useState('');
  const [saving, setSaving] = useState(false);

  const limits: FaceLimits =
    limitOptions.find((l) => l.code === limitCode) ?? DEFAULT_FACE_LIMITS[0]!;

  const measurement: FaceMeasurement = {
    distanceFromPeg: distanceFromPeg ? Number(distanceFromPeg) : null,
    faceLength: faceLength ? Number(faceLength) : null,
    stationInterval: STATION_INTERVAL_M,
    traverseDirection: 'DOWN_DIP_TO_UP_DIP',
    measurementMethod: (method as FaceMeasurement['measurementMethod']) ?? null,
    limits,
    designCut:
      designHangingwall && designFootwall
        ? { hangingwall: Number(designHangingwall), footwall: Number(designFootwall) }
        : null,
    stations,
  };

  const summary = summariseFaceMeasurement(measurement);
  const validation = validateFaceMeasurement(measurement);
  const current = stations[active];
  const currentAssessment = summary.stations[active];

  const layOut = () => {
    const length = Number(faceLength);
    if (!length) return;
    setStations(layOutStations(length));
    setActive(0);
    setField('hangingwall');
    setEntry('');
    setStartedAt(new Date().toISOString());
  };

  /** Commits the value on the keypad and moves to the next reading. */
  const commit = () => {
    if (!current) return;
    const value = entry === '' ? null : Number(entry);

    setStations((prev) =>
      prev.map((s, i) => (i === active ? { ...s, [field]: value } : s)),
    );

    if (field === 'hangingwall') {
      setField('footwall');
      setEntry(stations[active]?.footwall?.toString() ?? '');
    } else if (active < stations.length - 1) {
      setActive(active + 1);
      setField('hangingwall');
      setEntry(stations[active + 1]?.hangingwall?.toString() ?? '');
    } else {
      setEntry('');
      setStep(2);
    }
  };

  const goToStation = (index: number, next: 'hangingwall' | 'footwall' = 'hangingwall') => {
    setActive(index);
    setField(next);
    setEntry(stations[index]?.[next]?.toString() ?? '');
  };

  const setReason = (reason: string | null) =>
    setStations((prev) => prev.map((s, i) => (i === active ? { ...s, reason } : s)));

  const save = async () => {
    if (!session) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const record = {
        localId: newLocalId(),
        recordId: mintProvisionalRecordId({
          site: 'UNK',
          prefix: 'FMS',
          deviceId: session.deviceId,
          localSequence: Math.floor(Math.random() * 900000) + 1,
        }),
        faceLogLocalId,
        distanceFromPeg: measurement.distanceFromPeg,
        faceLength: measurement.faceLength,
        stationInterval: measurement.stationInterval,
        traverseDirection: measurement.traverseDirection,
        measurementMethod: measurement.measurementMethod,
        // The applied limits travel with the readings, so a later revision
        // cannot reinterpret this face.
        limits,
        designCut: measurement.designCut ?? null,
        stations,
        measuredById: session.userId,
        measuredAt: now,
        startedAt,
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED' as const,
        createdAt: now,
        updatedAt: now,
      };

      await db.faceMeasurements.put(record);
      showToast(`Face measurement ${record.recordId} saved on this device.`);
      pop();
    } catch (err) {
      showToast(`Could not save: ${(err as Error).message} Nothing you entered has been lost.`, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header
        title="Face measurement"
        subtitle={step === 1 ? `${summary.measured}/${summary.total}` : undefined}
        onBack={step === 0 ? pop : () => setStep(step - 1)}
      />
      <Screen>
        <Steps total={STEPS.length} current={step} />
        <h2 className="step-question">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="stack">
            <ChipGroup
              label="Mining-cut limits"
              options={limitOptions.map((l) => ({
                code: l.code,
                label: `${l.label} · ${l.hangingwall.toFixed(2)} / ${l.footwall.toFixed(2)}`,
              }))}
              value={limitCode}
              onChange={setLimitCode}
              allowClear={false}
            />

            <label>
              <span className="label">Face width of the bord (m)</span>
              <input
                className="input input-mono"
                inputMode="decimal"
                value={faceLength}
                onChange={(e) => setFaceLength(e.target.value)}
                placeholder="e.g. 7.2"
              />
            </label>

            <span className="small muted">
              Stations are at {STATION_INTERVAL_M} m, the first {STATION_INTERVAL_M} m from the sidewall. There is no
              station zero, so the face carries one offset fewer than its width in metres. The{' '}
              {MANDATORY_STATIONS_M.join(' m and ')} m offsets must both be read before the face can be saved.
            </span>

            <label>
              <span className="label">Distance from peg to face (m)</span>
              <input
                className="input input-mono"
                inputMode="decimal"
                value={distanceFromPeg}
                onChange={(e) => setDistanceFromPeg(e.target.value)}
                placeholder="e.g. 5.1"
              />
            </label>

            <div className="grid-2">
              <label>
                <span className="label">Design cut H/W (cm)</span>
                <input
                  className="input input-mono"
                  inputMode="numeric"
                  value={designHangingwall}
                  onChange={(e) => setDesignHangingwall(e.target.value)}
                />
              </label>
              <label>
                <span className="label">Design cut F/W (cm)</span>
                <input
                  className="input input-mono"
                  inputMode="numeric"
                  value={designFootwall}
                  onChange={(e) => setDesignFootwall(e.target.value)}
                />
              </label>
            </div>
            <span className="small muted">Optional — leave blank if no design cut was issued for this heading.</span>

            <ChipGroup label="Measured with" options={methodOptions} value={method} onChange={setMethod} />

            <div className="card">
              <span className="label">Applied limits to this face</span>
              <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                <strong style={{ fontSize: 15 }}>{limits.label}</strong>
                <span className="value">
                  {limits.hangingwall} / {limits.footwall} cm
                </span>
              </div>
              <span className="small muted">
                Every reading is judged against these, and they are stored with the measurement. A bord and a decline
                are cut to different profiles — check this is the one you are standing in.
              </span>
            </div>

            {stations.length > 0 && (
              <div className="card small muted">
                {stations.length} offsets laid out at {stations[0]!.distance} to{' '}
                {stations[stations.length - 1]!.distance} m, running down-dip to up-dip (§9.8.iii).
              </div>
            )}
          </div>
        )}

        {step === 1 && current && currentAssessment && (
          <div className="stack">
            <div className="card" style={{ padding: 8 }}>
              <FaceSection measurement={measurement} activeStation={active} onSelectStation={(i) => goToStation(i)} />
            </div>

            <div className="row small muted" style={{ gap: 6 }}>
              <span>Limits:</span>
              <strong style={{ color: 'var(--text)' }}>{limits.label}</strong>
              <span className="value" style={{ fontSize: 13 }}>
                {limits.hangingwall.toFixed(2)} / {limits.footwall.toFixed(2)}
              </span>
            </div>

            <div className="card stack" style={{ gap: 10 }}>
              <div className="row">
                <div>
                  <span className="label">Station</span>
                  <div className="value-lg">{current.distance} m</div>
                </div>
                <div className="spacer" />
                <button className="btn" onClick={() => goToStation(Math.max(0, active - 1))} disabled={active === 0} style={{ minWidth: 56 }}>
                  ‹
                </button>
                <button
                  className="btn"
                  onClick={() => goToStation(Math.min(stations.length - 1, active + 1))}
                  disabled={active === stations.length - 1}
                  style={{ minWidth: 56 }}
                >
                  ›
                </button>
              </div>

              <div className="grid-2">
                {(['hangingwall', 'footwall'] as const).map((which) => {
                  const value = which === 'hangingwall' ? current.hangingwall : current.footwall;
                  const breach =
                    which === 'hangingwall' ? currentAssessment.hangingwallBreach : currentAssessment.footwallBreach;
                  const limit = which === 'hangingwall' ? limits.hangingwall : limits.footwall;
                  return (
                    <button
                      key={which}
                      className="readout"
                      data-active={field === which}
                      style={breach ? { borderColor: 'var(--danger)' } : undefined}
                      onClick={() => goToStation(active, which)}
                    >
                      <div style={{ textAlign: 'left', flex: 1 }}>
                        <span className="label">BMSZ → {which === 'hangingwall' ? 'H/W' : 'F/W'}</span>
                        <span className="value-lg" style={breach ? { color: 'var(--danger)' } : undefined}>
                          {field === which ? entry || '—' : (value ?? '—')}
                        </span>
                        <span className="small muted" style={{ display: 'block' }}>
                          limit {limit.toFixed(2)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {currentAssessment.miningHeight !== null && (
                <div className="row small">
                  <span className="label" style={{ margin: 0 }}>Mining height</span>
                  <div className="spacer" />
                  <span className="value">{currentAssessment.miningHeight} cm</span>
                </div>
              )}
            </div>

            <NumericKeypad
              value={entry}
              onChange={setEntry}
              onNext={commit}
              allowNegative={field === 'footwall'}
              nextLabel={field === 'hangingwall' ? 'F/W' : active === stations.length - 1 ? 'DONE' : 'NEXT'}
            />

            {currentAssessment.breach && (
              <div className="card card-danger stack" style={{ gap: 8 }}>
                <span className="label" style={{ color: 'var(--danger)' }}>
                  Outside the mining-cut limits — reason required
                </span>
                <ChipGroup options={reasonOptions} value={current.reason ?? null} onChange={setReason} tone="danger" />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div className="card" style={{ padding: 8 }}>
              <FaceSection measurement={measurement} onSelectStation={(i) => { goToStation(i); setStep(1); }} />
            </div>

            <div className="card card-accent stack" style={{ gap: 6 }}>
              <span className="label">Limits applied to this face</span>
              <div className="row">
                <strong>{limits.label}</strong>
                <div className="spacer" />
                <span className="value">
                  H/W {limits.hangingwall.toFixed(2)} · F/W {limits.footwall.toFixed(2)}
                </span>
              </div>
              <span className="small muted">
                Every breach below is judged against these values, and they are stored with the readings. Go back to
                setup if this is the wrong set for this heading.
              </span>
            </div>

            <div className="card grid-2" style={{ gap: 14 }}>
              {[
                ['Stations measured', `${summary.measured} / ${summary.total}`, false],
                ['H/W breaches', `${summary.hangingwallBreaches}`, summary.hangingwallBreaches > 0],
                ['F/W breaches', `${summary.footwallBreaches}`, summary.footwallBreaches > 0],
                [
                  'Mean over-break',
                  summary.meanHangingwallOverbreak !== null ? `${summary.meanHangingwallOverbreak} cm` : '—',
                  summary.hangingwallBreaches > 0,
                ],
                ['Mean H/W', summary.meanHangingwall !== null ? `${summary.meanHangingwall} cm` : '—', false],
                ['Mean F/W', summary.meanFootwall !== null ? `${summary.meanFootwall} cm` : '—', false],
                [
                  'Mean mining height',
                  summary.meanMiningHeight !== null ? `${summary.meanMiningHeight} cm` : '—',
                  summary.exceedsFlagHeight,
                ],
                [
                  'Range',
                  summary.minMiningHeight !== null ? `${summary.minMiningHeight}–${summary.maxMiningHeight} cm` : '—',
                  false,
                ],
              ].map(([label, value, bad]) => (
                <div key={label as string}>
                  <span className="label">{label as string}</span>
                  <div className="value" style={bad ? { color: 'var(--danger)' } : undefined}>
                    {value as string}
                  </div>
                </div>
              ))}
            </div>

            {validation.issues.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                {validation.issues.map((issue, i) => (
                  <button
                    key={`${issue.code}-${i}`}
                    className="issue"
                    data-severity={issue.severity}
                    onClick={issue.station !== undefined ? () => { goToStation(issue.station!); setStep(1); } : undefined}
                    style={{ textAlign: 'left', font: 'inherit', width: '100%' }}
                  >
                    <span className="issue-tag">{issue.severity === 'ERROR' ? 'FIX' : 'CHECK'}</span>
                    <span>{issue.message}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Screen>

      <div className="action-bar">
        {step === 0 && (
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={() => {
              layOut();
              setStep(1);
            }}
            disabled={!faceLength || !limitCode}
          >
            LAY OUT STATIONS
          </button>
        )}
        {step === 1 && (
          <>
            <button className="btn" onClick={() => setStep(0)}>
              Set up
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(2)}>
              REVIEW
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button className="btn" onClick={() => setStep(1)}>
              Stations
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => void save()}
              disabled={!validation.ok || saving}
            >
              {saving ? 'Saving…' : 'SAVE MEASUREMENT'}
            </button>
          </>
        )}
      </div>
    </>
  );
}
