import { describe, expect, it } from 'vitest';
import { actionsFor, can, canEditRecord, isAdministrator, isReviewer, type Role } from '../src/index.js';

const ALL_ROLES: Role[] = ['TECHNICIAN', 'GEOLOGIST', 'SENIOR_GEOLOGIST', 'ADMIN'];

describe('role boundaries (§3, §31, §49)', () => {
  it('lets a technician capture but not interpret', () => {
    expect(can('TECHNICIAN', 'facelog:create')).toBe(true);
    expect(can('TECHNICIAN', 'observation:create')).toBe(true);
    expect(can('TECHNICIAN', 'interpretation:write')).toBe(false);
    expect(can('TECHNICIAN', 'review:decide')).toBe(false);
  });

  it('keeps administration away from technicians and geologists', () => {
    for (const action of ['refdata:manage', 'user:manage', 'rules:manage', 'settings:manage'] as const) {
      expect(can('TECHNICIAN', action)).toBe(false);
      expect(can('GEOLOGIST', action)).toBe(false);
      expect(can('SENIOR_GEOLOGIST', action)).toBe(true);
      expect(can('ADMIN', action)).toBe(true);
    }
  });

  it('lets geologists interpret, review and resolve conflicts', () => {
    expect(can('GEOLOGIST', 'interpretation:write')).toBe(true);
    expect(can('GEOLOGIST', 'review:decide')).toBe(true);
    expect(can('GEOLOGIST', 'conflict:resolve')).toBe(true);
  });

  it('grants NO role the ability to edit a submitted observation', () => {
    for (const role of ALL_ROLES) expect(can(role, 'observation:edit_submitted')).toBe(false);
  });

  it('grants NO role the ability to modify the audit log', () => {
    for (const role of ALL_ROLES) expect(can(role, 'audit:modify')).toBe(false);
  });

  it('locks a record for editing once it leaves draft, for everyone', () => {
    expect(canEditRecord('TECHNICIAN', 'DRAFT', true)).toBe(true);
    expect(canEditRecord('TECHNICIAN', 'DRAFT', false)).toBe(false);
    for (const role of ALL_ROLES) {
      for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED']) {
        expect(canEditRecord(role, status, true)).toBe(false);
      }
    }
  });

  it('classifies reviewers and administrators', () => {
    expect(isReviewer('TECHNICIAN')).toBe(false);
    expect(isReviewer('GEOLOGIST')).toBe(true);
    expect(isAdministrator('GEOLOGIST')).toBe(false);
    expect(isAdministrator('SENIOR_GEOLOGIST')).toBe(true);
  });

  it('gives each role at least the permissions of the one below it', () => {
    const tech = actionsFor('TECHNICIAN');
    const geo = actionsFor('GEOLOGIST');
    const senior = actionsFor('SENIOR_GEOLOGIST');
    expect(tech.every((a) => geo.includes(a))).toBe(true);
    expect(geo.every((a) => senior.includes(a))).toBe(true);
  });
});
