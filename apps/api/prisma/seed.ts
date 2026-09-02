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

  // Mine hierarchy as Unki works it: sections such as "12 South", each with
  // numbered bords and a strike belt (UNKI-MIN-MRM-STD-201 §9.1). There is no
  // level in this hierarchy.
  console.log('Seeding mine hierarchy…');
  const mine = await prisma.mine.upsert({
    where: { code: 'UNKI' },
    create: { code: 'UNKI', name: 'Unki Mines' },
    update: { name: 'Unki Mines' },
  });

  const sections = [
    { code: '12S', name: '12 South', bords: 9 },
    { code: '12N', name: '12 North', bords: 9 },
    { code: '11S', name: '11 South', bords: 6 },
  ];

  const workplaces: { id: string; code: string }[] = [];
  for (const entry of sections) {
    const section = await prisma.section.upsert({
      where: { mineId_code: { mineId: mine.id, code: entry.code } },
      create: { mineId: mine.id, code: entry.code, name: entry.name },
      update: { name: entry.name },
    });

    for (let n = 1; n <= entry.bords; n++) {
      const code = `${entry.code}-B${n}`;
      const wp = await prisma.workplace.upsert({
        where: { sectionId_code: { sectionId: section.id, code } },
        create: {
          sectionId: section.id,
          code,
          name: `${entry.name} bord ${n}`,
          workplaceType: 'BORD',
          bord: String(n),
        },
        update: {},
      });
      workplaces.push({ id: wp.id, code: wp.code });
    }

    const beltCode = `${entry.code}-SB`;
    const belt = await prisma.workplace.upsert({
      where: { sectionId_code: { sectionId: section.id, code: beltCode } },
      create: {
        sectionId: section.id,
        code: beltCode,
        name: `${entry.name} strike belt`,
        workplaceType: 'STRIKE_BELT',
        strikeBelt: entry.code,
      },
      update: {},
    });
    workplaces.push({ id: belt.id, code: belt.code });
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
  console.log(`  ${PLACEHOLDER_REFERENCE_DATA.length} reference lists, ${sections.length} sections, ${workplaces.length} workplaces, ${users.length} users.`);
  console.log('  Development sign-in: T001 / G001 / S001 / A001 with password "ChangeMe123".');
  console.log('  Terminology follows UNKI-MIN-MRM-STD-201. Confirm against the current standard before production use.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
