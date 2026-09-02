/**
 * Dashboard API client.
 *
 * Unlike the field app there is no offline queue here: a geologist reviewing at
 * a desk is online, and a stale review decision would be worse than an error
 * message. Failures surface immediately and say what happened.
 */
/**
 * Where the API lives.
 *
 * Defaults to a relative path, which is correct when the front end is served
 * from the same origin as the API (a reverse proxy in front of both, which is
 * the simplest and safest arrangement). Set `VITE_API_URL` at build time to
 * point at a separate origin — e.g. the front end on static hosting and the API
 * elsewhere — and add that origin to the API's `CORS_ORIGINS`.
 */
const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

let accessToken: string | null = sessionStorage.getItem('geotech.token');
let refreshToken: string | null = localStorage.getItem('geotech.refresh');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function setTokens(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
  if (access) sessionStorage.setItem('geotech.token', access);
  else sessionStorage.removeItem('geotech.token');
  if (refresh) localStorage.setItem('geotech.refresh', refresh);
  else localStorage.removeItem('geotech.refresh');
}

export function hasSession(): boolean {
  return Boolean(accessToken);
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${BASE}${path}`, { ...init, headers });

  if (response.status === 401 && retry && refreshToken) {
    const refreshed = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshed.ok) {
      const body = await refreshed.json();
      setTokens(body.accessToken, body.refreshToken);
      return request<T>(path, init, false);
    }
    setTokens(null, null);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv')) return (await response.text()) as unknown as T;

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = body?.error ?? {};
    throw new ApiError(response.status, err.code ?? 'unknown', err.message ?? 'The request failed.', err.details);
  }
  return body as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (identifier: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; user: { id: string; name: string; role: string; permissions: string[] } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ identifier, password }) },
      false,
    ),
  me: () => request<{ id: string; name: string; role: string; permissions: string[] }>('/auth/me'),

  overview: () => request<Record<string, number | string>>('/dashboard/overview'),
  recent: (take = 25) => request<RecentRow[]>(`/dashboard/recent${qs({ take })}`),
  reviewQueue: () => request<{ openHazards: HazardRow[]; faceLogs: FaceLogRow[] }>('/review/queue'),

  faceLogs: (params: Record<string, string | number | undefined> = {}) =>
    request<{ items: FaceLogRow[]; total: number }>(`/face-logs${qs(params)}`),
  faceLog: (id: string) => request<FaceLogDetail>(`/face-logs/${id}`),
  offset: (id: string) => request<OffsetDetail>(`/offsets/${id}`),
  offsets: (params: Record<string, string | number | undefined> = {}) =>
    request<{ items: OffsetRow[] }>(`/offsets${qs(params)}`),
  structureHistory: (structureRef: string) => request<StructureHistory>(`/structures/history/${encodeURIComponent(structureRef)}`),

  review: (entityType: string, entityId: string, body: { status: string; comment?: string }) =>
    request(`/review/${entityType}/${entityId}`, { method: 'POST', body: JSON.stringify(body) }),
  interpret: (body: { entityType: string; entityId: string; field: string; value: unknown; confidence: string; comment?: string }) =>
    request('/interpretations', { method: 'POST', body: JSON.stringify(body) }),

  search: (q: string) => request<SearchResult>(`/search${qs({ q })}`),
  audit: (params: Record<string, string | number | undefined> = {}) =>
    request<{ items: AuditRow[]; total: number }>(`/audit${qs(params)}`),
  recordProvenance: (entityType: string, entityId: string) =>
    request<Provenance>(`/audit/record/${entityType}/${entityId}`),

  conflicts: () => request<ConflictRow[]>('/conflicts'),
  resolveConflict: (id: string, keep: 'LOCAL' | 'SERVER', comment?: string) =>
    request(`/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ keep, comment }) }),

  reportDaily: (date?: string) => request<DailyReport>(`/reports/daily${qs({ date })}`),
  reportHandover: (date?: string) => request<HandoverReport>(`/reports/handover${qs({ date })}`),
  reportCsv: (kind: 'daily' | 'structures' | 'samples', params: Record<string, string | undefined> = {}) =>
    request<string>(`/reports/${kind}${qs({ ...params, format: 'csv' })}`),

  referenceLists: () => request<import('@geotech/core').RefList[]>('/reference-lists'),
  convention: () => request<import('@geotech/core').MeasurementConvention>('/admin/convention'),
  saveConvention: (body: import('@geotech/core').MeasurementConvention) =>
    request('/admin/convention', { method: 'PUT', body: JSON.stringify(body) }),
  upsertRefItem: (listCode: string, body: { code: string; label: string; sortOrder?: number; active?: boolean }) =>
    request(`/admin/reference-lists/${listCode}/items`, { method: 'POST', body: JSON.stringify(body) }),
  retireRefItem: (listCode: string, code: string) =>
    request(`/admin/reference-lists/${listCode}/items/${code}/retire`, { method: 'POST' }),
  users: () => request<UserRow[]>('/admin/users'),
};

/* ── response shapes ──────────────────────────────────────────────────── */

export interface RecentRow {
  id: string;
  recordId: string;
  workplace: string;
  type: string;
  observation: string;
  technician: string;
  status: string;
  confidence: string | null;
  interpreted: boolean;
  observedAt: string;
}

