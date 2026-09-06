import { useMemo, useState } from 'react';
import {
  CHANNEL_TIE_LIMIT_M,
  mintProvisionalRecordId,
  newLocalId,
  scoreRecord,
  validateFaceLog,
  type FaceLog,
  type Photo,
} from '@geotech/core';
import { ChipGroup } from '../components/Chips.js';
import { IssueList } from '../components/Issues.js';
import { MeasurementField } from '../components/Keypad.js';
import { Header, Screen, Steps } from '../components/Layout.js';
import { PhotoCapture } from '../components/PhotoCapture.js';
import { QualityMeter } from '../components/Quality.js';
import { CONFIDENCE_OPTIONS, useOptions } from '../components/refs.js';
import { MINE_NAME } from '../deployment.js';
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
  'Shift and team',
  'Where exactly?',
  'Channel and ground',
  'Photograph the face',
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
  const [sectionCode, setSectionCode] = useState<string | null>(null);
  const [shift, setShift] = useState<string | null>(null);
  const [surveyReference, setSurveyReference] = useState('');
  const [locationMethod, setLocationMethod] = useState<string | null>('SURVEY_STATION');
  const [locationConfidence, setLocationConfidence] = useState<string | null>('HIGH');

  const [channelId, setChannelId] = useState('');
  const [distanceToChannel, setDistanceToChannel] = useState('');
  const [tarpClass, setTarpClass] = useState<string | null>(null);
  const [xrfReading, setXrfReading] = useState('');

  const [sectionManager, setSectionManager] = useState('');
  const [geologist, setGeologist] = useState('');
  const [shaftGeologist, setShaftGeologist] = useState('');
  const [official, setOfficial] = useState('');
  const [overseer, setOverseer] = useState('');
  const [areaMadeSafe, setAreaMadeSafe] = useState<string | null>(null);

  const [structuralComment, setStructuralComment] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);

  const shiftOptions = useOptions('shift');
  const methodOptions = useOptions('location_method');
  const tarpOptions = useOptions('tarp_class');

  /** Sections, in the order a technician would read them: 11S, 12N, 12S. */
  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of reference.workplaces) seen.set(w.sectionCode, w.sectionName ?? w.sectionCode);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [reference.workplaces]);

  const workplacesInSection = useMemo(
    () => reference.workplaces.filter((w) => !sectionCode || w.sectionCode === sectionCode),
    [reference.workplaces, sectionCode],
  );

  const draft: Partial<FaceLog> = {
    localId,
    recordId,
    workplaceId: workplaceId ?? undefined,
    technicianId: session?.userId,
    shiftDate: new Date().toISOString(),
    shift: shift ?? undefined,
    surveyReference: surveyReference || null,
    locationMethod: (locationMethod as FaceLog['locationMethod']) ?? null,
    locationConfidence: (locationConfidence as FaceLog['locationConfidence']) ?? null,
    channelId: channelId || null,
    distanceToChannel: distanceToChannel ? Number(distanceToChannel) : null,
    tarpClass: tarpClass ?? null,
    xrfReading: xrfReading ? Number(xrfReading) : null,
    sectionManager: sectionManager || null,
    geologist: geologist || null,
    shaftGeologist: shaftGeologist || null,
    official: official || null,
    overseer: overseer || null,
    mineName: MINE_NAME,
    areaMadeSafe: areaMadeSafe === null ? null : areaMadeSafe === 'SAFE',
    structuralComment: structuralComment || null,
    notes: notes || null,
  };

  const validation = validateFaceLog(draft, {
    convention: reference.convention,
    lists: reference.lists,
    rules: reference.rules,
    hasPhoto: photos.length > 0,
  });

  const quality = scoreRecord({
    hasLocation: Boolean(surveyReference),
    hasPhoto: photos.length > 0,
    structurePresent: false,
    structureClassified: false,
    orientationRecorded: false,
    offsetPresent: false,
    offsetRecorded: false,
    observationConfidence: null,
    requiredFieldsComplete: validation.ok,
    hasObservation: false,
  });

  const canAdvance = () => {
    if (step === 0) return Boolean(workplaceId);
    // The area declaration gates the whole log, so it gates this step: a
    // technician should not be filling in a channel number for a face they
    // are not going to be allowed to record.
    if (step === 1) return areaMadeSafe === 'SAFE' && Boolean(overseer.trim());
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
        locationMethod: (locationMethod as FaceLog['locationMethod']) ?? null,
        locationConfidence: (locationConfidence as FaceLog['locationConfidence']) ?? null,
        channelId: channelId || null,
        distanceToChannel: distanceToChannel ? Number(distanceToChannel) : null,
        tarpClass: tarpClass ?? null,
        xrfReading: xrfReading ? Number(xrfReading) : null,
        sectionManager: sectionManager || null,
        geologist: geologist || null,
        shaftGeologist: shaftGeologist || null,
        official: official || null,
        overseer: overseer || null,
        mineName: MINE_NAME,
        areaMadeSafe: areaMadeSafe === 'SAFE',
        structuralComment: structuralComment || null,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        notes: notes || null,
        deviceId: session.deviceId,
        version: 1,
        syncState: submit ? 'PENDING_SYNC' : 'DRAFT',
        createdAt: now,
        updatedAt: now,
        ...(submit ? { submittedAt: now } : {}),
      };

      await db.transaction('rw', db.faceLogs, db.photos, async () => {
        await db.faceLogs.put(faceLog);

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
            <ChipGroup
              label="Section"
              options={sections.map(([code, name]) => ({ code, label: name }))}
              value={sectionCode}
              onChange={(code) => {
                setSectionCode(code);
                setWorkplaceId(null);
              }}
            />
            <ChipGroup
              label="Bord or working place"
              options={workplacesInSection.map((w) => ({
                code: w.id,
                label: w.bord ? `Bord ${w.bord}` : w.name,
              }))}
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

            <div className="card stack">
              <span className="label">Team</span>
              <label>
                <span className="label">Section manager</span>
                <input className="input" value={sectionManager} onChange={(e) => setSectionManager(e.target.value)} />
              </label>
              <label>
                <span className="label">Geologist</span>
                <input className="input" value={geologist} onChange={(e) => setGeologist(e.target.value)} />
              </label>
              <label>
                <span className="label">Shaft geologist</span>
                <input className="input" value={shaftGeologist} onChange={(e) => setShaftGeologist(e.target.value)} />
              </label>
              <label>
                <span className="label">Official</span>
                <input className="input" value={official} onChange={(e) => setOfficial(e.target.value)} />
              </label>
            </div>

            <div className="card stack" data-tone={areaMadeSafe === 'UNSAFE' ? 'danger' : undefined}>
              <span className="label">Overseer acknowledgement — {MINE_NAME}</span>
              <label>
                <span className="label">Overseer</span>
                <input
                  className="input"
                  value={overseer}
                  onChange={(e) => setOverseer(e.target.value)}
                  placeholder="Who declared the area"
                />
              </label>
              <ChipGroup
                label="Area made safe?"
                options={[
                  { code: 'SAFE', label: 'Area made safe' },
                  { code: 'UNSAFE', label: 'Area NOT made safe' },
                ]}
                value={areaMadeSafe}
                onChange={setAreaMadeSafe}
                allowClear={false}
              />
              {areaMadeSafe === 'UNSAFE' && (
                <div className="issue" data-severity="ERROR">
                  <span className="issue-tag">STOP</span>
                  <span>
                    Do not log this face. Leave the working place and report it. Nothing here is worth going to a face
                    that has not been made safe.
                  </span>
                </div>
              )}
              <span className="small muted">
                The one safety control this application carries. Everything else the mine already runs elsewhere.
              </span>
            </div>
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
            <ChipGroup label="How was the position established?" options={methodOptions} value={locationMethod} onChange={setLocationMethod} />
            <ChipGroup label="Location confidence" options={CONFIDENCE_OPTIONS} value={locationConfidence} onChange={setLocationConfidence} />
            <span className="small muted">
              The survey reference is the primary underground location. GPS is not expected to work down here.
            </span>
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <label>
              <span className="label">Channel ID</span>
              <input
                className="input input-mono"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="e.g. CH-1412"
                autoCapitalize="characters"
              />
            </label>
            <MeasurementField
              label="Distance from the channel to the face"
              unit="m"
              value={distanceToChannel}
              onChange={setDistanceToChannel}
            />
            <span className="small muted">
              Past {CHANNEL_TIE_LIMIT_M} m the channel assay can no longer be tied to this face. Record the real
              distance either way — the geologist needs to see it.
            </span>

            <ChipGroup label="TARP system class" options={tarpOptions} value={tarpClass} onChange={setTarpClass} />

            <MeasurementField label="XRF reading (optional)" unit="" value={xrfReading} onChange={setXrfReading} />
            <span className="small muted">Leave blank unless an XRF was taken at this face.</span>
          </div>
        )}

        {step === 4 && session && (
          <PhotoCapture
            faceLogLocalId={localId}
            deviceId={session.deviceId}
            userId={session.userId}
            onCaptured={(photo) => setPhotos((p) => [...p, photo])}
          />
        )}

        {step === 5 && (
          <div className="stack">
            <div className="card stack">
              <QualityMeter score={quality} />
            </div>
            <IssueList issues={validation.issues} />
            <label>
              <span className="label">Structural comment</span>
              <textarea
                className="textarea"
                value={structuralComment}
                onChange={(e) => setStructuralComment(e.target.value)}
                placeholder="What the structure at this face is doing"
              />
            </label>
            <span className="small muted">
              Written here, at the end, because a technician knows the face by the time the readings are in.
            </span>
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
