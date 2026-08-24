import { useState } from 'react';
import {
  deriveThrowHeave,
  mintProvisionalRecordId,
  newLocalId,
  validateOffset,
  type GeologicalOffset,
  type Observation,
  type Photo,
  type Structure,
} from '@geotech/core';
import { ChipGroup } from '../components/Chips.js';
import { IssueList } from '../components/Issues.js';
import { MeasurementField } from '../components/Keypad.js';
import { OrientationCapture, emptyOrientation } from '../components/Orientation.js';
import { Header, Screen, Steps } from '../components/Layout.js';
import { OffsetDiagram } from '../components/OffsetDiagram.js';
import { PhotoCapture } from '../components/PhotoCapture.js';
import { CONFIDENCE_OPTIONS, useOptions } from '../components/refs.js';
import { db } from '../db/database.js';
import { useApp } from '../state/app.js';

/**
 * Record offset (§12) — the workflow this product exists for.
 *
 * Six steps, target under ninety seconds with gloves on. The last step is the
 * one that earns its place: the section is generated from what was entered and
 * shown back while the technician is still at the face, where a wrong sense of
 * displacement costs seconds to fix rather than a return trip underground.
 */
const STEPS = ['Which structure?', 'What is displaced?', 'How much?', 'How sure are you?', 'Photograph', 'Check and save'];

