import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actionsFor } from '@geotech/core';
import type { Env } from '../env.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { checkPasswordPolicy, hashPassword, hashToken, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import type { AccessTokenPayload } from '../plugins/auth.js';

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().optional(),
  platform: z.string().optional(),
  appVersion: z.string().optional(),
});

export default async function authRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;

  const issueTokens = async (
    user: { id: string; role: string; name: string },
    deviceId?: string,
  ) => {
    const base: AccessTokenPayload = {
      sub: user.id,
      role: user.role as AccessTokenPayload['role'],
      name: user.name,
      scope: 'full',
      ...(deviceId ? { deviceId } : {}),
    };

    const accessToken = app.jwt.sign(base, { expiresIn: env.ACCESS_TOKEN_TTL });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), deviceId: deviceId ?? null, expiresAt },
    });

    // The offline capture grant. A device carries this underground; it permits
    // recording observations and nothing else, and it expires on the mine's
    // configured schedule whether or not the device ever sees the server again.
    const offlineGrant = deviceId
      ? app.jwt.sign(
          { ...base, scope: 'offline_capture' as const },
          { expiresIn: `${env.OFFLINE_GRANT_HOURS}h` },
        )
      : null;

    return { accessToken, refreshToken, offlineGrant, offlineGrantExpiresInHours: env.OFFLINE_GRANT_HOURS };
  };

  app.post('/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const identifier = body.identifier.trim();

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { employeeNo: identifier.toUpperCase() }],
      },
    });

    // One message and one code path for "no such user" and "wrong password",
    // so the endpoint cannot be used to enumerate employee numbers.
    const placeholder = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==';
    const ok = await verifyPassword(body.password, user?.passwordHash ?? placeholder);
    if (!user || !ok) {
      throw unauthorized('Employee number or password is incorrect.');
    }
    if (!user.active) {
      throw unauthorized('This account has been deactivated. Contact your administrator.');
    }

    if (body.deviceId) {
      await prisma.device.upsert({
        where: { deviceId: body.deviceId },
        create: {
          deviceId: body.deviceId,
          userId: user.id,
          platform: body.platform ?? null,
          appVersion: body.appVersion ?? null,
          lastSeenAt: new Date(),
        },
        update: {
          userId: user.id,
          platform: body.platform ?? null,
          appVersion: body.appVersion ?? null,
          lastSeenAt: new Date(),
        },
      });
    }

    const tokens = await issueTokens(user, body.deviceId);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(prisma, {
      userId: user.id,
      entity: 'User',
      entityId: user.id,
      action: 'LOGIN',
      deviceId: body.deviceId ?? null,
      ipAddress: request.ip,
    });

    return {
      ...tokens,
      sessionIdleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES,
      user: {
        id: user.id,
        name: user.name,
        employeeNo: user.employeeNo,
        email: user.email,
        role: user.role,
        department: user.department,
        mustChangePassword: user.mustChangePassword,
        permissions: actionsFor(user.role),
      },
    };
  });

  app.post('/auth/refresh', async (request) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(request.body);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw unauthorized('Your session has expired. Sign in again.');
    }
    if (!stored.user.active) {
      throw unauthorized('This account has been deactivated. Contact your administrator.');
    }

    // Rotation: the presented token is retired as the new one is issued, so a
    // stolen refresh token is usable at most once and the theft is detectable.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return issueTokens(stored.user, stored.deviceId ?? undefined);
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (request) => {
    const { refreshToken } = z
      .object({ refreshToken: z.string().optional() })
      .parse(request.body ?? {});
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await prisma.refreshToken.updateMany({
        where: { userId: request.auth!.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.auth!.sub } });
    if (!user) throw unauthorized();
    return {
      id: user.id,
      name: user.name,
      employeeNo: user.employeeNo,
      email: user.email,
      role: user.role,
      department: user.department,
      permissions: actionsFor(user.role),
    };
  });

  app.post('/auth/change-password', { preHandler: [app.authenticate] }, async (request) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) })
      .parse(request.body);

    const user = await prisma.user.findUnique({ where: { id: request.auth!.sub } });
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw unauthorized('Current password is incorrect.');
    }

    const problems = checkPasswordPolicy(body.newPassword);
    if (problems.length) {
      throw badRequest('auth.password_policy', problems.join(' '), { problems });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
    });
    // Every other session is ended: a password change is often a response to a
    // suspected compromise.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(prisma, {
      userId: user.id,
      entity: 'User',
      entityId: user.id,
      action: 'PASSWORD_CHANGED',
      ipAddress: request.ip,
    });

    return { ok: true };
  });
}
