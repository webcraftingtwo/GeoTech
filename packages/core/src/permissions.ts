/**
 * Role-based access (§3, §31).
 *
 * This matrix is the single definition of who may do what, imported by the API
 * (where it is enforced) and by both front ends (where it decides what to
 * render). Hiding a button is a courtesy; the server check is the control.
 *
 * Two boundaries here are not conveniences and must never be relaxed:
 *
 *  - No role may edit a submitted **observation**. Corrections are versions.
 *  - No role, including ADMIN, may modify or delete the **audit log**.
 */

import type { Role } from './types.js';

export type Action =
  | 'facelog:create'
  | 'facelog:edit_own_draft'
  | 'facelog:submit'
  | 'facelog:read_own'
  | 'facelog:read_all'
  | 'observation:create'
  | 'observation:edit_submitted'
  | 'interpretation:write'
  | 'review:decide'
  | 'conflict:resolve'
  | 'hazard:create'
  | 'hazard:close'
  | 'sample:create'
  | 'report:generate'
  | 'report:export'
  | 'refdata:manage'
  | 'user:manage'
  | 'rules:manage'
  | 'audit:read'
  | 'audit:modify'
  | 'settings:manage';

const TECHNICIAN: Action[] = [
  'facelog:create',
  'facelog:edit_own_draft',
  'facelog:submit',
  'facelog:read_own',
  'observation:create',
  'hazard:create',
  'sample:create',
];

const GEOLOGIST: Action[] = [
  ...TECHNICIAN,
  'facelog:read_all',
  'interpretation:write',
  'review:decide',
  'conflict:resolve',
  'hazard:close',
  'report:generate',
  'report:export',
  'audit:read',
];

const SENIOR_GEOLOGIST: Action[] = [
  ...GEOLOGIST,
  'refdata:manage',
  'user:manage',
  'rules:manage',
  'settings:manage',
];

const ADMIN: Action[] = [...SENIOR_GEOLOGIST];

const MATRIX: Record<Role, Action[]> = {
  TECHNICIAN: TECHNICIAN,
  GEOLOGIST: GEOLOGIST,
  SENIOR_GEOLOGIST: SENIOR_GEOLOGIST,
  ADMIN: ADMIN,
};

/**
 * `observation:edit_submitted` and `audit:modify` appear in no role's list.
 * They are enumerated as actions precisely so that a future change granting
 * them has to be deliberate and visible in a diff.
 */
export function can(role: Role, action: Action): boolean {
  return MATRIX[role].includes(action);
}

export function actionsFor(role: Role): Action[] {
  return [...MATRIX[role]];
}

/** Whether a technician may still edit a record in this status. */
export function canEditRecord(role: Role, status: string, isOwner: boolean): boolean {
  if (status === 'DRAFT') return isOwner || role === 'ADMIN' || role === 'SENIOR_GEOLOGIST';
  // Once submitted, the observation is fixed for everyone. A geologist adds an
  // interpretation alongside it; a technician answers a clarification request.
  return false;
}

export function isReviewer(role: Role): boolean {
  return role === 'GEOLOGIST' || role === 'SENIOR_GEOLOGIST' || role === 'ADMIN';
}

export function isAdministrator(role: Role): boolean {
  return role === 'SENIOR_GEOLOGIST' || role === 'ADMIN';
}
