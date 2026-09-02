import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  workplaceId: z.string().optional(),
  sectionCode: z.string().optional(),
  technicianId: z.string().optional(),
  status: z.string().optional(),
  take: z.coerce.number().min(1).max(200).default(50),
  skip: z.coerce.number().min(0).default(0),
});

export default async function recordRoutes(app: FastifyInstance) {
  /* ── face logs ─────────────────────────────────────────────────────── */

  app.get('/face-logs', { preHandler: [app.authenticate] }, async (request) => {
    const q = listQuery.parse(request.query);
    const auth = request.auth!;

    const where: Prisma.FaceLogWhereInput = {};
    // A technician sees their own work; a geologist sees the mine's.
    if (auth.role === 'TECHNICIAN') where.technicianId = auth.sub;
    else if (q.technicianId) where.technicianId = q.technicianId;

    if (q.workplaceId) where.workplaceId = q.workplaceId;
    if (q.status) where.status = q.status as Prisma.EnumRecordStatusFilter['equals'];
    if (q.from || q.to) {
      where.shiftDate = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    if (q.sectionCode) {
      where.workplace = { section: { code: q.sectionCode } };
    }

    const [items, total] = await Promise.all([
      prisma.faceLog.findMany({
        where,
        include: {
          workplace: { include: { section: true } },
          technician: { select: { id: true, name: true, employeeNo: true } },
          _count: { select: { observations: true, samples: true, hazards: true, photos: true } },
        },
        orderBy: [{ shiftDate: 'desc' }, { createdAt: 'desc' }],
        take: q.take,
        skip: q.skip,
      }),
      prisma.faceLog.count({ where }),
    ]);

    return { items, total, take: q.take, skip: q.skip };
  });

  app.get('/face-logs/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const auth = request.auth!;

    const log = await prisma.faceLog.findUnique({
      where: { id },
      include: {
        workplace: { include: { section: { include: { mine: true } } } },
        technician: { select: { id: true, name: true, employeeNo: true } },
        reefObservations: true,
        samples: true,
        hazards: true,
        photos: true,
        observations: {
          include: {
            structures: { include: { offsets: { include: { photos: true } } } },
            photos: true,
          },
        },
      },
    });
    if (!log) throw notFound('Face log');
    if (auth.role === 'TECHNICIAN' && log.technicianId !== auth.sub) throw notFound('Face log');

    const [reviews, versions] = await Promise.all([
      prisma.review.findMany({
        where: { entityType: 'FACE_LOG', entityId: id },
        include: { reviewer: { select: { id: true, name: true, role: true } } },
        orderBy: { reviewedAt: 'desc' },
      }),
      prisma.recordVersion.count({ where: { entityType: 'FACE_LOG', entityId: id } }),
    ]);

    return { ...log, reviews, versionCount: versions };
  });

  /* ── offsets ───────────────────────────────────────────────────────── */

  app.get('/offsets', { preHandler: [app.authenticate] }, async (request) => {
    const q = listQuery.extend({ structureType: z.string().optional(), minOffset: z.coerce.number().optional() }).parse(request.query);

    const where: Prisma.OffsetWhereInput = {};
    if (q.minOffset !== undefined) where.apparentOffset = { gte: q.minOffset };
    if (q.structureType) where.structure = { structureType: q.structureType };
    if (q.from || q.to) {
      where.observedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    if (request.auth!.role === 'TECHNICIAN') where.observedById = request.auth!.sub;

    const items = await prisma.offset.findMany({
      where,
      include: {
        structure: {
          include: {
            observation: {
              include: {
                faceLog: { include: { workplace: { include: { section: true } } } },
              },
            },
          },
        },
        observedBy: { select: { id: true, name: true } },
        photos: { select: { id: true, storageKey: true } },
      },
      orderBy: { observedAt: 'desc' },
      take: q.take,
      skip: q.skip,
    });

    return { items };
  });

  app.get('/offsets/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const offset = await prisma.offset.findUnique({
      where: { id },
      include: {
        structure: { include: { observation: { include: { faceLog: { include: { workplace: true } } } } } },
        observedBy: { select: { id: true, name: true } },
        photos: true,
      },
    });
    if (!offset) throw notFound('Offset record');

    // The interpretation history is returned alongside — never merged into —
    // the observed values (§13).
    const interpretations = await prisma.interpretation.findMany({
      where: { entityType: 'OFFSET', entityId: id },
      include: { interpretedBy: { select: { id: true, name: true, role: true } } },
      orderBy: { interpretedAt: 'desc' },
    });

    return {
      observed: {
        apparentOffset: offset.apparentOffset,
        unit: offset.unit,
        markerType: offset.markerType,
        markerRef: offset.markerRef,
        offsetDirection: offset.offsetDirection,
        lateralSense: offset.lateralSense,
        verticalSense: offset.verticalSense,
        strike: offset.strike,
        dip: offset.dip,
        dipDirection: offset.dipDirection,
        throwObserved: offset.throwObserved,
        heaveObserved: offset.heaveObserved,
        measurementMethod: offset.measurementMethod,
        measurementSource: offset.measurementSource,
        confidence: offset.confidence,
        observedBy: offset.observedBy,
        observedAt: offset.observedAt,
      },
      interpreted: offset.interpretedAt
        ? {
            throw: offset.interpretedThrow,
            heave: offset.interpretedHeave,
            interpretedById: offset.interpretedById,
            confidence: offset.interpretationConfidence,
            interpretedAt: offset.interpretedAt,
          }
        : null,
      interpretationHistory: interpretations,
      record: offset,
    };
  });

  /* ── structure history (§23) ───────────────────────────────────────── */

  app.get('/structures/history/:structureRef', { preHandler: [app.authenticate] }, async (request) => {
    const { structureRef } = z.object({ structureRef: z.string() }).parse(request.params);

    const structures = await prisma.structure.findMany({
      where: { structureRef },
      include: {
        offsets: { include: { observedBy: { select: { id: true, name: true } }, photos: true } },
        observation: {
          include: {
            faceLog: {
              include: {
                workplace: { include: { section: true } },
                technician: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (structures.length === 0) throw notFound(`Structure ${structureRef}`);

    const observations = structures.flatMap((s) =>
      s.offsets.map((o) => ({
        structureId: s.id,
        offsetId: o.id,
        recordId: o.recordId,
        level: s.observation.faceLog.workplace.section.code,
        section: s.observation.faceLog.workplace.section.code,
        workplace: s.observation.faceLog.workplace.code,
        date: s.observation.faceLog.shiftDate,
        technician: s.observation.faceLog.technician.name,
        apparentOffset: o.apparentOffset,
        unit: o.unit,
        interpretedThrow: o.interpretedThrow,
        strike: s.strike,
        dip: s.dip,
        dipDirection: s.dipDirection,
        confidence: o.confidence,
        photoCount: o.photos.length,
      })),
    );

    const values = observations.map((o) => o.apparentOffset).filter((v): v is number => v != null);

    return {
      structureRef,
      structureType: structures[0]!.structureType,
      occurrences: structures.length,
      observations,
      summary: values.length
        ? {
            count: values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
          }
        : null,
    };
  });

  /* ── hazards (§17) ─────────────────────────────────────────────────── */

  app.get('/hazards', { preHandler: [app.authenticate] }, async (request) => {
    const q = z.object({ status: z.string().optional(), take: z.coerce.number().default(50) }).parse(request.query);
    return prisma.hazard.findMany({
      where: q.status ? { status: q.status as Prisma.EnumHazardStatusFilter['equals'] } : {},
      include: {
        faceLog: { include: { workplace: { include: { section: true } } } },
        raisedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { raisedAt: 'desc' }],
      take: q.take,
    });
  });

  app.patch('/hazards/:id/status', { preHandler: [app.requireAction('hazard:close')] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'CLOSED']),
        comment: z.string().optional(),
      })
      .parse(request.body);

    const before = await prisma.hazard.findUnique({ where: { id } });
    if (!before) throw notFound('Hazard');

    const updated = await prisma.$transaction(async (tx) => {
      const h = await tx.hazard.update({
        where: { id },
        data: {
          status: body.status,
          closedAt: body.status === 'CLOSED' ? new Date() : null,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: request.auth!.sub,
          entity: 'HAZARD',
          entityId: id,
          action: 'HAZARD_STATUS_CHANGED',
          oldValue: { status: before.status },
          newValue: { status: body.status, comment: body.comment ?? null },
          ipAddress: request.ip,
        },
      });
      return h;
    });

    return updated;
  });

  /* ── samples (§16) ─────────────────────────────────────────────────── */

  app.get('/samples', { preHandler: [app.authenticate] }, async (request) => {
    const q = listQuery.parse(request.query);
    return prisma.sample.findMany({
      where: {
        ...(request.auth!.role === 'TECHNICIAN' ? { collectedById: request.auth!.sub } : {}),
        ...(q.from || q.to
          ? { collectedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
          : {}),
      },
      include: {
        faceLog: { include: { workplace: true } },
        collectedBy: { select: { id: true, name: true } },
      },
      orderBy: { collectedAt: 'desc' },
      take: q.take,
      skip: q.skip,
    });
  });

  /* ── record version history (§20) ──────────────────────────────────── */

  app.get('/records/:entityType/:entityId/versions', { preHandler: [app.authenticate] }, async (request) => {
    const params = z
      .object({
        entityType: z.enum(['FACE_LOG', 'OBSERVATION', 'REEF_OBSERVATION', 'STRUCTURE', 'OFFSET', 'SAMPLE', 'HAZARD', 'PHOTO']),
        entityId: z.string(),
      })
      .parse(request.params);

    return prisma.recordVersion.findMany({
      where: { entityType: params.entityType, entityId: params.entityId },
      orderBy: { version: 'asc' },
    });
  });
}
