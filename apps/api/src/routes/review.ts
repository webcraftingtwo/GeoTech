import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

const ENTITY = z.enum([
  'FACE_LOG',
  'OBSERVATION',
  'REEF_OBSERVATION',
  'STRUCTURE',
  'OFFSET',
  'SAMPLE',
  'HAZARD',
  'PHOTO',
]);

/**
 * Fields a geologist may interpret. Deliberately a closed list: the point of
 * this module is that an interpretation lands *beside* the observation, and an
 * open field name would eventually be used to write over one.
 */
const INTERPRETABLE_FIELDS: Record<string, string[]> = {
  OFFSET: ['throw', 'heave', 'offsetDirection', 'structureCorrelation'],
  STRUCTURE: ['structureType', 'strike', 'dip', 'dipDirection', 'structureRef'],
  OBSERVATION: ['observationType', 'materialCode', 'relationToReef'],
  REEF_OBSERVATION: ['reefNameCode', 'reefWidth', 'hwLithologyCode', 'fwLithologyCode'],
};

export default async function reviewRoutes(app: FastifyInstance) {
  /* ── the review queue (§22) ────────────────────────────────────────── */

  app.get('/review/queue', { preHandler: [app.requireAction('review:decide')] }, async (request) => {
    const q = z.object({ take: z.coerce.number().min(1).max(200).default(50) }).parse(request.query);

    const [faceLogs, openHazards] = await Promise.all([
      prisma.faceLog.findMany({
        where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        include: {
          workplace: { include: { section: true } },
          technician: { select: { id: true, name: true } },
          _count: { select: { observations: true, photos: true, samples: true, hazards: true } },
        },
        // Oldest first: a queue that surfaces the newest work first quietly
        // strands the oldest.
        orderBy: { submittedAt: 'asc' },
        take: q.take,
      }),
      // Hazards are pinned above the queue regardless of age.
      prisma.hazard.findMany({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        include: { faceLog: { include: { workplace: true } }, raisedBy: { select: { name: true } } },
        orderBy: { raisedAt: 'desc' },
        take: 20,
      }),
    ]);

    return { openHazards, faceLogs };
  });

  /* ── review decisions (§20) ────────────────────────────────────────── */

  app.post('/review/:entityType/:entityId', { preHandler: [app.requireAction('review:decide')] }, async (request) => {
    const params = z.object({ entityType: ENTITY, entityId: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['ACCEPTED', 'CLARIFICATION_REQUESTED', 'REJECTED', 'VALIDATED']),
        comment: z.string().max(4000).optional(),
      })
      .parse(request.body);

    if (body.status !== 'ACCEPTED' && !body.comment) {
      throw badRequest(
        'review.comment_required',
        'Add a comment explaining the decision — the technician needs to know what to do next.',
      );
    }

    const reviewerId = request.auth!.sub;

    return prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          entityType: params.entityType,
          entityId: params.entityId,
          reviewerId,
          status: body.status,
          comment: body.comment ?? null,
        },
        include: { reviewer: { select: { id: true, name: true, role: true } } },
      });

      // The technician's observation is untouched by any of this. Only the
      // record's review status moves.
      if (params.entityType === 'FACE_LOG') {
        const before = await tx.faceLog.findUnique({ where: { id: params.entityId } });
        if (!before) throw notFound('Face log');

        const statusMap = {
          ACCEPTED: 'UNDER_REVIEW',
          VALIDATED: 'VALIDATED',
          REJECTED: 'REJECTED',
          CLARIFICATION_REQUESTED: 'CLARIFICATION_REQUESTED',
        } as const;

        await tx.faceLog.update({
          where: { id: params.entityId },
          data: { status: statusMap[body.status] },
        });

        await tx.notification.create({
          data: {
            userId: before.technicianId,
            kind: `REVIEW_${body.status}`,
            title:
              body.status === 'CLARIFICATION_REQUESTED'
                ? `Clarification requested on ${before.recordId}`
                : `${before.recordId} ${body.status.toLowerCase()}`,
            body: body.comment ?? null,
            entityType: 'FACE_LOG',
            entityId: params.entityId,
          },
        });

        await recordAudit(tx, {
          userId: reviewerId,
          entity: 'FACE_LOG',
          entityId: params.entityId,
          action: 'REVIEW_DECISION',
          oldValue: { status: before.status },
          newValue: { status: statusMap[body.status], comment: body.comment ?? null },
          ipAddress: request.ip,
        });
      } else {
        await recordAudit(tx, {
          userId: reviewerId,
          entity: params.entityType,
          entityId: params.entityId,
          action: 'REVIEW_DECISION',
          newValue: { status: body.status, comment: body.comment ?? null },
          ipAddress: request.ip,
        });
      }

      return review;
    });
  });

  /* ── interpretations (§13) ─────────────────────────────────────────── */

  app.post('/interpretations', { preHandler: [app.requireAction('interpretation:write')] }, async (request) => {
    const body = z
      .object({
        entityType: ENTITY,
        entityId: z.string(),
        field: z.string(),
        value: z.unknown(),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        comment: z.string().max(4000).optional(),
      })
      .parse(request.body);

    const allowed = INTERPRETABLE_FIELDS[body.entityType] ?? [];
    if (!allowed.includes(body.field)) {
      throw badRequest(
        'interpretation.field_not_interpretable',
        `"${body.field}" is not an interpretable field on a ${body.entityType.toLowerCase().replace('_', ' ')}. Interpretable fields are: ${allowed.join(', ') || 'none'}.`,
      );
    }

    const interpreterId = request.auth!.sub;

    return prisma.$transaction(async (tx) => {
      // Supersede rather than replace: the previous reading of the same
      // evidence stays on the record, with its author and its date.
      const previous = await tx.interpretation.findFirst({
        where: { entityType: body.entityType, entityId: body.entityId, field: body.field, supersededById: null },
        orderBy: { interpretedAt: 'desc' },
      });

      const created = await tx.interpretation.create({
        data: {
          entityType: body.entityType,
          entityId: body.entityId,
          field: body.field,
          value: (body.value ?? null) as Prisma.InputJsonValue,
          confidence: body.confidence,
          comment: body.comment ?? null,
          interpretedById: interpreterId,
        },
        include: { interpretedBy: { select: { id: true, name: true, role: true } } },
      });

      if (previous) {
        await tx.interpretation.update({
          where: { id: previous.id },
          data: { supersededById: created.id },
        });
      }

      // Denormalised copy for query speed only. The observed columns
      // (apparentOffset, throwObserved, heaveObserved) are never written here.
      if (body.entityType === 'OFFSET' && (body.field === 'throw' || body.field === 'heave')) {
        const numeric = typeof body.value === 'number' ? body.value : null;
        await tx.offset.update({
          where: { id: body.entityId },
          data: {
            ...(body.field === 'throw' ? { interpretedThrow: numeric } : { interpretedHeave: numeric }),
            interpretedById: interpreterId,
            interpretationConfidence: body.confidence,
            interpretedAt: new Date(),
          },
        });
      }

      await recordAudit(tx, {
        userId: interpreterId,
        entity: body.entityType,
        entityId: body.entityId,
        action: 'INTERPRETATION_ADDED',
        oldValue: previous ? { field: previous.field, value: previous.value, confidence: previous.confidence } : null,
        newValue: { field: body.field, value: body.value ?? null, confidence: body.confidence },
        ipAddress: request.ip,
      });

      return created;
    });
  });

  app.get('/interpretations/:entityType/:entityId', { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ entityType: ENTITY, entityId: z.string() }).parse(request.params);
    return prisma.interpretation.findMany({
      where: { entityType: params.entityType, entityId: params.entityId },
      include: { interpretedBy: { select: { id: true, name: true, role: true } } },
      orderBy: { interpretedAt: 'desc' },
    });
  });

  /* ── sync conflict resolution (§30) ────────────────────────────────── */

  app.get('/conflicts', { preHandler: [app.requireAction('conflict:resolve')] }, async () => {
    return prisma.syncOperation.findMany({
      where: { status: 'CONFLICT' },
      include: { batch: { select: { deviceId: true, receivedAt: true, userId: true } } },
      orderBy: { processedAt: 'desc' },
      take: 100,
    });
  });

  app.post('/conflicts/:id/resolve', { preHandler: [app.requireAction('conflict:resolve')] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ keep: z.enum(['LOCAL', 'SERVER']), comment: z.string().max(2000).optional() })
      .parse(request.body);

    const op = await prisma.syncOperation.findUnique({ where: { id } });
    if (!op) throw notFound('Conflict');
    if (op.status !== 'CONFLICT') {
      throw badRequest('conflict.already_resolved', 'This conflict has already been resolved.');
    }

    // Whichever version is chosen, the other is kept in the conflict record and
    // in the audit trail. "Resolving" a conflict never deletes a version.
    await prisma.$transaction(async (tx) => {
      await tx.syncOperation.update({
        where: { id },
        data: {
          status: body.keep === 'LOCAL' ? 'APPLIED' : 'REJECTED',
          message: `Resolved by geologist: kept the ${body.keep.toLowerCase()} version.${body.comment ? ` ${body.comment}` : ''}`,
        },
      });
      await recordAudit(tx, {
        userId: request.auth!.sub,
        entity: op.entityType,
        entityId: op.serverId ?? op.localId,
        action: 'CONFLICT_RESOLVED',
        oldValue: op.conflict as Prisma.InputJsonValue,
        newValue: { keep: body.keep, comment: body.comment ?? null },
        ipAddress: request.ip,
      });
    });

    return { ok: true, kept: body.keep };
  });
}
