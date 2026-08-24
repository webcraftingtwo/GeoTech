/**
 * Development seed.
 *
 * IMPORTANT: every geological term loaded here is a neutral placeholder so the
 * application is runnable and testable. None of it is official Unki geological
 * terminology, and none of it should reach production. Authorized mine
 * personnel enter the mine-approved lists through the administration panel
 * before any real use (§39).
 */
import { existsSync } from 'node:fs';
import { DEFAULT_CONVENTION, PLACEHOLDER_REFERENCE_DATA } from '@geotech/core';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding reference data (placeholder terminology — not official mine codes)…');

  for (const list of PLACEHOLDER_REFERENCE_DATA) {
    const saved = await prisma.refList.upsert({
      where: { code: list.code },
      create: { code: list.code, name: list.name, description: list.description, mineSpecific: list.mineSpecific },
      update: { name: list.name, description: list.description, mineSpecific: list.mineSpecific },
    });
    for (const item of list.items) {
      await prisma.refItem.upsert({
        where: { listId_code: { listId: saved.id, code: item.code } },
        create: {
          listId: saved.id,
          code: item.code,
          label: item.label,
          sortOrder: item.sortOrder,
          active: item.active,
          meta: item.meta ?? undefined,
        },
        update: { label: item.label, sortOrder: item.sortOrder, active: item.active, meta: item.meta ?? undefined },
      });
    }
  }

  await prisma.measurementConventionConfig.upsert({
    where: { key: 'default' },
    create: { key: 'default', ...DEFAULT_CONVENTION },
    update: DEFAULT_CONVENTION,
  });

  console.log('Seeding mine hierarchy (placeholder)…');
  const mine = await prisma.mine.upsert({
    where: { code: 'DEMO' },
    create: { code: 'DEMO', name: 'Demonstration Mine' },
    update: {},
  });

  const workplaces: { id: string; code: string }[] = [];
  for (const levelCode of ['L10', 'L12']) {
    const level = await prisma.level.upsert({
      where: { mineId_code: { mineId: mine.id, code: levelCode } },
      create: { mineId: mine.id, code: levelCode, name: `${levelCode} Level` },
      update: {},
    });
    for (const sectionCode of ['N', 'S']) {
      const section = await prisma.section.upsert({
        where: { levelId_code: { levelId: level.id, code: sectionCode } },
        create: { levelId: level.id, code: sectionCode, name: `${sectionCode} Section` },
        update: {},
      });
      for (const n of [1, 2, 3]) {
        const code = `${levelCode}${sectionCode}P${n}`;
        const wp = await prisma.workplace.upsert({
          where: { sectionId_code: { sectionId: section.id, code } },
          create: {
            sectionId: section.id,
            code,
            name: `${levelCode} ${sectionCode} Panel ${n}`,
            workplaceType: 'PANEL',
            panel: `P${n}`,
          },
          update: {},
        });
        workplaces.push({ id: wp.id, code: wp.code });
      }
    }
  }

  console.log('Seeding demonstration users…');
  // Development credentials only. The account is created with
  // mustChangePassword so it cannot survive into a real deployment unnoticed.
  const password = await hashPassword('ChangeMe123');
  const users = [
    { employeeNo: 'T001', name: 'Demo Technician', email: 'technician@example.test', role: 'TECHNICIAN' as const, department: 'Geology' },
    { employeeNo: 'G001', name: 'Demo Geologist', email: 'geologist@example.test', role: 'GEOLOGIST' as const, department: 'Geology' },
    { employeeNo: 'S001', name: 'Demo Senior Geologist', email: 'senior@example.test', role: 'SENIOR_GEOLOGIST' as const, department: 'Geology' },
    { employeeNo: 'A001', name: 'Demo Administrator', email: 'admin@example.test', role: 'ADMIN' as const, department: 'MRM' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { employeeNo: u.employeeNo },
      create: { ...u, passwordHash: password, mustChangePassword: true },
      update: { name: u.name, role: u.role, department: u.department },
    });
  }

  console.log('\nSeed complete.');
  console.log(`  ${PLACEHOLDER_REFERENCE_DATA.length} reference lists, ${workplaces.length} workplaces, ${users.length} users.`);
  console.log('  Development sign-in: T001 / G001 / S001 / A001 with password "ChangeMe123".');
  console.log('  Placeholder geological terminology — replace with the mine-approved lists before production use.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
