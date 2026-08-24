import { useCallback, useEffect, useState } from 'react';
import type { MeasurementSource } from '@geotech/core';
import { MeasurementField } from './Keypad.js';

/**
 * Orientation capture (§15).
 *
 * The device compass is offered where the hardware provides one, and the
 * reading is tagged `SENSOR` so it is never mistaken for a hand-held compass
 * reading — still less for a survey measurement. A device compass underground
 * sits inside a steel-supported excavation next to electrical infrastructure;
 * it is an aid, not an instrument, and this component says so rather than
 * implying otherwise by staying silent.
 *
 * Manual entry is always available and always wins: editing any value by hand
 * drops the whole reading back to `MANUAL`, because a half-sensor,
 * half-typed orientation has no meaningful provenance.
 */

interface OrientationReading {
  strike: string;
  dip: string;
  dipDirection: string;
  source: MeasurementSource | null;
}

type SensorState = 'unsupported' | 'idle' | 'requesting' | 'reading' | 'denied';

interface DeviceOrientationEventWithPermission extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

export function OrientationCapture({
  value,
  onChange,
  compact = false,
}: {
  value: OrientationReading;
  onChange: (next: OrientationReading) => void;
  compact?: boolean;
}) {
  const [sensor, setSensor] = useState<SensorState>('idle');
  const [live, setLive] = useState<{ heading: number; tilt: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) setSensor('unsupported');
  }, []);

  const stop = useCallback((handler: (e: DeviceOrientationEvent) => void) => {
    window.removeEventListener('deviceorientation', handler);
  }, []);

  const read = useCallback(async () => {
    if (sensor === 'unsupported') return;
    setSensor('requesting');

    // iOS requires an explicit grant, triggered by a user gesture.
    const requestPermission = (
      DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
    ).requestPermission;
    if (typeof requestPermission === 'function') {
      try {
        const outcome = await requestPermission();
        if (outcome !== 'granted') {
          setSensor('denied');
          return;
        }
      } catch {
        setSensor('denied');
        return;
      }
    }

    setSensor('reading');
    const handler = (event: DeviceOrientationEvent) => {
      const e = event as DeviceOrientationEventWithPermission;
      const heading = e.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) % 360 : null);
      if (heading == null) return;
      setLive({ heading: Math.round(heading), tilt: Math.round(Math.abs(e.beta ?? 0)) });
    };
    window.addEventListener('deviceorientation', handler);

    // A single sample from a moving hand is noise. Ten seconds of live readout
    // lets the technician steady the device and watch the value settle.
    window.setTimeout(() => {
      stop(handler);
      setSensor('idle');
    }, 10_000);
  }, [sensor, stop]);

  const acceptReading = () => {
    if (!live) return;
    const dip = Math.min(90, live.tilt);
    onChange({
      // Dip direction from the compass; strike derived by the right-hand rule.
      dipDirection: String(live.heading),
      strike: String((live.heading + 270) % 360),
      dip: String(dip),
      source: 'SENSOR',
    });
  };

  // Any hand edit invalidates the sensor provenance for the whole reading.
  const setManual = (field: 'strike' | 'dip' | 'dipDirection', next: string) => {
    onChange({ ...value, [field]: next, source: next === '' && !value.strike && !value.dip ? null : 'MANUAL' });
  };

  return (
    <div className="stack">
      {!compact && <span className="label">Orientation</span>}

      <MeasurementField label="Strike" unit="°" value={value.strike} onChange={(v) => setManual('strike', v)} />
      <MeasurementField label="Dip" unit="°" value={value.dip} onChange={(v) => setManual('dip', v)} />
      <MeasurementField label="Dip direction" unit="°" value={value.dipDirection} onChange={(v) => setManual('dipDirection', v)} />

      <div className="card stack" style={{ gap: 8 }}>
        <div className="row">
          <span className="label" style={{ margin: 0 }}>
            Measurement source
          </span>
          <div className="spacer" />
          <span className="state-badge" data-state={value.source === 'SENSOR' ? 'PENDING_SYNC' : 'SYNCED'}>
            {value.source ?? 'NOT SET'}
          </span>
        </div>

        {sensor === 'unsupported' ? (
          <span className="small muted">This device has no orientation sensor. Enter the reading by hand.</span>
        ) : sensor === 'denied' ? (
          <span className="small muted">
            Sensor access was refused. Enter the reading by hand, or allow motion access in the device settings.
          </span>
        ) : (
          <>
            <button type="button" className="btn btn-block" onClick={() => void read()} disabled={sensor === 'requesting'}>
              {sensor === 'reading' ? 'Reading… hold the device against the plane' : '📱 Read from device compass'}
            </button>
            {live && (
              <>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <span className="label">Heading</span>
                    <span className="value">{live.heading}°</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <span className="label">Tilt</span>
                    <span className="value">{live.tilt}°</span>
                  </div>
                </div>
                <button type="button" className="btn btn-primary btn-block" onClick={acceptReading}>
                  Use this reading
                </button>
              </>
            )}
          </>
        )}

        <span className="small muted">
          A device compass is an aid, not an instrument: it is affected by steel support, rail and electrical
          infrastructure, and it is never survey-grade. Calibrate by rotating the device in a figure of eight away from
          steel before reading, and check the value against a hand-held compass where the structure matters.
        </span>
      </div>
    </div>
  );
}

export const emptyOrientation = (): OrientationReading => ({ strike: '', dip: '', dipDirection: '', source: null });
export type { OrientationReading };
