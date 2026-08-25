import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.js';
import { invalidateConfigCache, loadValidationConfig } from '../lib/config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { checkPasswordPolicy, hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';

/**
 * Administration (§38, §39).
 *
 * Everything a mine would call "its own" — terminology, hierarchy, validation
 * rules, measurement conventions — is edited here rather than in code. Nothing
 * in this file invents an Unki geological code; it provides the place for
 * authorized personnel to enter the mine-approved ones.
 */
export default async function adminRoutes(app: FastifyInstance) {
  /* ── reference data ────────────────────────────────────────────────── */

  app.get('/reference-lists', { preHandler: [app.authenticate] }, async () => {
    const config = await loadValidationConfig();
    return config.lists;
  });

  app.post('/admin/reference-lists', { preHandler: [app.requireAction('refdata:manage')] }, async (request) => {
    const body = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().default(''),
        mineSpecific: z.boolean().default(true),
      })
      .parse(request.body);

    const list = await prisma.refList.upsert({
      where: { code: body.code },
      create: body,
      update: { name: body.name, description: body.description, mineSpecific: body.mineSpecific },
    });
    invalidateConfigCache();
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'RefList',
      entityId: list.id,
      action: 'REFLIST_UPSERT',
      newValue: body,
      ipAddress: request.ip,
    });
    return list;
  });

  app.post('/admin/reference-lists/:listCode/items', { preHandler: [app.requireAction('refdata:manage')] }, async (request) => {
    const { listCode } = z.object({ listCode: z.string() }).parse(request.params);
    const body = z
      .object({
        code: z.string().min(1),
        label: z.string().min(1),
        sortOrder: z.number().int().default(0),
        active: z.boolean().default(true),
        meta: z.record(z.unknown()).optional(),
      })
      .parse(request.body);

    const list = await prisma.refList.findUnique({ where: { code: listCode } });
    if (!list) throw notFound(`Reference list "${listCode}"`);

    const item = await prisma.refItem.upsert({
      where: { listId_code: { listId: list.id, code: body.code } },
      create: { ...body, listId: list.id, meta: (body.meta ?? undefined) as Prisma.InputJsonValue },
      update: { label: body.label, sortOrder: body.sortOrder, active: body.active, meta: (body.meta ?? undefined) as Prisma.InputJsonValue },
    });
    invalidateConfigCache();
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'RefItem',
      entityId: item.id,
      action: 'REFITEM_UPSERT',
      newValue: { list: listCode, ...body },
      ipAddress: request.ip,
    });
    return item;
  });

  /**
   * Retiring a term deactivates it. It is never deleted: a record captured
   * under the old terminology must stay readable for the life of the mine.
   */
  app.post('/admin/reference-lists/:listCode/items/:code/retire', { preHandler: [app.requireAction('refdata:manage')] }, async (request) => {
    const params = z.object({ listCode: z.string(), code: z.string() }).parse(request.params);
    const list = await prisma.refList.findUnique({ where: { code: params.listCode } });
    if (!list) throw notFound(`Reference list "${params.listCode}"`);

    const item = await prisma.refItem.update({
      where: { listId_code: { listId: list.id, code: params.code } },
      data: { active: false },
    });
    invalidateConfigCache();
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'RefItem',
      entityId: item.id,
      action: 'REFITEM_RETIRED',
      oldValue: { active: true },
      newValue: { active: false },
      ipAddress: request.ip,
    });
    return item;
  });

  /* ── measurement convention (§18) ──────────────────────────────────── */

  app.get('/admin/convention', { preHandler: [app.authenticate] }, async () => {
    const config = await loadValidationConfig();
    return config.convention;
  });

  app.put('/admin/convention', { preHandler: [app.requireAction('rules:manage')] }, async (request) => {
    const body = z
      .object({
        dipMin: z.number(),
        dipMax: z.number(),
        strikeMin: z.number(),
        strikeMax: z.number(),
        dipDirectionMin: z.number(),
        dipDirectionMax: z.number(),
        allowNegativeOffset: z.boolean(),
        strikeDipRule: z.enum(['RIGHT_HAND', 'LEFT_HAND', 'NONE']),
        strikeDipToleranceDeg: z.number(),
        defaultUnit: z.string(),
        maxPlausibleWidthM: z.number(),
        maxPlausibleOffsetM: z.number(),
      })
      .parse(request.body);

    if (body.dipMin >= body.dipMax) {
      throw badRequest('convention.invalid_range', 'The minimum dip must be less than the maximum dip.');
    }

    const before = await prisma.measurementConventionConfig.findUnique({ where: { key: 'default' } });
    const saved = await prisma.measurementConventionConfig.upsert({
      where: { key: 'default' },
      create: { key: 'default', ...body },
      update: body,
    });
    invalidateConfigCache();

    // Changing a convention changes what counts as a valid geological
    // measurement across the whole mine — it is audited like a data change.
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'MeasurementConvention',
      entityId: saved.id,
      action: 'CONVENTION_CHANGED',
      oldValue: before,
      newValue: body,
      ipAddress: request.ip,
    });
    return saved;
  });

  /* ── validation rules (§18, §38) ───────────────────────────────────── */

  app.get('/admin/validation-rules', { preHandler: [app.requireAction('rules:manage')] }, async () =>
    prisma.validationRule.findMany({ orderBy: [{ entity: 'asc' }, { field: 'asc' }] }),
  );

  app.post('/admin/validation-rules', { preHandler: [app.requireAction('rules:manage')] }, async (request) => {
    const body = z
      .object({
        entity: z.enum(['FACE_LOG', 'OBSERVATION', 'REEF_OBSERVATION', 'STRUCTURE', 'OFFSET', 'SAMPLE', 'HAZARD', 'PHOTO']),
        field: z.string().min(1),
        ruleType: z.enum(['REQUIRED', 'RANGE', 'ONE_OF', 'NON_NEGATIVE', 'PATTERN', 'MAX_LENGTH']),
        params: z.record(z.unknown()).optional(),
        severity: z.enum(['ERROR', 'WARNING']).default('WARNING'),
        message: z.string().optional(),
        active: z.boolean().default(true),
      })
      .parse(request.body);

    const rule = await prisma.validationRule.create({
      data: { ...body, params: (body.params ?? undefined) as Prisma.InputJsonValue, message: body.message ?? null },
    });
    invalidateConfigCache();
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'ValidationRule',
      entityId: rule.id,
      action: 'RULE_CREATED',
      newValue: body,
      ipAddress: request.ip,
    });
    return rule;
  });

  app.patch('/admin/validation-rules/:id', { preHandler: [app.requireAction('rules:manage')] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ active: z.boolean().optional(), severity: z.enum(['ERROR', 'WARNING']).optional(), message: z.string().optional() }).parse(request.body);
    const rule = await prisma.validationRule.update({ where: { id }, data: body });
    invalidateConfigCache();
    return rule;
  });

  /* ── mine hierarchy (§38) ──────────────────────────────────────────── */

  app.get('/workplaces', { preHandler: [app.authenticate] }, async () =>
    prisma.workplace.findMany({
      where: { active: true },
      include: { section: { include: { level: { include: { mine: true } } } } },
      orderBy: { code: 'asc' },
    }),
  );

  app.post('/admin/workplaces', { preHandler: [app.requireAction('refdata:manage')] }, async (request) => {
    const body = z
      .object({
        sectionId: z.string(),
        code: z.string().min(1),
        name: z.string().min(1),
        workplaceType: z.string().min(1),
        panel: z.string().optional(),
        drive: z.string().optional(),
        stope: z.string().optional(),
        face: z.string().optional(),
      })
      .parse(request.body);

    const wp = await prisma.workplace.upsert({
      where: { sectionId_code: { sectionId: body.sectionId, code: body.code } },
      create: body,
      update: body,
    });
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'Workplace',
      entityId: wp.id,
      action: 'WORKPLACE_UPSERT',
      newValue: body,
      ipAddress: request.ip,
    });
    return wp;
  });

  /* ── users (§38) ───────────────────────────────────────────────────── */

  app.get('/admin/users', { preHandler: [app.requireAction('user:manage')] }, async () =>
    prisma.user.findMany({
      select: { id: true, employeeNo: true, name: true, email: true, role: true, department: true, active: true, lastLoginAt: true },
      orderBy: { name: 'asc' },
    }),
  );

  app.post('/admin/users', { preHandler: [app.requireAction('user:manage')] }, async (request) => {
    const body = z
      .object({
        employeeNo: z.string().min(1),
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['TECHNICIAN', 'GEOLOGIST', 'SENIOR_GEOLOGIST', 'ADMIN']),
        department: z.string().optional(),
        temporaryPassword: z.string().min(1),
      })
      .parse(request.body);

    const problems = checkPasswordPolicy(body.temporaryPassword);
    if (problems.length) throw badRequest('auth.password_policy', problems.join(' '), { problems });

    const user = await prisma.user.create({
      data: {
        employeeNo: body.employeeNo.toUpperCase(),
        name: body.name,
        email: body.email.toLowerCase(),
        role: body.role,
        department: body.department ?? null,
        passwordHash: await hashPassword(body.temporaryPassword),
        mustChangePassword: true,
      },
      select: { id: true, employeeNo: true, name: true, email: true, role: true, active: true },
    });

    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'User',
      entityId: user.id,
      action: 'USER_CREATED',
      newValue: { employeeNo: user.employeeNo, role: user.role },
      ipAddress: request.ip,
    });
    return user;
  });

  /** Deactivation, never deletion — observations must keep a resolvable author. */
  app.post('/admin/users/:id/deactivate', { preHandler: [app.requireAction('user:manage')] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (id === request.auth!.sub) {
      throw badRequest('user.self_deactivate', 'You cannot deactivate your own account.');
    }
    const user = await prisma.user.update({ where: { id }, data: { active: false } });
    await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'User',
      entityId: id,
      action: 'USER_DEACTIVATED',
      oldValue: { active: true },
      newValue: { active: false },
      ipAddress: request.ip,
    });
    return { id: user.id, active: user.active };
  });
}
