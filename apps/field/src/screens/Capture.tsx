import { useState } from 'react';
import {
  mintProvisionalRecordId,
  newLocalId,
  normaliseSampleNumber,
  validateHazard,
  validateObservation,
  validateSample,
  type Hazard,
  type Observation,
  type Photo,
  type Sample,
} from '@geotech/core';
import { ChipGroup } from '../components/Chips.js';
import { IssueList } from '../components/Issues.js';
import { MeasurementField } from '../components/Keypad.js';
import { Header, Screen } from '../components/Layout.js';
import { PhotoCapture } from '../components/PhotoCapture.js';
import { CONFIDENCE_OPTIONS, useOptions } from '../components/refs.js';
import { db } from '../db/database.js';
import { sampleNumberExists } from '../db/repository.js';
import { useApp } from '../state/app.js';

const mint = (prefix: 'GEO' | 'HAZ', deviceId: string) =>
  mintProvisionalRecordId({ site: 'UNK', prefix, deviceId, localSequence: Math.floor(Math.random() * 900000) + 1 });

/* ── geological observation (§10) ─────────────────────────────────────── */

export function ObservationScreen({ faceLogLocalId }: { faceLogLocalId: string }) {
  const { session, reference, pop, showToast } = useApp();
  const [observationType, setObservationType] = useState<string | null>(null);
  const [materialCode, setMaterialCode] = useState<string | null>(null);
  const [contactTypeCode, setContactTypeCode] = useState<string | null>(null);
  const [width, setWidth] = useState('');
  const [strike, setStrike] = useState('');
  const [dip, setDip] = useState('');
  const [dipDirection, setDipDirection] = useState('');
  const [confidence, setConfidence] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const draft: Partial<Observation> = {
    observationType: observationType ?? undefined,
    materialCode,
    contactTypeCode,
    width: width ? Number(width) : null,
    strike: strike ? Number(strike) : null,
    dip: dip ? Number(dip) : null,
    dipDirection: dipDirection ? Number(dipDirection) : null,
    measurementSource: strike || dip || dipDirection ? 'MANUAL' : null,
    confidence: (confidence as Observation['confidence']) ?? null,
    description: description || null,
  };

  const validation = validateObservation(draft, {
    convention: reference.convention,
    lists: reference.lists,
    rules: reference.rules,
  });

  const save = async () => {
    if (!session || !observationType) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const observation: Observation = {
        localId: newLocalId(),
        recordId: mint('GEO', session.deviceId),
        faceLogLocalId,
        observationType,
        description: description || null,
        materialCode,
        contactTypeCode,
        width: width ? Number(width) : null,
        strike: strike ? Number(strike) : null,
        dip: dip ? Number(dip) : null,
        dipDirection: dipDirection ? Number(dipDirection) : null,
        measurementSource: strike || dip || dipDirection ? 'MANUAL' : null,
        confidence: (confidence as Observation['confidence']) ?? null,
        observedById: session.userId,
        observedAt: now,
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED',
        createdAt: now,
        updatedAt: now,
      };
      await db.observations.put(observation);
      showToast(`Observation ${observation.recordId} saved on this device.`);
      pop();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Geological observation" onBack={pop} />
      <Screen>
        <ChipGroup label="What did you observe?" options={useOptions('observation_type')} value={observationType} onChange={setObservationType} />
        <ChipGroup label="Material / lithology" options={useOptions('lithology')} value={materialCode} onChange={setMaterialCode} />
        <ChipGroup label="Contact type" options={useOptions('contact_type')} value={contactTypeCode} onChange={setContactTypeCode} />
        <MeasurementField label="Width" unit="m" value={width} onChange={setWidth} />
        <MeasurementField label="Strike" unit="°" value={strike} onChange={setStrike} />
        <MeasurementField label="Dip" unit="°" value={dip} onChange={setDip} />
        <MeasurementField label="Dip direction" unit="°" value={dipDirection} onChange={setDipDirection} />
        <ChipGroup label="Geological confidence" options={CONFIDENCE_OPTIONS} value={confidence} onChange={setConfidence} />
        <label>
          <span className="label">Notes</span>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <IssueList issues={validation.issues} />
      </Screen>
      <div className="action-bar">
        <button className="btn btn-primary btn-block btn-lg" onClick={() => void save()} disabled={!validation.ok || saving}>
          SAVE OBSERVATION
        </button>
      </div>
    </>
  );
}

