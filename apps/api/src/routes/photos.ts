import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

/**
 * Photograph upload (§8).
 *
 * Photographs sync separately from the records they belong to and always last:
 * a 3 MB image must never hold up the observation it illustrates. The record
 * lands first with its photo rows pending, and the binaries follow.
 *
 * The original is stored exactly as captured. Annotations from the digital face
 * mapping are a separate vector layer on the row (§9) — the image itself is
 * never written over.
 */
const MAX_BYTES = 25 * 1024 * 1024;

export default async function photoRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;

  app.post('/photos/:localId/upload', { preHandler: [app.requireAction('observation:create')] }, async (request) => {
    const { localId } = z.object({ localId: z.string() }).parse(request.params);

    const photo = await prisma.photo.findUnique({ where: { localId } });
    if (!photo) {
      throw notFound('Photo record — sync the face log before uploading its photographs');
    }

    const file = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) throw badRequest('photo.no_file', 'No image was included in the upload.');

    const buffer = await file.toBuffer();
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // An identical image already stored is not uploaded twice; the hash is also
    // the integrity proof that the stored file is what left the device.
    if (photo.sha256 === sha256 && photo.storageKey) {
      return { ok: true, deduplicated: true, storageKey: photo.storageKey, sha256 };
    }

    const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `${photo.faceLogId}/${photo.id}.${ext}`;
    const target = path.join(env.STORAGE_LOCAL_PATH, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);

    const updated = await prisma.photo.update({
      where: { id: photo.id },
      data: {
        storageKey: key,
        mimeType: file.mimetype,
        bytes: buffer.byteLength,
        sha256,
        uploadedAt: new Date(),
      },
    });

    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'PHOTO',
      entityId: photo.id,
      action: 'PHOTO_UPLOADED',
      newValue: { storageKey: key, bytes: buffer.byteLength, sha256 },
      deviceId: photo.deviceId,
      ipAddress: request.ip,
    });

    return { ok: true, storageKey: updated.storageKey, sha256, bytes: updated.bytes };
  });

  /** Saves or replaces the face-mapping annotation layer (§9). */
  app.put('/photos/:id/annotations', { preHandler: [app.requireAction('observation:create')] }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ annotations: z.array(z.record(z.unknown())) }).parse(request.body);

    const before = await prisma.photo.findUnique({ where: { id } });
    if (!before) throw notFound('Photo');

    const updated = await prisma.photo.update({
      where: { id },
      data: { annotations: body.annotations as Prisma.InputJsonValue, version: { increment: 1 } },
    });

    await recordAudit(prisma, {
      userId: request.auth!.sub,
      entity: 'PHOTO',
      entityId: id,
      action: 'ANNOTATIONS_UPDATED',
      oldValue: before.annotations,
      newValue: body.annotations,
      ipAddress: request.ip,
    });

    return updated;
  });
}