export interface FaceLogRow {
  id: string;
  recordId: string;
  status: string;
  shiftDate: string;
  shift: string;
  surveyReference: string | null;
  dataQuality: number | null;
  submittedAt: string | null;
  technician: { id: string; name: string };
  workplace: { code: string; name: string; bord?: string | null; section: { code: string; name: string } };
  _count?: { observations: number; photos: number; samples: number; hazards: number };
}

export interface HazardRow {
  id: string;
  recordId: string;
  hazardType: string;
  severity: string;
  description: string;
  status: string;
  raisedAt: string;
  faceLog: { workplace: { code: string } };
  raisedBy?: { name: string };
}

export interface OffsetRow {
  id: string;
  recordId: string;
  apparentOffset: number;
  unit: string;
  interpretedThrow: number | null;
  confidence: string | null;
  observedAt: string;
  structure: { structureType: string; structureRef: string | null };
}

export interface FaceLogDetail extends FaceLogRow {
  notes: string | null;
  observations: Array<{
    id: string;
    recordId: string;
    observationType: string;
    confidence: string | null;
    description: string | null;
    structures: Array<{
      id: string;
      recordId: string;
      structureType: string;
      structureRef: string | null;
      strike: number | null;
      dip: number | null;
      dipDirection: number | null;
      measurementSource: string | null;
      offsets: OffsetRow[];
    }>;
  }>;
  samples: Array<{ id: string; sampleNumber: string; sampleType: string; length: number | null; status: string }>;
  faceMeasurements: Array<{
    id: string;
    recordId: string;
    distanceFromPeg: number | null;
    blastNumber: string | null;
    faceLength: number | null;
    stationInterval: number;
    limitSetCode: string;
    limitHangingwall: number;
    limitFootwall: number;
    stations: Array<{ distance: number; hangingwall: number | null; footwall: number | null; reason?: string | null }>;
    stationCount: number;
    measuredCount: number;
    hangingwallBreaches: number;
    footwallBreaches: number;
    meanStopeWidth: number | null;
    minStopeWidth: number | null;
    maxStopeWidth: number | null;
    meanHangingwallOverbreak: number | null;
    measuredAt: string;
    measuredBy: { name: string };
  }>;
  hazards: HazardRow[];
  photos: Array<{ id: string; storageKey: string | null; capturedAt: string }>;
  reviews: Array<{ id: string; status: string; comment: string | null; reviewedAt: string; reviewer: { name: string; role: string } }>;
  versionCount: number;
}

export interface OffsetDetail {
  observed: Record<string, unknown> & { apparentOffset: number; unit: string; confidence: string | null; observedAt: string; observedBy: { name: string } };
  interpreted: { throw: number | null; heave: number | null; confidence: string | null; interpretedAt: string } | null;
  interpretationHistory: Array<{
    id: string;
    field: string;
    value: unknown;
    confidence: string;
    comment: string | null;
    interpretedAt: string;
    supersededById: string | null;
    interpretedBy: { name: string; role: string };
  }>;
  record: OffsetRow & { structure: { structureType: string; structureRef: string | null } };
}

export interface StructureHistory {
  structureRef: string;
  structureType: string;
  occurrences: number;
  observations: Array<{
    offsetId: string;
    recordId: string;
    section: string;
    workplace: string;
    date: string;
    technician: string;
    apparentOffset: number;
    unit: string;
    interpretedThrow: number | null;
    strike: number | null;
    dip: number | null;
    confidence: string | null;
    photoCount: number;
  }>;
  summary: { count: number; min: number; max: number; mean: number } | null;
}

export interface SearchResult {
  parsed: Record<string, unknown>;
  faceLogs: FaceLogRow[];
  offsets: Array<OffsetRow & { structure: { structureType: string; observation: { faceLog: { workplace: { code: string; section: { code: string } } } } } }>;
  samples: Array<{ id: string; sampleNumber: string; sampleType: string }>;
  hazards: Array<{ id: string; recordId: string; hazardType: string; description: string }>;
}

export interface AuditRow {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  deviceId: string | null;
  timestamp: string;
  user: { id: string; name: string; role: string } | null;
}

export interface Provenance {
  audit: AuditRow[];
  versions: Array<{ version: number; createdAt: string; reason: string | null }>;
  reviews: Array<{ status: string; comment: string | null; reviewedAt: string; reviewer: { name: string } }>;
  interpretations: Array<{ field: string; value: unknown; confidence: string; interpretedAt: string; interpretedBy: { name: string } }>;
}

export interface ConflictRow {
  id: string;
  localId: string;
  entityType: string;
  status: string;
  conflict: { conflictingFields: string[]; localVersion: Record<string, unknown>; serverVersion: Record<string, unknown> } | null;
  processedAt: string;
  batch: { deviceId: string; receivedAt: string };
}

export interface DailyReport {
  title: string;
  date: string;
  summary: Record<string, number>;
  rows: Array<Record<string, string | number>>;
  disclaimer: string;
}

export interface HandoverReport {
  title: string;
  date: string;
  keyObservations: Array<{ recordId: string; workplace: string; technician: string; observations: number; status: string }>;
  significantOffsets: Array<{ recordId: string; workplace: string; structureType: string; apparentOffset: number; unit: string; confidence: string | null; diagram: string }>;
  openHazards: Array<{ recordId: string; type: string; severity: string; description: string; status: string; workplace: string }>;
  outstandingReviews: number;
  disclaimer: string;
}

export interface UserRow {
  id: string;
  employeeNo: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  active: boolean;
  lastLoginAt: string | null;
}