/* ── sampling (§16) ───────────────────────────────────────────────────── */

export function SampleScreen({ faceLogLocalId }: { faceLogLocalId: string }) {
  const { session, reference, pop, showToast } = useApp();
  const [sampleNumber, setSampleNumber] = useState('');
  const [sampleType, setSampleType] = useState<string | null>(null);
  const [materialCode, setMaterialCode] = useState<string | null>(null);
  const [fromPosition, setFromPosition] = useState('');
  const [toPosition, setToPosition] = useState('');
  const [reefClassification, setReefClassification] = useState<string | null>(null);
  const [containerRef, setContainerRef] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);

  const length =
    fromPosition && toPosition ? Math.abs(Number(toPosition) - Number(fromPosition)) : undefined;

  const draft: Partial<Sample> = {
    sampleNumber: sampleNumber || undefined,
    sampleType: sampleType ?? undefined,
    materialCode,
    fromPosition: fromPosition ? Number(fromPosition) : null,
    toPosition: toPosition ? Number(toPosition) : null,
    length: length ?? null,
    reefClassification,
  };

  const validation = validateSample(draft, { convention: reference.convention, rules: reference.rules });

  // Checked on the device so a clash is caught at the face rather than at sync.
  const checkNumber = async (value: string) => {
    setSampleNumber(value);
    setDuplicate(value ? await sampleNumberExists(value) : false);
  };

  const save = async () => {
    if (!session || !sampleType || !sampleNumber || duplicate) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const sample: Sample = {
        localId: newLocalId(),
        faceLogLocalId,
        sampleNumber: normaliseSampleNumber(sampleNumber),
        sampleType,
        materialCode,
        fromPosition: fromPosition ? Number(fromPosition) : null,
        toPosition: toPosition ? Number(toPosition) : null,
        length: length ?? null,
        reefClassification,
        containerRef: containerRef || null,
        collectedAt: now,
        collectedById: session.userId,
        status: 'COLLECTED',
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED',
        createdAt: now,
        updatedAt: now,
      };
      await db.samples.put(sample);
      showToast(`Sample ${sample.sampleNumber} saved on this device.`);
      pop();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Sample" onBack={pop} />
      <Screen>
        <label>
          <span className="label">Sample number</span>
          <input
            className="input input-mono"
            value={sampleNumber}
            onChange={(e) => void checkNumber(e.target.value)}
            autoCapitalize="characters"
            placeholder="Write this on the bag"
          />
        </label>
        {duplicate && (
          <div className="issue" data-severity="ERROR">
            <span className="issue-tag">FIX</span>
            <span>This sample number is already used on this device. Every sample number must be unique — renumber it now, before the bag is sealed.</span>
          </div>
        )}
        <ChipGroup label="Sample type" options={useOptions('sample_type')} value={sampleType} onChange={setSampleType} />
        <ChipGroup label="Material" options={useOptions('lithology')} value={materialCode} onChange={setMaterialCode} />
        <ChipGroup
          label="Classification"
          options={[
            { code: 'REEF', label: 'Reef' },
            { code: 'HW', label: 'Hangingwall' },
            { code: 'FW', label: 'Footwall' },
          ]}
          value={reefClassification}
          onChange={setReefClassification}
        />
        <MeasurementField label="From position" unit="m" value={fromPosition} onChange={setFromPosition} />
        <MeasurementField label="To position" unit="m" value={toPosition} onChange={setToPosition} />
        {length !== undefined && (
          <div className="card row">
            <span className="label" style={{ margin: 0 }}>Length</span>
            <div className="spacer" />
            <span className="value">{length.toFixed(2)} m</span>
          </div>
        )}
        <label>
          <span className="label">Bag / container reference</span>
          <input className="input input-mono" value={containerRef} onChange={(e) => setContainerRef(e.target.value)} autoCapitalize="characters" />
        </label>
        <IssueList issues={validation.issues} />
      </Screen>
      <div className="action-bar">
        <button className="btn btn-primary btn-block btn-lg" onClick={() => void save()} disabled={!validation.ok || duplicate || saving}>
          SAVE SAMPLE
        </button>
      </div>
    </>
  );
}

