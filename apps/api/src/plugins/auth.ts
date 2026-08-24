import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { can, type Action, type Role } from '@geotech/core';
import { forbidden, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  name: string;
  /**
   * `full` for an online session; `offline_capture` for the sealed grant a
   * device carries underground, which permits capture and nothing else (§31).
   */
  scope: 'full' | 'offline_capture';
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAction: (
      action: Action,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth?: AccessTokenPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

/**
 * Actions a device may perform on an offline capture grant. Deliberately
 * narrow: a grant that has not touched the server for hours must not be able
 * to interpret geology, review records or change configuration.
 */
const OFFLINE_GRANT_ACTIONS: Action[] = [
  'facelog:create',
  'facelog:edit_own_draft',
  'facelog:submit',
  'facelog:read_own',
  'observation:create',
  'hazard:create',
  'sample:create',
];

export default fp(async function authPlugin(app: FastifyInstance, opts: { secret: string }) {
  await app.register(fastifyJwt, { secret: opts.secret });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized('Your session has expired. Sign in again to continue.');
    }
    const payload = request.user as AccessTokenPayload;

    // The token is not the authority on whether the account still exists or is
    // still active — a deactivated user's live token must stop working.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true, role: true },
    });
    if (!user || !user.active) {
      throw unauthorized('This account is no longer active. Contact your administrator.');
    }
    // Role changes take effect immediately rather than at next sign-in.
    request.auth = { ...payload, role: user.role as Role };
  });

  app.decorate('requireAction', (action: Action) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) await app.authenticate(request, reply);
    const auth = request.auth!;

    if (auth.scope === 'offline_capture' && !OFFLINE_GRANT_ACTIONS.includes(action)) {
      throw forbidden(
        'This device is running on an offline capture grant, which allows recording observations only. Sign in on surface to perform this action.',
      );
    }
    if (!can(auth.role, action)) {
      throw forbidden(
        `Your role (${auth.role.toLowerCase().replace('_', ' ')}) does not permit this action.`,
      );
    }
  });
});
