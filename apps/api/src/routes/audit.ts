import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

/**
 * Audit trail (§21, §40).
 *
 * Read-only by construction. There is no POST, PATCH, PUT or DELETE here at any
 * role, and `audit:modify` is granted to nobody in the permission matrix. If a
 * future change needs to alter this file, that is the signal to stop and think.
 */
export default async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: [app.requireAction('audit:read')] }, async (request) => {
    const q = z
      .object({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        userId: z.string().optional(),
        action: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        take: z.coerce.number().min(1).max(500).default(100),
        skip: z.coerce.number().min(0).default(0),
      })
      .parse(request.query);

    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.from || q.to
        ? { timestamp: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { timestamp: 'desc' },
        take: q.take,
        skip: q.skip,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, take: q.take, skip: q.skip };
  });

  /**
   * The full provenance of one record: every version, every review, every
   * interpretation and every audit entry, in one answer. This is what §40's
   * questions — who, when, where, what changed — are answered from.
   */
  app.get('/audit/record/:entityType/:entityId', { preHandler: [app.requireAction('audit:read')] }, async (request) => {
    const params = z
      .object({
        entityType: z.enum(['FACE_LOG', 'OBSERVATION', 'REEF_OBSERVATION', 'STRUCTURE', 'OFFSET', 'SAMPLE', 'HAZARD', 'PHOTO']),
        entityId: z.string(),
      })
      .parse(request.params);

    const [audit, versions, reviews, interpretations] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entity: params.entityType, entityId: params.entityId },
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.recordVersion.findMany({
        where: { entityType: params.entityType, entityId: params.entityId },
        orderBy: { version: 'asc' },
      }),
      prisma.review.findMany({
        where: { entityType: params.entityType, entityId: params.entityId },
        include: { reviewer: { select: { id: true, name: true, role: true } } },
        orderBy: { reviewedAt: 'asc' },
      }),
      prisma.interpretation.findMany({
        where: { entityType: params.entityType, entityId: params.entityId },
        include: { interpretedBy: { select: { id: true, name: true, role: true } } },
        orderBy: { interpretedAt: 'asc' },
      }),
    ]);

    return { entityType: params.entityType, entityId: params.entityId, audit, versions, reviews, interpretations };
  });
}