/* ── geological hazard (§17) ──────────────────────────────────────────── */

export function HazardScreen({ faceLogLocalId }: { faceLogLocalId: string }) {
  const { session, reference, pop, showToast } = useApp();
  const [hazardType, setHazardType] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  const [notifiedPerson, setNotifiedPerson] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);

  const draft: Partial<Hazard> = {
    hazardType: hazardType ?? undefined,
    severity: severity ?? undefined,
    description: description || undefined,
    action: action || null,
    notifiedPerson: notifiedPerson || null,
  };
  const validation = validateHazard(draft, { rules: reference.rules, hasPhoto: photos.length > 0 });

  const save = async () => {
    if (!session || !hazardType || !severity) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const hazard: Hazard = {
        localId: newLocalId(),
        recordId: mint('HAZ', session.deviceId),
        faceLogLocalId,
        hazardType,
        severity,
        description,
        action: action || null,
        notifiedPerson: notifiedPerson || null,
        status: 'OPEN',
        raisedById: session.userId,
        raisedAt: now,
        deviceId: session.deviceId,
        version: 1,
        syncState: 'LOCAL_SAVED',
        createdAt: now,
        updatedAt: now,
      };
      await db.transaction('rw', db.hazards, db.photos, async () => {
        await db.hazards.put(hazard);
        for (const photo of photos) await db.photos.update(photo.localId, { faceLogLocalId });
      });
      showToast('Hazard recorded. Report it through the normal mine procedure as well.');
      pop();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Geological hazard" onBack={pop} />
      <Screen>
        <div className="card card-danger small">
          This records a geological hazard for the geology team. It <strong>does not</strong> replace the mine formal
          hazard reporting procedure — report through the normal channel as well.
        </div>
        <ChipGroup label="Hazard type" options={useOptions('hazard_type')} value={hazardType} onChange={setHazardType} tone="danger" />
        <ChipGroup label="Severity" options={useOptions('hazard_severity')} value={severity} onChange={setSeverity} tone="danger" />
        <label>
          <span className="label">What did you see?</span>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          <span className="label">Immediate action taken</span>
          <textarea className="textarea" value={action} onChange={(e) => setAction(e.target.value)} />
        </label>
        <label>
          <span className="label">Person or team notified</span>
          <input className="input" value={notifiedPerson} onChange={(e) => setNotifiedPerson(e.target.value)} />
        </label>
        {session && (
          <PhotoCapture
            faceLogLocalId={faceLogLocalId}
            deviceId={session.deviceId}
            userId={session.userId}
            onCaptured={(photo) => setPhotos((p) => [...p, photo])}
          />
        )}
        <IssueList issues={validation.issues} />
      </Screen>
      <div className="action-bar">
        <button className="btn btn-primary btn-block btn-lg" onClick={() => void save()} disabled={!validation.ok || saving}>
          RECORD HAZARD
        </button>
      </div>
    </>
  );
}

/* ── face photography (§8) ────────────────────────────────────────────── */

export function PhotoScreen({ faceLogLocalId }: { faceLogLocalId: string }) {
  const { session, pop } = useApp();
  return (
    <>
      <Header title="Face photograph" onBack={pop} />
      <Screen>
        {session && <PhotoCapture faceLogLocalId={faceLogLocalId} deviceId={session.deviceId} userId={session.userId} />}
        <span className="small muted">
          Photographs are held on this device at full geological detail and upload after the records they belong to.
        </span>
      </Screen>
      <div className="action-bar">
        <button className="btn btn-primary btn-block btn-lg" onClick={pop}>
          DONE
        </button>
      </div>
    </>
  );
}
