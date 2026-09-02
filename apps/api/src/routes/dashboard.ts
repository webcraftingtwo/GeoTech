import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export default async function dashboardRoutes(app: FastifyInstance) {
  /** The overview counters at the top of the geologist dashboard (§22). */
  app.get('/dashboard/overview', { preHandler: [app.authenticate] }, async (request) => {
    const q = z.object({ date: z.string().optional() }).parse(request.query);
    const day = q.date ? new Date(q.date) : new Date();
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86400_000);

    const scope = request.auth!.role === 'TECHNICIAN' ? { technicianId: request.auth!.sub } : {};

    const [logsToday, pendingReview, observations, offsets, samples, openHazards, syncFailures, conflicts] =
      await Promise.all([
        prisma.faceLog.count({ where: { ...scope, shiftDate: { gte: dayStart, lt: dayEnd } } }),
        prisma.faceLog.count({ where: { ...scope, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
        prisma.observation.count({ where: { faceLog: scope, createdAt: { gte: dayStart, lt: dayEnd } } }),
        prisma.offset.count({ where: { observedAt: { gte: dayStart, lt: dayEnd } } }),
        prisma.sample.count({ where: { collectedAt: { gte: dayStart, lt: dayEnd } } }),
        prisma.hazard.count({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),
        prisma.syncOperation.count({ where: { status: { in: ['FAILED', 'REJECTED'] } } }),
        prisma.syncOperation.count({ where: { status: 'CONFLICT' } }),
      ]);

    return {
      date: dayStart.toISOString().slice(0, 10),
      logsToday,
      pendingReview,
      observations,
      offsets,
      samples,
      openHazards,
      syncFailures,
      conflicts,
    };
  });

  /** The "recent observations" table beneath the counters (§22). */
  app.get('/dashboard/recent', { preHandler: [app.authenticate] }, async (request) => {
    const q = z.object({ take: z.coerce.number().min(1).max(100).default(25) }).parse(request.query);

    const offsets = await prisma.offset.findMany({
      include: {
        structure: {
          include: {
            observation: {
              include: {
                faceLog: {
                  include: {
                    workplace: { include: { section: true } },
                    technician: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { observedAt: 'desc' },
      take: q.take,
    });

    return offsets.map((o) => {
      const faceLog = o.structure.observation.faceLog;
      return {
        id: o.id,
        recordId: o.recordId,
        workplace: `${faceLog.workplace.section.code} / ${faceLog.workplace.code}`,
        type: o.structure.structureType,
        observation: `${o.apparentOffset} ${o.unit.toLowerCase()} offset`,
        technician: faceLog.technician.name,
        status: faceLog.status,
        confidence: o.confidence,
        interpreted: o.interpretedThrow != null,
        observedAt: o.observedAt,
      };
    });
  });

  /** Unread notifications for the signed-in user (§28). */
  app.get('/notifications', { preHandler: [app.authenticate] }, async (request) => {
    return prisma.notification.findMany({
      where: { userId: request.auth!.sub, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  app.post('/notifications/:id/read', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await prisma.notification.updateMany({
      where: { id, userId: request.auth!.sub },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}