export function OffsetWorkflowScreen({ faceLogLocalId }: { faceLogLocalId: string }) {
  const { session, reference, pop, showToast } = useApp();
  const [step, setStep] = useState(0);

  const [structureType, setStructureType] = useState<string | null>(null);
  const [markerType, setMarkerType] = useState<string | null>(null);
  const [markerRef, setMarkerRef] = useState('');
  const [apparentOffset, setApparentOffset] = useState('');
  const [lateralSense, setLateralSense] = useState<string | null>(null);
  const [verticalSense, setVerticalSense] = useState<string | null>(null);
  const [orientation, setOrientation] = useState(emptyOrientation);
  const { strike, dip, dipDirection } = orientation;
  const [measurementMethod, setMeasurementMethod] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [structureRef, setStructureRef] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);

  const structureOptions = useOptions('structure_type');
  const markerOptions = useOptions('marker_type');
  const methodOptions = useOptions('measurement_method');

  const offsetValue = apparentOffset ? Number(apparentOffset) : undefined;

  const draft: Partial<GeologicalOffset> = {
    markerType: markerType ?? undefined,
    markerRef: markerRef || null,
    apparentOffset: offsetValue,
    unit: reference.convention.defaultUnit,
    lateralSense: (lateralSense as GeologicalOffset['lateralSense']) ?? null,
    verticalSense: (verticalSense as GeologicalOffset['verticalSense']) ?? null,
    strike: strike ? Number(strike) : null,
    dip: dip ? Number(dip) : null,
    dipDirection: dipDirection ? Number(dipDirection) : null,
    measurementMethod: measurementMethod ?? null,
    confidence: (confidence as GeologicalOffset['confidence']) ?? null,
  };

  const validation = validateOffset(draft, {
    convention: reference.convention,
    lists: reference.lists,
    rules: reference.rules,
    hasPhoto: photos.length > 0,
  });

  // Offered as an arithmetic aid only. It is shown to the technician, never
  // written into an observed field — resolving an apparent offset into throw
  // and heave is the geologist's interpretation to make (§13).
  const derived = offsetValue && dip ? deriveThrowHeave(offsetValue, Number(dip)) : null;

  const canAdvance = () => {
    if (step === 0) return Boolean(structureType);
    if (step === 1) return Boolean(markerType);
    if (step === 2) return Boolean(apparentOffset);
    return true;
  };

  const save = async () => {
    if (!session || !structureType || !markerType || !offsetValue) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const seq = () => Math.floor(Math.random() * 900000) + 1;
      const mint = (prefix: 'GEO' | 'STR' | 'OFS') =>
        mintProvisionalRecordId({ site: 'UNK', prefix, deviceId: session.deviceId, localSequence: seq() });

      const observationLocalId = newLocalId();
      const structureLocalId = newLocalId();
      const offsetLocalId = newLocalId();

      const observation: Observation = {
        localId: observationLocalId,
        recordId: mint('GEO'),
        faceLogLocalId,
        observationType: structureType,
        confidence: (confidence as Observation['confidence']) ?? null,
        observedById: session.userId,
        observedAt: now,
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED',
        createdAt: now,
        updatedAt: now,
      };

      const structure: Structure = {
        localId: structureLocalId,
        observationLocalId,
        structureType,
        strike: strike ? Number(strike) : null,
        dip: dip ? Number(dip) : null,
        dipDirection: dipDirection ? Number(dipDirection) : null,
        measurementSource: orientation.source,
        confidence: (confidence as Structure['confidence']) ?? null,
        structureRef: structureRef ? structureRef.trim().toUpperCase() : null,
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED',
        createdAt: now,
        updatedAt: now,
      };

      const offset: GeologicalOffset = {
        localId: offsetLocalId,
        recordId: mint('OFS'),
        structureLocalId,
        markerType,
        markerRef: markerRef || null,
        apparentOffset: offsetValue,
        unit: reference.convention.defaultUnit,
        lateralSense: (lateralSense as GeologicalOffset['lateralSense']) ?? null,
        verticalSense: (verticalSense as GeologicalOffset['verticalSense']) ?? null,
        strike: strike ? Number(strike) : null,
        dip: dip ? Number(dip) : null,
        dipDirection: dipDirection ? Number(dipDirection) : null,
        measurementMethod: measurementMethod ?? null,
        measurementSource: orientation.source,
        confidence: (confidence as GeologicalOffset['confidence']) ?? null,
        observedById: session.userId,
        observedAt: now,
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED',
        createdAt: now,
        updatedAt: now,
      };

      // One transaction: an offset without its structure is not a record.
      await db.transaction('rw', db.observations, db.structures, db.offsets, db.photos, async () => {
        await db.observations.put(observation);
        await db.structures.put(structure);
        await db.offsets.put(offset);
        for (const photo of photos) {
          await db.photos.update(photo.localId, {
            observationLocalId,
            offsetLocalId,
            faceLogLocalId,
          });
        }
      });

      showToast(`Offset ${offset.recordId} saved on this device.`);
      pop();
    } catch (err) {
      showToast(`Could not save: ${(err as Error).message} Nothing you entered has been lost.`, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Record offset" onBack={step === 0 ? pop : () => setStep((s) => s - 1)} />
      <Screen>
        <Steps total={STEPS.length} current={step} />
        <h2 className="step-question">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="stack">
            <ChipGroup options={structureOptions} value={structureType} onChange={setStructureType} />
            <label>
              <span className="label">Structure reference (if it is a known structure)</span>
              <input
                className="input input-mono"
                value={structureRef}
                onChange={(e) => setStructureRef(e.target.value)}
                placeholder="e.g. F-012"
                autoCapitalize="characters"
              />
              <span className="small muted">
                Naming the structure is what lets the geologist follow it between levels later.
              </span>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <ChipGroup label="Geological marker" options={markerOptions} value={markerType} onChange={setMarkerType} />
            <label>
              <span className="label">Marker reference (optional)</span>
              <input className="input input-mono" value={markerRef} onChange={(e) => setMarkerRef(e.target.value)} autoCapitalize="characters" />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <MeasurementField
              label="Apparent offset"
              unit={reference.convention.defaultUnit.toLowerCase()}
              value={apparentOffset}
              onChange={setApparentOffset}
              allowNegative={reference.convention.allowNegativeOffset}
              hint="Measured across the structure. Direction is recorded separately."
            />
            <ChipGroup
              label="Which way does the far side step?"
              options={[
                { code: 'UP', label: '↑ UP' },
                { code: 'DOWN', label: '↓ DOWN' },
              ]}
              value={verticalSense}
              onChange={setVerticalSense}
            />
            <ChipGroup
              label="And laterally?"
              options={[
                { code: 'LEFT', label: '← LEFT' },
                { code: 'RIGHT', label: 'RIGHT →' },
              ]}
              value={lateralSense}
              onChange={setLateralSense}
            />
            <ChipGroup label="How was it measured?" options={methodOptions} value={measurementMethod} onChange={setMeasurementMethod} />
            <OrientationCapture value={orientation} onChange={setOrientation} />
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <ChipGroup options={CONFIDENCE_OPTIONS} value={confidence} onChange={setConfidence} />
            <div className="card small muted">
              <strong style={{ color: 'var(--text)' }}>HIGH</strong> — clear observation, reliable measurement.
              <br />
              <strong style={{ color: 'var(--text)' }}>MEDIUM</strong> — reasonably clear, some uncertainty.
              <br />
              <strong style={{ color: 'var(--text)' }}>LOW</strong> — uncertain. Still worth recording.
            </div>
          </div>
        )}

        {step === 4 && session && (
          <div className="stack">
            <PhotoCapture
              faceLogLocalId={faceLogLocalId}
              deviceId={session.deviceId}
              userId={session.userId}
              onCaptured={(photo) => setPhotos((p) => [...p, photo])}
            />
            <span className="small muted">
              A photograph is the only way this measurement can be checked later. Strongly encouraged, never required.
            </span>
          </div>
        )}

        {step === 5 && offsetValue !== undefined && (
          <div className="stack">
            <div className="card card-accent stack">
              <span className="label">Generated section — check this matches the face</span>
              <OffsetDiagram
                input={{
                  apparentOffset: offsetValue,
                  unit: reference.convention.defaultUnit.toLowerCase(),
                  markerLabel: markerType ?? 'Marker',
                  structureLabel: structureType ?? 'Structure',
                  verticalSense: verticalSense as 'UP' | 'DOWN' | null,
                  lateralSense: lateralSense as 'LEFT' | 'RIGHT' | null,
                  confidence: confidence as 'HIGH' | 'MEDIUM' | 'LOW' | null,
                }}
              />
            </div>

            {derived && (
              <div className="card stack">
                <span className="label">For information only</span>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <span className="label">Throw</span>
                    <span className="value">≈ {derived.throw} m</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <span className="label">Heave</span>
                    <span className="value">≈ {derived.heave} m</span>
                  </div>
                </div>
                <span className="small muted">
                  Arithmetic from your apparent offset and dip, assuming dip-slip. This is not saved as a measurement —
                  resolving the displacement is the geologist's interpretation to make.
                </span>
              </div>
            )}

            <IssueList issues={validation.issues} />
          </div>
        )}
      </Screen>

      <div className="action-bar">
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary btn-block btn-lg" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
            NEXT
          </button>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" onClick={() => void save()} disabled={!validation.ok || saving}>
            {saving ? 'Saving…' : 'SAVE OFFSET'}
          </button>
        )}
      </div>
    </>
  );
}
