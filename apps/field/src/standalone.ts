import { PLACEHOLDER_REFERENCE_DATA, DEFAULT_CONVENTION, newLocalId } from '@geotech/core';
import type { ReferenceBundle, ReferenceWorkplace } from './api/client.js';
import { db, type StoredSession } from './db/database.js';

/**
 * Standalone deployment: everything the networked build fetches from the
 * server, provided locally instead.
 *
 * The reference data below is the neutral placeholder set. It exists so the
 * application is usable out of the box; it is **not** Unki geological
 * terminology. A mine replaces it by importing its own reference file in
 * Settings, which is the standalone equivalent of the administration panel.
 */

/**
 * A generic hierarchy so a device is never unusable on first run. Codes are
 * deliberately obvious placeholders — nobody should mistake them for a real
 * mine layout.
 */
function seedWorkplaces(): ReferenceWorkplace[] {
  const workplaces: ReferenceWorkplace[] = [];
  for (const level of ['L1', 'L2', 'L3']) {
    for (const section of ['N', 'S']) {
      for (const panel of [1, 2, 3, 4]) {
        const code = `${level}${section}P${panel}`;
        workplaces.push({
          id: code,
          code,
          name: `${level} ${section} panel ${panel} (example)`,
          workplaceType: 'PANEL',
          panel: `P${panel}`,
          drive: null,
          stope: null,
          face: null,
          sectionId: `${level}${section}`,
          sectionCode: section,
          levelCode: level,
          mineCode: 'EXAMPLE',
        });
      }
    }
  }
  return workplaces;
}

export function standaloneReference(): ReferenceBundle {
  return {
    fetchedAt: new Date().toISOString(),
    convention: DEFAULT_CONVENTION,
    referenceLists: PLACEHOLDER_REFERENCE_DATA,
    validationRules: [],
    workplaces: seedWorkplaces(),
  };
}

/** Loads the cached bundle, seeding it on first run. */
export async function ensureStandaloneReference(): Promise<ReferenceBundle> {
  const cached = await db.reference.get('bundle');
  if (cached) return cached.payload as ReferenceBundle;

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
