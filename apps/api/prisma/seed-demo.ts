/**
 * Demonstration geology.
 *
 * Pushes a realistic shift of captured records through the **real sync
 * endpoint** rather than writing to the database directly, so the demo data
 * exercises the same ingest path, validation and audit trail a device would.
 *
 * Placeholder geology for development only — not Unki data.
 */
import { existsSync } from 'node:fs';
import { newLocalId } from '@geotech/core';

if (existsSync('.env')) process.loadEnvFile('.env');

const BASE = process.env['API_BASE'] ?? 'http://localhost:4000/api/v1';

interface Op {
  localId: string;
  entityType: string;
  op: 'CREATE';
  clientVersion: 1;
  payload: Record<string, unknown>;
  queuedAt: string;
}

const op = (entityType: string, payload: Record<string, unknown>): Op => ({
  localId: payload['localId'] as string,
  entityType,
  op: 'CREATE',
  clientVersion: 1,
  payload,
  queuedAt: new Date().toISOString(),
});

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'T001', password: 'ChangeMe123', deviceId: 'demo-device-1' }),
  });
  if (!login.ok) throw new Error(`Sign-in failed (${login.status}). Is the API running and seeded?`);
  const { accessToken, user } = await login.json();

  const workplaces: Array<{ id: string; code: string; levelCode: string }> = (
    await (await fetch(`${BASE}/sync/reference`, { headers: { authorization: `Bearer ${accessToken}` } })).json()
  ).workplaces;

  // The same fault seen at four faces, with the displacement growing along it —
  // exactly the pattern the structure-history view exists to reveal (§23).
  const observations = [
    { workplace: 'L10NP1', offset: 2.1, dip: 55, confidence: 'HIGH', shift: 'MORNING' },
    { workplace: 'L10SP2', offset: 2.3, dip: 57, confidence: 'HIGH', shift: 'MORNING' },
    { workplace: 'L12NP1', offset: 2.5, dip: 57, confidence: 'MEDIUM', shift: 'AFTERNOON' },
    { workplace: 'L12SP3', offset: 2.4, dip: 59, confidence: 'MEDIUM', shift: 'NIGHT' },
  ];

  const operations: Op[] = [];
  let index = 0;

  for (const entry of observations) {
    const workplace = workplaces.find((w) => w.code === entry.workplace);
    if (!workplace) continue;
    index += 1;

    const faceLogId = newLocalId();
    const observationId = newLocalId();
    const structureId = newLocalId();
    const now = new Date(Date.now() - index * 3600_000).toISOString();

    operations.push(
      op('FACE_LOG', {
        localId: faceLogId,
        workplaceId: workplace.id,
        technicianId: user.id,
        shiftDate: now,
        shift: entry.shift,
        surveyReference: `PEG-${1200 + index * 17}`,
        faceAdvance: 1.6 + index * 0.2,
        locationMethod: 'SURVEY_STATION',
        locationConfidence: 'HIGH',
        status: 'SUBMITTED',
      }),
      op('OBSERVATION', {
        localId: observationId,
        faceLogLocalId: faceLogId,
        observationType: 'FAULT',
        description: 'Fault intersects the reef across the full face width.',
        confidence: entry.confidence,
        observedById: user.id,
        observedAt: now,
      }),
      op('REEF_OBSERVATION', {
        localId: newLocalId(),
        faceLogLocalId: faceLogId,
        reefNameCode: 'REEF_A',
        reefWidth: 0.9 + index * 0.05,
        hwLithologyCode: 'NORITE',
        fwLithologyCode: 'PYROXENITE',
        contactQualityCode: 'CLEAR',
        confidence: 'HIGH',
      }),
      op('STRUCTURE', {
        localId: structureId,
        observationLocalId: observationId,
        structureType: 'FAULT',
        structureRef: 'F-012',
        strike: 10 + index,
        dip: entry.dip,
        dipDirection: 100 + index,
        width: 0.15,
        infillCode: 'GOUGE',
        conditionCode: 'SLICKENSIDED',
        measurementSource: 'MANUAL',
        confidence: entry.confidence,
      }),
      op('OFFSET', {
        localId: newLocalId(),
        structureLocalId: structureId,
        markerType: 'REEF',
        markerRef: 'REEF_A',
        apparentOffset: entry.offset,
        unit: 'M',
        verticalSense: 'DOWN',
        lateralSense: 'RIGHT',
        strike: 10 + index,
        dip: entry.dip,
        dipDirection: 100 + index,
        measurementMethod: 'TAPE',
        measurementSource: 'MANUAL',
        confidence: entry.confidence,
        observedById: user.id,
        observedAt: now,
      }),
      op('SAMPLE', {
        localId: newLocalId(),
        faceLogLocalId: faceLogId,
        sampleNumber: `DEMO-SMP-${String(index).padStart(4, '0')}`,
        sampleType: 'CHANNEL',
        materialCode: 'CHROMITITE',
        fromPosition: 0,
        toPosition: 0.9,
        length: 0.9,
        reefClassification: 'REEF',
        collectedAt: now,
        collectedById: user.id,
        status: 'COLLECTED',
      }),
    );

    if (index === 3) {
      operations.push(
        op('HAZARD', {
          localId: newLocalId(),
          faceLogLocalId: faceLogId,
          hazardType: 'SHEAR_ZONE',
          severity: 'HIGH',
          description: 'Shear zone in the hangingwall over the full panel width.',
          action: 'Reported to the shift supervisor; area barricaded pending inspection.',
          notifiedPerson: 'Shift supervisor',
          status: 'OPEN',
          raisedById: user.id,
          raisedAt: now,
        }),
      );
    }
  }

  const response = await fetch(`${BASE}/sync/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      batchId: newLocalId(),
      deviceId: 'demo-device-1',
      sentAt: new Date().toISOString(),
      operations,
    }),
  });

  const result = await response.json();
  const tally = (result.results ?? []).reduce((acc: Record<string, number>, r: { status: string }) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log('Demo geology synced:', tally);
  for (const r of result.results ?? []) {
    if (r.status !== 'APPLIED' && r.status !== 'DUPLICATE') console.log(`  ${r.status}: ${r.message}`);
  }
  console.log('Placeholder geology for development only — not Unki data.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
