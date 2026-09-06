/**
 * How this build is deployed.
 *
 * The same source produces two products:
 *
 *  - **networked** (default): the full system. Sign-in, synchronisation,
 *    server-enforced roles, central audit trail. This is what a permanent
 *    geological record requires.
 *
 *  - **standalone**: a single self-contained file with no server behind it.
 *    Capture is identical — the device was always the system of record until
 *    sync — but the shift leaves the device as a hand-over file instead of
 *    syncing, and there is no server to enforce anything.
 *
 * The distinction is surfaced to the user rather than hidden. A technician
 * should never be unsure whether their work is going anywhere.
 */

export type Deployment = 'networked' | 'standalone';

export const DEPLOYMENT: Deployment =
  (import.meta.env.VITE_DEPLOYMENT as Deployment | undefined) === 'standalone' ? 'standalone' : 'networked';

export const IS_STANDALONE = DEPLOYMENT === 'standalone';

export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0';

/**
 * The mine this build is for. Recorded on every face log beside the
 * overseer's acknowledgement, because the acknowledgement is a named person
 * declaring something at a named mine — a signature with neither is not one.
 */
export const MINE_NAME = (import.meta.env.VITE_MINE_NAME as string | undefined) ?? 'Unki Mines';

/* ── storage capability ───────────────────────────────────────────────
   The whole product rests on the device holding records safely. If it
   cannot, the technician has to be told before they capture a shift —
   not after. A browser opened from a file:// path commonly denies
   IndexedDB, and a private window may deny it too.
   ─────────────────────────────────────────────────────────────────── */

export type StorageState =
  | { usable: true; persisted: boolean }
  | { usable: false; reason: string; remedy: string };

export async function probeStorage(): Promise<StorageState> {
  if (typeof indexedDB === 'undefined') {
    return {
      usable: false,
      reason: 'This browser does not provide the local database the application needs.',
      remedy: 'Open the application in Chrome, Edge or Firefox.',
    };
  }

  const openedOk = await new Promise<boolean>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('geotech-storage-probe', 1);
    } catch {
      resolve(false);
      return;
    }
    request.onsuccess = () => {
      request.result.close();
      try {
        indexedDB.deleteDatabase('geotech-storage-probe');
      } catch {
        /* deletion failing does not affect the answer */
      }
      resolve(true);
    };
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
    // A probe that never answers is a failed probe.
    window.setTimeout(() => resolve(false), 3000);
  });

  if (!openedOk) {
    const fromFile = window.location.protocol === 'file:';
    return {
      usable: false,
      reason: fromFile
        ? 'The browser blocks local storage for pages opened directly from a file, so nothing captured here could be saved.'
        : 'The browser refused access to local storage, so nothing captured here could be saved.',
      remedy: fromFile
        ? 'Put this file on a web server or an intranet share and open it over http or https. No installation is needed — any static host will do.'
        : 'Leave private browsing, or allow site data for this address, then reload.',
    };
  }

  // Persistent storage stops the browser evicting a shift's records under
  // disk pressure. Best-effort: not every browser grants or exposes it.
  let persisted = false;
  try {
    if (navigator.storage?.persist) persisted = await navigator.storage.persist();
    else if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    persisted = false;
  }

  return { usable: true, persisted };
}
