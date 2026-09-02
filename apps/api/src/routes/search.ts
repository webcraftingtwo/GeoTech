import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

/**
 * Search (§27).
 *
 * Two things are searchable and they are not the same: an *identifier* a
 * technician read off a screen, and a *question* a geologist has about the
 * rock. Both arrive in the same box, so the query is parsed for structured
 * terms first, then falls back to matching identifiers and free text.
 *
 * `faults > 2m level 12` becomes: structure type FAULT, apparent offset ≥ 2 m,
 * level 12.
 */
interface ParsedQuery {
  text: string;
  structureType?: string;
  minOffset?: number;
  maxOffset?: number;
  sectionCode?: string;
  recordId?: string;
}

/** "12 south", "12S" and "12  South" all mean section 12S. */
export function normaliseSection(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^(\d{1,2})\s*(north|south|east|west|n|s|e|w)$/.exec(cleaned);
  if (m) return `${m[1]}${m[2]![0]!.toUpperCase()}`;
  return cleaned.toUpperCase();
}

const STRUCTURE_WORDS: Record<string, string> = {
  fault: 'FAULT',
  faults: 'FAULT',
  dyke: 'DYKE',
  dykes: 'DYKE',
  joint: 'JOINT',
  joints: 'JOINT',
  shear: 'SHEAR',
  shears: 'SHEAR',
};

export function parseQuery(raw: string): ParsedQuery {
  const q: ParsedQuery = { text: raw.trim() };
  const lower = raw.toLowerCase();

  if (/^[A-Z0-9]{2,6}-[A-Z]{2,4}-\d{4}-\d{6}/i.test(raw.trim())) {
    q.recordId = raw.trim().toUpperCase();
    return q;
  }

  for (const [word, code] of Object.entries(STRUCTURE_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      q.structureType = code;
      break;
    }
  }

  const gt = /(?:>|greater than|over|more than)\s*([\d.]+)\s*m?/.exec(lower);
  if (gt) q.minOffset = Number(gt[1]);

  const lt = /(?:<|less than|under)\s*([\d.]+)\s*m?/.exec(lower);
  if (lt) q.maxOffset = Number(lt[1]);

  // Unki organises by section, not level: "12 South", "12S". Both the word
  // "section" and a bare section code are accepted, because a geologist
  // types what they say underground.
  const section = /\bsection\s*([\w-]+(?:\s+(?:north|south|east|west))?)/.exec(lower);
  if (section) q.sectionCode = normaliseSection(section[1]!);
  else {
    const bare = /\b(\d{1,2}\s*(?:north|south|east|west|n|s|e|w))\b/.exec(lower);
    if (bare) q.sectionCode = normaliseSection(bare[1]!);
  }

  return q;
}

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search', { preHandler: [app.authenticate] }, async (request) => {
    const { q, take } = z
      .object({ q: z.string().min(1), take: z.coerce.number().min(1).max(100).default(25) })
      .parse(request.query);

    const parsed = parseQuery(q);
    const text = parsed.text;

    // A record identifier is an exact lookup, not a search.
    if (parsed.recordId) {
      const [faceLog, offset, structure, hazard] = await Promise.all([
        prisma.faceLog.findUnique({ where: { recordId: parsed.recordId }, include: { workplace: true } }),
        prisma.offset.findUnique({ where: { recordId: parsed.recordId } }),
        prisma.structure.findUnique({ where: { recordId: parsed.recordId } }),
        prisma.hazard.findUnique({ where: { recordId: parsed.recordId } }),
      ]);
      return { parsed, faceLogs: faceLog ? [faceLog] : [], offsets: offset ? [offset] : [], structures: structure ? [structure] : [], hazards: hazard ? [hazard] : [], samples: [] };
    }

    const [faceLogs, offsets, samples, hazards] = await Promise.all([
      prisma.faceLog.findMany({
        where: {
          OR: [
            { recordId: { contains: text, mode: 'insensitive' } },
            { surveyReference: { contains: text, mode: 'insensitive' } },
            { notes: { contains: text, mode: 'insensitive' } },
            { workplace: { code: { contains: text, mode: 'insensitive' } } },
            { technician: { name: { contains: text, mode: 'insensitive' } } },
          ],
          ...(parsed.sectionCode ? { workplace: { section: { code: parsed.sectionCode } } } : {}),
        },
        include: { workplace: { include: { section: true } }, technician: { select: { name: true } } },
        take,
      }),
      prisma.offset.findMany({
        where: {
          ...(parsed.structureType ? { structure: { structureType: parsed.structureType } } : {}),
          ...(parsed.minOffset !== undefined || parsed.maxOffset !== undefined
            ? {
                apparentOffset: {
                  ...(parsed.minOffset !== undefined ? { gte: parsed.minOffset } : {}),
                  ...(parsed.maxOffset !== undefined ? { lte: parsed.maxOffset } : {}),
                },
              }
            : {}),
          ...(parsed.sectionCode
            ? { structure: { observation: { faceLog: { workplace: { section: { code: parsed.sectionCode } } } } } }
            : {}),
          ...(!parsed.structureType && parsed.minOffset === undefined && parsed.maxOffset === undefined && !parsed.sectionCode
            ? { OR: [{ recordId: { contains: text, mode: 'insensitive' } }, { markerRef: { contains: text, mode: 'insensitive' } }] }
            : {}),
        },
        include: {
          structure: {
            include: {
              observation: {
                include: { faceLog: { include: { workplace: { include: { section: true } } } } },
              },
            },
          },
        },
        orderBy: { apparentOffset: 'desc' },
        take,
      }),
      prisma.sample.findMany({
        where: { OR: [{ sampleNumber: { contains: text, mode: 'insensitive' } }, { barcode: { contains: text, mode: 'insensitive' } }] },
        take,
      }),
      prisma.hazard.findMany({
        where: { OR: [{ recordId: { contains: text, mode: 'insensitive' } }, { description: { contains: text, mode: 'insensitive' } }] },
        take,
      }),
    ]);

    return { parsed, faceLogs, offsets, samples, hazards, structures: [] };
  });
}
