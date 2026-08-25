import { useMemo, useState } from 'react';
import {
  mintProvisionalRecordId,
  newLocalId,
  scoreRecord,
  validateFaceLog,
  type FaceLog,
  type Observation,
  type Photo,
} from '@geotech/core';
import { ChipGroup } from '../components/Chips.js';
import { IssueList } from '../components/Issues.js';
import { MeasurementField } from '../components/Keypad.js';
import { Header, Screen, Steps } from '../components/Layout.js';
import { PhotoCapture } from '../components/PhotoCapture.js';
import { QualityMeter } from '../components/Quality.js';
import { CONFIDENCE_OPTIONS, useOptions } from '../components/refs.js';
import { db } from '../db/database.js';
import { queueForSync, savePreferences, submitFaceLog } from '../db/repository.js';
import { useApp } from '../state/app.js';

/**
 * New face log (§7, §34).
 *
 * Progressive disclosure: seven short questions rather than one long form.
 * Anything the system already knows — technician, date, shift, last workplace,
 * coordinate system — is filled in and shown for confirmation, never asked (§2).
 */
const STEPS = [
  'Where are you?',
  'Shift details',
  'Where exactly?',
  'Photograph the face',
  'What did you observe?',
  'Measurements',
  'Review and save',
];

export function NewFaceLogScreen() {
  const { session, reference, pop, push, showToast } = useApp();
  const [step, setStep] = useState(0);

  const [localId] = useState(() => newLocalId());
  const [recordId] = useState(() =>
    mintProvisionalRecordId({
      site: 'UNK',
      prefix: 'FL',
      deviceId: session?.deviceId ?? 'device',
      localSequence: Math.floor(Math.random() * 900000) + 1,
    }),
  );

  const [workplaceId, setWorkplaceId] = useState<string | null>(null);
  const [levelCode, setLevelCode] = useState<string | null>(null);
  const [shift, setShift] = useState<string | null>(null);
  const [surveyReference, setSurveyReference] = useState('');
  const [faceAdvance, setFaceAdvance] = useState('');
  const [locationMethod, setLocationMethod] = useState<string | null>('SURVEY_STATION');
  const [locationConfidence, setLocationConfidence] = useState<string | null>('HIGH');
  const [observationType, setObservationType] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [strike, setStrike] = useState('');
  const [dip, setDip] = useState('');
  const [dipDirection, setDipDirection] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);

  const shiftOptions = useOptions('shift');
  const observationOptions = useOptions('observation_type');
  const methodOptions = useOptions('location_method');

  const levels = useMemo(
    () => [...new Set(reference.workplaces.map((w) => w.levelCode))].sort(),
    [reference.workplaces],
  );
  const workplacesOnLevel = useMemo(
    () => reference.workplaces.filter((w) => !levelCode || w.levelCode === levelCode),
    [reference.workplaces, levelCode],
  );

  const draft: Partial<FaceLog> = {
    localId,
    recordId,
    workplaceId: workplaceId ?? undefined,
    technicianId: session?.userId,
    shiftDate: new Date().toISOString(),
    shift: shift ?? undefined,
    surveyReference: surveyReference || null,
    faceAdvance: faceAdvance ? Number(faceAdvance) : null,
    locationMethod: (locationMethod as FaceLog['locationMethod']) ?? null,
    locationConfidence: (locationConfidence as FaceLog['locationConfidence']) ?? null,
    notes: notes || null,
  };

  const validation = validateFaceLog(draft, {
    convention: reference.convention,
    lists: reference.lists,
    rules: reference.rules,
    hasPhoto: photos.length > 0,
    hasObservation: observationType != null,
  });

  const quality = scoreRecord({
    hasLocation: Boolean(surveyReference),
    hasPhoto: photos.length > 0,
    structurePresent: ['FAULT', 'DYKE', 'SHEAR', 'JOINT'].includes(observationType ?? ''),
    structureClassified: observationType != null,
    orientationRecorded: Boolean(strike && dip && dipDirection),
    offsetPresent: false,
    offsetRecorded: false,
    observationConfidence: (confidence as 'HIGH' | 'MEDIUM' | 'LOW' | null) ?? null,
    requiredFieldsComplete: validation.ok,
    hasObservation: observationType != null,
  });

  const canAdvance = () => {
    if (step === 0) return Boolean(workplaceId);
    if (step === 2) return Boolean(surveyReference);
    return true;
  };

  const save = async (submit: boolean) => {
    if (!session) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const faceLog: FaceLog = {
        localId,
        recordId,
        workplaceId: workplaceId!,
        technicianId: session.userId,
        shiftDate: now,
        shift: shift ?? '',
        surveyReference: surveyReference || null,
        faceAdvance: faceAdvance ? Number(faceAdvance) : null,
        locationMethod: (locationMethod as FaceLog['locationMethod']) ?? null,
        locationConfidence: (locationConfidence as FaceLog['locationConfidence']) ?? null,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        notes: notes || null,
        deviceId: session.deviceId,
        version: 1,
        syncState: submit ? 'PENDING_SYNC' : 'DRAFT',
        createdAt: now,
        updatedAt: now,
        ...(submit ? { submittedAt: now } : {}),
      };

      await db.transaction('rw', db.faceLogs, db.observations, db.photos, async () => {
        await db.faceLogs.put(faceLog);

        if (observationType) {
          const observation: Observation = {
            localId: newLocalId(),
            recordId: mintProvisionalRecordId({
              site: 'UNK',
              prefix: 'GEO',
              deviceId: session.deviceId,
              localSequence: Math.floor(Math.random() * 900000) + 1,
            }),
            faceLogLocalId: localId,
            observationType,
            confidence: (confidence as Observation['confidence']) ?? null,
            strike: strike ? Number(strike) : null,
            dip: dip ? Number(dip) : null,
            dipDirection: dipDirection ? Number(dipDirection) : null,
            measurementSource: strike || dip || dipDirection ? 'MANUAL' : null,
            observedById: session.userId,
            observedAt: now,
            deviceId: session.deviceId,
            version: 1,
            syncState: submit ? 'PENDING_SYNC' : 'DRAFT',
            createdAt: now,
            updatedAt: now,
          };
          await db.observations.put(observation);
        }

        // Photographs were written as they were taken; attach them to the log.
        for (const photo of photos) {
          await db.photos.update(photo.localId, { faceLogLocalId: localId });
        }
      });

      // Remembered so the next log opens where the technician already is.
      await savePreferences({ lastWorkplaceId: workplaceId ?? undefined, lastShift: shift ?? undefined });

      if (submit) {
        await submitFaceLog(localId);
        showToast('Saved on this device and queued to sync.');
        pop();
      } else {
        await queueForSync('faceLogs', localId).catch(() => undefined);
        showToast('Draft saved on this device.');
        push({ name: 'faceLog', localId });
      }
    } catch (err) {
      showToast(`Could not save: ${(err as Error).message} Your entries are still on screen.`, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="New face log" subtitle={recordId} onBack={step === 0 ? pop : () => setStep((s) => s - 1)} />
      <Screen>
        <Steps total={STEPS.length} current={step} />
        <h2 className="step-question">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="stack">
            <ChipGroup label="Level" options={levels.map((l) => ({ code: l, label: l }))} value={levelCode} onChange={setLevelCode} />
            <ChipGroup
              label="Working place"
              options={workplacesOnLevel.map((w) => ({ code: w.id, label: `${w.code} · ${w.name}` }))}
              value={workplaceId}
              onChange={setWorkplaceId}
            />
            {reference.workplaces.length === 0 && (
              <div className="issue" data-severity="ERROR">
                <span className="issue-tag">FIX</span>
                <span>No workplaces are cached on this device. Connect once on surface to download the workplace list.</span>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <div className="card stack">
              <div>
                <span className="label">Technician</span>
                <div className="value">{session?.name}</div>
              </div>
              <div>
                <span className="label">Date</span>
                <div className="value">{new Date().toISOString().slice(0, 10)}</div>
              </div>
              <div>
                <span className="label">Started</span>
                <div className="value">{new Date().toTimeString().slice(0, 5)}</div>
              </div>
              <span className="small muted">Filled in automatically. Change the shift below if it is wrong.</span>
            </div>
            <ChipGroup label="Shift" options={shiftOptions} value={shift} onChange={setShift} />
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <label>
              <span className="label">Survey station or reference</span>
              <input
                className="input input-mono"
                value={surveyReference}
                onChange={(e) => setSurveyReference(e.target.value)}
                placeholder="e.g. PEG-1255"
                autoCapitalize="characters"
              />
            </label>
            <MeasurementField label="Face advance" unit="m" value={faceAdvance} onChange={setFaceAdvance} />
            <ChipGroup label="How was the position established?" options={methodOptions} value={locationMethod} onChange={setLocationMethod} />
            <ChipGroup label="Location confidence" options={CONFIDENCE_OPTIONS} value={locationConfidence} onChange={setLocationConfidence} />
            <span className="small muted">
              The survey reference is the primary underground location. GPS is not expected to work down here.
            </span>
          </div>
        )}

        {step === 3 && session && (
          <PhotoCapture
            faceLogLocalId={localId}
            deviceId={session.deviceId}
            userId={session.userId}
            onCaptured={(photo) => setPhotos((p) => [...p, photo])}
          />
        )}

        {step === 4 && (
          <div className="stack">
            <ChipGroup label="Observation type" options={observationOptions} value={observationType} onChange={setObservationType} />
            <ChipGroup label="Geological confidence" options={CONFIDENCE_OPTIONS} value={confidence} onChange={setConfidence} />
            <span className="small muted">LOW confidence is a valid, useful answer. Recording it is what matters.</span>
          </div>
        )}

        {step === 5 && (
          <div className="stack">
            <MeasurementField label="Strike" unit="°" value={strike} onChange={setStrike} />
            <MeasurementField label="Dip" unit="°" value={dip} onChange={setDip} />
            <MeasurementField label="Dip direction" unit="°" value={dipDirection} onChange={setDipDirection} />
            <span className="small muted">Manual readings. Leave blank if the structure could not be measured.</span>
          </div>
        )}

        {step === 6 && (
          <div className="stack">
            <div className="card stack">
              <QualityMeter score={quality} />
            </div>
            <IssueList issues={validation.issues} />
            <label>
              <span className="label">Notes</span>
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the geologist should know" />
            </label>
          </div>
        )}
      </Screen>

      <div className="action-bar">
        {step < STEPS.length - 1 ? (
          <>
            <button className="btn" onClick={() => void save(false)} disabled={!workplaceId || saving}>
              Save draft
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
              NEXT
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => void save(false)} disabled={saving}>
              Save draft
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void save(true)} disabled={!validation.ok || saving}>
              {saving ? 'Saving…' : 'SAVE & QUEUE'}
            </button>
          </>
        )}
      </div>
    </>
  );
}
