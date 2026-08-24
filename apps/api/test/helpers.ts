import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { DEFAULT_CONVENTION, PLACEHOLDER_REFERENCE_DATA } from '@geotech/core';

export async function buildTestApp(): Promise<FastifyInstance> {
  return buildApp(loadEnv());
}

/** Order matters: children before parents. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      sync_operations, sync_batches, audit_logs, record_versions, reviews,
      interpretations, notifications, photos, offsets, structures, observations,
      reef_observations, samples, hazards, face_logs, devices, refresh_tokens,
      workplaces, sections, levels, mines, ref_items, ref_lists,
      validation_rules, measurement_conventions, record_sequences, users
    RESTART IDENTITY CASCADE
  `);
}

export interface Fixtures {
  technician: { id: string; token: string };
  otherTechnician: { id: string; token: string };
  geologist: { id: string; token: string };
  admin: { id: string; token: string };
  workplaceId: string;
}

export async function seedFixtures(app: FastifyInstance): Promise<Fixtures> {
  for (const list of PLACEHOLDER_REFERENCE_DATA) {
    const saved = await prisma.refList.create({
      data: { code: list.code, name: list.name, description: list.description, mineSpecific: list.mineSpecific },
    });
    await prisma.refItem.createMany({
      data: list.items.map((i) => ({
        listId: saved.id,
        code: i.code,
        label: i.label,
        sortOrder: i.sortOrder,
        active: i.active,
      })),
    });
  }
  await prisma.measurementConventionConfig.create({ data: { key: 'default', ...DEFAULT_CONVENTION } });

  const mine = await prisma.mine.create({ data: { code: 'TST', name: 'Test Mine' } });
  const level = await prisma.level.create({ data: { mineId: mine.id, code: 'L12', name: 'Level 12' } });
  const section = await prisma.section.create({ data: { levelId: level.id, code: 'N', name: 'North' } });
  const workplace = await prisma.workplace.create({
    data: { sectionId: section.id, code: 'L12NP1', name: 'Panel 1', workplaceType: 'PANEL', panel: 'P1' },
  });

  const passwordHash = await hashPassword('TestPass123');
  const make = async (employeeNo: string, name: string, email: string, role: 'TECHNICIAN' | 'GEOLOGIST' | 'ADMIN') => {
    const user = await prisma.user.create({ data: { employeeNo, name, email, role, passwordHash } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: employeeNo, password: 'TestPass123', deviceId: `device-${employeeNo}` },
    });
    const body = res.json();
    return { id: user.id, token: body.accessToken as string };
  };

  return {
    technician: await make('T100', 'Test Technician', 't100@example.test', 'TECHNICIAN'),
    otherTechnician: await make('T200', 'Other Technician', 't200@example.test', 'TECHNICIAN'),
    geologist: await make('G100', 'Test Geologist', 'g100@example.test', 'GEOLOGIST'),
    admin: await make('A100', 'Test Administrator', 'a100@example.test', 'ADMIN'),
    workplaceId: workplace.id,
  };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let seq = 0;
export const localId = (prefix = 'l') => `${prefix}-${Date.now()}-${seq++}`;

/** A minimal, valid face-log payload as a device would queue it. */
export function faceLogPayload(workplaceId: string, technicianId: string, id = localId('fl')) {
  return {
    localId: id,
    workplaceId,
    technicianId,
    shiftDate: '2026-02-01T00:00:00.000Z',
    shift: 'MORNING',
    surveyReference: 'PEG-1255',
    faceAdvance: 1.8,
    status: 'SUBMITTED',
  };
}
