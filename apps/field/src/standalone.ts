import { PLACEHOLDER_REFERENCE_DATA, DEFAULT_CONVENTION, newLocalId } from '@geotech/core';
import type { ReferenceBundle, ReferenceWorkplace } from './api/client.js';
import { db, type StoredSession } from './db/database.js';

/**
 * Standalone deployment: everything the networked build fetches from the
 * server, provided locally instead.
 *
 * The geological terminology follows UNKI-MIN-MRM-STD-201 (BMSZ Marking & Face
 * Measurements). Working places are named the way Unki names them — section
 * and bord, "14 South bord 5" — and the sections listed below are a starting
 * list rather than the mine's establishment. Everything here is replaced by
 * importing the mine's own reference file in Settings, which is the standalone
 * equivalent of the administration panel.
 */

/**
 * Bumped whenever the built-in list below changes, so a device that has only
 * ever used the built-in list picks up the new one on the next application
 * update. A list the mine imported carries no seed version and is never
 * replaced by an update.
 */
export const SEED_VERSION = 2;

/**
 * Sections and bords so a device is usable on first run.
 *
 * Unki names a working place by its section and bord — "14 South bord 5" —
 * with a strike belt per section (UNKI-MIN-MRM-STD-201 §9.1). There is no
 * level in the name.
 *
 * The range below covers the sections in production and is a starting list,
 * not the mine's establishment. Survey holds the authoritative list; loading
 * it in Settings replaces everything here, and the imported list is then never
 * overwritten by an application update.
 */
function seedWorkplaces(): ReferenceWorkplace[] {
  const sections = [
    { code: '11N', name: '11 North', bords: 9 },
    { code: '11S', name: '11 South', bords: 9 },
    { code: '12N', name: '12 North', bords: 9 },
    { code: '12S', name: '12 South', bords: 9 },
    { code: '13N', name: '13 North', bords: 9 },
    { code: '13S', name: '13 South', bords: 9 },
    { code: '14N', name: '14 North', bords: 9 },
    { code: '14S', name: '14 South', bords: 9 },
  ];

  const workplaces: ReferenceWorkplace[] = [];
  for (const section of sections) {
    for (let bord = 1; bord <= section.bords; bord++) {
      const code = `${section.code}-B${bord}`;
      workplaces.push({
        id: code,
        code,
        name: `${section.name} bord ${bord}`,
        workplaceType: 'BORD',
        bord: String(bord),
        strikeBelt: null,
        drive: null,
        stope: null,
        face: null,
        sectionId: section.code,
        sectionCode: section.code,
        sectionName: section.name,
        mineCode: 'EXAMPLE',
      });
    }
    workplaces.push({
      id: `${section.code}-SB`,
      code: `${section.code}-SB`,
      name: `${section.name} strike belt`,
      workplaceType: 'STRIKE_BELT',
      bord: null,
      strikeBelt: section.code,
      drive: null,
      stope: null,
      face: null,
      sectionId: section.code,
      sectionCode: section.code,
      sectionName: section.name,
      mineCode: 'EXAMPLE',
    });
  }
  return workplaces;
}

export function standaloneReference(): ReferenceBundle {
  return {
    fetchedAt: new Date().toISOString(),
    seedVersion: SEED_VERSION,
    convention: DEFAULT_CONVENTION,
    referenceLists: PLACEHOLDER_REFERENCE_DATA,
    validationRules: [],
    workplaces: seedWorkplaces(),
  };
}

/**
 * Loads the cached bundle, seeding it on first run.
 *
 * A device that has only ever used the built-in list is brought up to date
 * when the application is updated — otherwise a technician who opened an
 * earlier copy keeps its working places for ever, and the correction never
 * reaches the one person it was made for.
 *
 * A list the mine imported has no seed version and is left exactly as it is.
 * Replacing that would silently discard the mine's own establishment, which is
 * the opposite of what an update should do.
 */
export async function ensureStandaloneReference(): Promise<ReferenceBundle> {
  const cached = await db.reference.get('bundle');
  const payload = cached?.payload as ReferenceBundle | undefined;

  if (payload) {
    const isBuiltIn = typeof payload.seedVersion === 'number';
    if (!isBuiltIn || payload.seedVersion! >= SEED_VERSION) return payload;
  }

  const bundle = standaloneReference();
  await db.reference.put({ key: 'bundle', fetchedAt: bundle.fetchedAt, payload: bundle });
  return bundle;
}

/**
 * Replaces the reference data from a file the mine provides.
 *
 * Accepts either a full bundle exported from a networked deployment's
 * `/sync/reference` endpoint, or a trimmed file containing only the parts a
 * mine wants to override. Anything absent keeps its current value, so a mine
 * can supply only its workplace list without having to restate every
 * geological term.
 */
export async function importReference(raw: unknown): Promise<{ ok: boolean; message: string }> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'That file could not be read as reference data.' };
  }
  const incoming = raw as Partial<ReferenceBundle>;
  const current = await ensureStandaloneReference();

  const hasAnything =
    Array.isArray(incoming.workplaces) ||
    Array.isArray(incoming.referenceLists) ||
    Boolean(incoming.convention);
  if (!hasAnything) {
    return {
      ok: false,
      message:
        'That file contains no workplaces, reference lists or measurement convention. Check it was exported from Unki GeoTech.',
    };
  }

  const merged: ReferenceBundle = {
    fetchedAt: new Date().toISOString(),
    // No seed version: this is the mine's list now, and an application update
    // must not replace it.
    convention: incoming.convention ?? current.convention,
    referenceLists: incoming.referenceLists ?? current.referenceLists,
    validationRules: incoming.validationRules ?? current.validationRules,
    workplaces: incoming.workplaces ?? current.workplaces,
  };

  await db.reference.put({ key: 'bundle', fetchedAt: merged.fetchedAt, payload: merged });

  const parts: string[] = [];
  if (incoming.workplaces) parts.push(`${incoming.workplaces.length} workplaces`);
  if (incoming.referenceLists) parts.push(`${incoming.referenceLists.length} reference lists`);
  if (incoming.convention) parts.push('measurement convention');

  return { ok: true, message: `Loaded ${parts.join(', ')}. Restart is not required.` };
}

/**
 * Signs a technician in locally.
 *
 * There is no password, and the interface says so plainly. Without a server
 * there is nothing to verify a password against, and a password box that
 * accepts anything is worse than no password box: it implies a protection
 * that is not there. The name entered is recorded as the observer on every
 * record, so it is identification, not authentication.
 */
export async function standaloneSignIn(args: {
  name: string;
  employeeNo: string;
  deviceId: string;
}): Promise<StoredSession> {
  const existing = await db.session.get('session');

  const session: StoredSession = {
    key: 'session',
    // Kept stable across sign-ins on the same device, so a technician who
    // signs in again is the same author on their earlier records.
    userId: existing?.employeeNo === args.employeeNo.trim().toUpperCase() ? existing.userId : newLocalId(),
    name: args.name.trim(),
    employeeNo: args.employeeNo.trim().toUpperCase(),
    role: 'TECHNICIAN',
    accessToken: '',
    refreshToken: '',
    offlineGrant: null,
    offlineGrantExpiresAt: null,
    deviceId: args.deviceId,
    savedAt: new Date().toISOString(),
  };

  await db.session.put(session);
  return session;
}
