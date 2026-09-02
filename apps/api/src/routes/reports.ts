import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toAsciiDiagram } from '@geotech/core';
import { badRequest } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

/**
 * Reporting (§26).
 *
 * JSON and CSV are produced here. CSV is the interchange format the mine's own
 * tools (including Excel) already read; a native .xlsx writer and server-side
 * PDF rendering are deliberately not in this first release — the dashboard
 * prints these same reports to PDF from the browser.
 */

interface DailyRow {
  recordId: string;
  date: string;
  shift: string;
  level: string;
  workplace: string;
  technician: string;
  observation: string;
  structure: string;
  /** Empty string where the observation carries no offset — CSV, not maths. */
  apparentOffset: number | '';
  unit: string;
  confidence: string;
  status: string;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

const rangeQuery = z.object({
  date: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

function dayBounds(dateStr?: string): { start: Date; end: Date } {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(d.getTime())) throw badRequest('report.bad_date', 'The date could not be read. Use YYYY-MM-DD.');
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86400_000) };
}

export default async function reportRoutes(app: FastifyInstance) {
  /* ── daily geological report (§26) ─────────────────────────────────── */

  app.get('/reports/daily', { preHandler: [app.requireAction('report:generate')] }, async (request, reply) => {
    const q = rangeQuery.parse(request.query);
    const { start, end } = dayBounds(q.date);

    const faceLogs = await prisma.faceLog.findMany({
      where: { shiftDate: { gte: start, lt: end } },
      include: {
        workplace: { include: { section: true } },
        technician: { select: { name: true, employeeNo: true } },
        observations: { include: { structures: { include: { offsets: true } } } },
        samples: true,
        hazards: true,
        photos: { select: { id: true } },
        reefObservations: true,
      },
      orderBy: { shiftDate: 'asc' },
    });

    const rows: DailyRow[] = faceLogs.flatMap((log) =>
      log.observations.flatMap((obs): DailyRow[] => {
        const offsets = obs.structures.flatMap((s) => s.offsets);
        if (offsets.length === 0) {
          return [
            {
              recordId: log.recordId,
              date: log.shiftDate.toISOString().slice(0, 10),
              shift: log.shift,
              level: log.workplace.section.code,
              workplace: log.workplace.code,
              technician: log.technician.name,
              observation: obs.observationType,
              structure: obs.structures[0]?.structureType ?? '',
              apparentOffset: '',
              unit: '',
              confidence: obs.confidence ?? '',
              status: log.status,
            },
          ];
        }
        return offsets.map((o) => ({
          recordId: o.recordId,
          date: log.shiftDate.toISOString().slice(0, 10),
          shift: log.shift,
          level: log.workplace.section.code,
          workplace: log.workplace.code,
          technician: log.technician.name,
          observation: obs.observationType,
          structure: obs.structures.find((s) => s.offsets.some((x) => x.id === o.id))?.structureType ?? '',
          apparentOffset: o.apparentOffset,
          unit: o.unit,
          confidence: o.confidence ?? '',
          status: log.status,
        }));
      }),
    );

    if (q.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="daily-geological-report-${start.toISOString().slice(0, 10)}.csv"`);
      return toCsv(rows as unknown as Record<string, unknown>[]);
    }

    return {
      title: 'Daily Geological Report',
      date: start.toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      summary: {
        workplacesVisited: new Set(faceLogs.map((l) => l.workplaceId)).size,
        facesLogged: faceLogs.length,
        observations: faceLogs.reduce((n, l) => n + l.observations.length, 0),
        offsets: rows.filter((r) => r.apparentOffset !== '').length,
        samples: faceLogs.reduce((n, l) => n + l.samples.length, 0),
        hazards: faceLogs.reduce((n, l) => n + l.hazards.length, 0),
        photographs: faceLogs.reduce((n, l) => n + l.photos.length, 0),
        outstandingReview: faceLogs.filter((l) => ['SUBMITTED', 'UNDER_REVIEW'].includes(l.status)).length,
      },
      rows,
      // The mine's own standards govern interpretation of anything in here.
      disclaimer:
        'Generated from field observations captured underground. Geological interpretation remains subject to competent-person review under the mine approved procedures.',
    };
  });

  /* ── shift handover (§26) ──────────────────────────────────────────── */

  app.get('/reports/handover', { preHandler: [app.requireAction('report:generate')] }, async (request) => {
    const q = z.object({ date: z.string().optional(), shift: z.string().optional() }).parse(request.query);
    const { start, end } = dayBounds(q.date);

    const [faceLogs, hazards, pendingReview] = await Promise.all([
      prisma.faceLog.findMany({
        where: { shiftDate: { gte: start, lt: end }, ...(q.shift ? { shift: q.shift } : {}) },
        include: {
          workplace: { include: { section: true } },
          technician: { select: { name: true } },
          observations: { include: { structures: { include: { offsets: true } } } },
        },
      }),
      prisma.hazard.findMany({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'UNDER_REVIEW'] } },
        include: { faceLog: { include: { workplace: true } } },
        orderBy: { raisedAt: 'desc' },
      }),
      prisma.faceLog.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
    ]);

    const significantOffsets = faceLogs
      .flatMap((l) =>
        l.observations.flatMap((o) =>
          o.structures.flatMap((s) =>
            s.offsets.map((off) => ({
              recordId: off.recordId,
              workplace: `${l.workplace.section.code} / ${l.workplace.code}`,
              structureType: s.structureType,
              apparentOffset: off.apparentOffset,
              unit: off.unit,
              confidence: off.confidence,
              diagram: toAsciiDiagram({
                apparentOffset: off.apparentOffset,
                unit: off.unit.toLowerCase(),
                markerLabel: off.markerType,
                structureLabel: s.structureType,
                verticalSense: off.verticalSense,
                lateralSense: off.lateralSense,
              }),
            })),
          ),
        ),
      )
      .sort((a, b) => b.apparentOffset - a.apparentOffset);

    return {
      title: 'Shift Handover Report',
      date: start.toISOString().slice(0, 10),
      shift: q.shift ?? 'all shifts',
      generatedAt: new Date().toISOString(),
      keyObservations: faceLogs.map((l) => ({
        recordId: l.recordId,
        workplace: `${l.workplace.section.code} / ${l.workplace.code}`,
        technician: l.technician.name,
        observations: l.observations.length,
        status: l.status,
      })),
      significantOffsets: significantOffsets.slice(0, 20),
      openHazards: hazards.map((h) => ({
        recordId: h.recordId,
        type: h.hazardType,
        severity: h.severity,
        description: h.description,
        status: h.status,
        workplace: h.faceLog.workplace.code,
      })),
      outstandingReviews: pendingReview,
      disclaimer:
        'This handover summarises geological observations only. It does not replace the mine formal shift handover or hazard reporting procedures.',
    };
  });

  /* ── geological structure report (§26) ─────────────────────────────── */

  app.get('/reports/structures', { preHandler: [app.requireAction('report:generate')] }, async (request, reply) => {
    const q = rangeQuery.extend({ structureRef: z.string().optional(), structureType: z.string().optional() }).parse(request.query);

    const structures = await prisma.structure.findMany({
      where: {
        ...(q.structureRef ? { structureRef: q.structureRef } : {}),
        ...(q.structureType ? { structureType: q.structureType } : {}),
      },
      include: {
        offsets: true,
        observation: {
          include: { faceLog: { include: { workplace: { include: { section: true } } } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const rows = structures.map((s) => {
      const offset = s.offsets[0];
      return {
        recordId: s.recordId,
        structureRef: s.structureRef ?? '',
        structureType: s.structureType,
        level: s.observation.faceLog.workplace.section.code,
        workplace: s.observation.faceLog.workplace.code,
        strike: s.strike ?? '',
        dip: s.dip ?? '',
        dipDirection: s.dipDirection ?? '',
        apparentOffsetObserved: offset?.apparentOffset ?? '',
        // Observed and interpreted appear as separate columns, always (§13).
        throwInterpreted: offset?.interpretedThrow ?? '',
        observationConfidence: offset?.confidence ?? s.confidence ?? '',
        interpretationConfidence: offset?.interpretationConfidence ?? '',
        measurementSource: s.measurementSource ?? '',
      };
    });

    if (q.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="geological-structure-report.csv"');
      return toCsv(rows);
    }
    return { title: 'Geological Structure Report', generatedAt: new Date().toISOString(), rows };
  });

  /* ── stope width control (§9.8.vii) ────────────────────────────────── */

  /**
   * Face measurements as width control expects them: one row per face, with
   * the applied limits alongside the readings so a row can be judged on its
   * own without looking up which limit set was in force that month.
   */
  app.get('/reports/width-control', { preHandler: [app.requireAction('report:generate')] }, async (request, reply) => {
    const q = rangeQuery.parse(request.query);
    const where =
      q.from || q.to
        ? { measuredAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {};

    const measurements = await prisma.faceMeasurement.findMany({
      where,
      include: {
        faceLog: { include: { workplace: { include: { section: true } } } },
        measuredBy: { select: { name: true } },
      },
      orderBy: { measuredAt: 'desc' },
      take: 1000,
    });

    const rows = measurements.map((m) => ({
      recordId: m.recordId,
      date: m.measuredAt.toISOString().slice(0, 10),
      section: m.faceLog.workplace.section.name,
      workplace: m.faceLog.workplace.code,
      blastNumber: m.blastNumber ?? '',
      distanceFromPeg: m.distanceFromPeg ?? '',
      advance: m.advance ?? '',
      faceLength: m.faceLength ?? '',
      stationInterval: m.stationInterval,
      limitSet: m.limitSetCode,
      hangingwallLimit: m.limitHangingwall,
      footwallLimit: m.limitFootwall,
      stations: m.stationCount,
      measured: m.measuredCount,
      hangingwallBreaches: m.hangingwallBreaches,
      footwallBreaches: m.footwallBreaches,
      meanHangingwallOverbreak: m.meanHangingwallOverbreak ?? '',
      meanStopeWidth: m.meanStopeWidth ?? '',
      minStopeWidth: m.minStopeWidth ?? '',
      maxStopeWidth: m.maxStopeWidth ?? '',
      measuredBy: m.measuredBy.name,
    }));

    if (q.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="stope-width-control.csv"');
      return toCsv(rows);
    }
    return {
      title: 'Stope Width Control',
      generatedAt: new Date().toISOString(),
      basis: 'Face measurements per UNKI-MIN-MRM-STD-201 §9.8. Limits shown are those applied when each face was measured.',
      count: rows.length,
      rows,
    };
  });

  /* ── sampling report (§26) ─────────────────────────────────────────── */

  app.get('/reports/samples', { preHandler: [app.requireAction('report:generate')] }, async (request, reply) => {
    const q = rangeQuery.parse(request.query);
    const where =
      q.from || q.to
        ? { collectedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {};

    const samples = await prisma.sample.findMany({
      where,
      include: {
        faceLog: { include: { workplace: { include: { section: true } } } },
        collectedBy: { select: { name: true } },
      },
      orderBy: { collectedAt: 'desc' },
      take: 1000,
    });

    const rows = samples.map((s) => ({
      sampleNumber: s.sampleNumber,
      sampleType: s.sampleType,
      level: s.faceLog.workplace.section.code,
      workplace: s.faceLog.workplace.code,
      fromPosition: s.fromPosition ?? '',
      toPosition: s.toPosition ?? '',
      length: s.length ?? '',
      reefClassification: s.reefClassification ?? '',
      collectedBy: s.collectedBy.name,
      collectedAt: s.collectedAt.toISOString(),
      status: s.status,
    }));

    if (q.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="sampling-report.csv"');
      return toCsv(rows);
    }
    return { title: 'Sampling Report', generatedAt: new Date().toISOString(), count: rows.length, rows };
  });
}
