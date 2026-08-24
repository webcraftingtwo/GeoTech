import type { SyncBatch, SyncBatchResult } from '@geotech/core';
import { db } from '../db/database.js';

const BASE = '/api/v1';

export class ApiUnavailable extends Error {
  constructor(message = 'No connection to the server.') {
    super(message);
    this.name = 'ApiUnavailable';
  }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function token(): Promise<string | null> {
  const session = await db.session.get('session');
  return session?.accessToken ?? null;
}

/**
 * A network failure and a server refusal are different things and are never
 * conflated: the first means "try again later", the second means "this record
 * needs a person". The sync engine treats them differently.
 */
async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
  if (auth) {
    const t = await token();
    if (t) headers.set('authorization', `Bearer ${t}`);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiUnavailable();
  }

  if (response.status === 401 && auth) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, auth);
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = body?.error ?? {};
    throw new ApiError(response.status, err.code ?? 'unknown', err.message ?? 'The server refused this request.', err.details);
  }
  return body as T;
}

async function tryRefresh(): Promise<boolean> {
  const session = await db.session.get('session');
  if (!session?.refreshToken) return false;
  try {
    const result = await request<{ accessToken: string; refreshToken: string; offlineGrant: string | null }>(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) },
      false,
    );
    await db.session.put({
      ...session,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      offlineGrant: result.offlineGrant,
      savedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  offlineGrant: string | null;
  offlineGrantExpiresInHours: number;
  user: { id: string; name: string; employeeNo: string; email: string; role: string; permissions: string[] };
}

export const api = {
  login: (identifier: string, password: string, deviceId: string) =>
    request<LoginResult>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ identifier, password, deviceId, platform: navigator.userAgent }) },
      false,
    ),

  reference: () => request<ReferenceBundle>('/sync/reference'),

  syncBatch: (batch: SyncBatch) =>
    request<SyncBatchResult & { replayed?: boolean }>('/sync/batch', {
      method: 'POST',
      body: JSON.stringify(batch),
    }),

  uploadPhoto: async (localId: string, blob: Blob) => {
    const form = new FormData();
    form.append('file', blob, `${localId}.jpg`);
    const t = await token();
    let response: Response;
    try {
      response = await fetch(`${BASE}/photos/${localId}/upload`, {
        method: 'POST',
        headers: t ? { authorization: `Bearer ${t}` } : {},
        body: form,
      });
    } catch {
      throw new ApiUnavailable();
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.error?.code ?? 'upload_failed', body?.error?.message ?? 'The photograph could not be uploaded.');
    }
    return response.json() as Promise<{ ok: boolean; storageKey: string }>;
  },

  health: () => request<{ status: string }>('/health'.replace('/api/v1', ''), {}, false),
};

export interface ReferenceWorkplace {
  id: string;
  code: string;
  name: string;
  workplaceType: string;
  panel?: string | null;
  drive?: string | null;
  stope?: string | null;
  face?: string | null;
  sectionId: string;
  sectionCode: string;
  levelCode: string;
  mineCode: string;
}

export interface ReferenceBundle {
  fetchedAt: string;
  convention: import('@geotech/core').MeasurementConvention;
  referenceLists: import('@geotech/core').RefList[];
  validationRules: import('@geotech/core').ConfigurableRule[];
  workplaces: ReferenceWorkplace[];
}
