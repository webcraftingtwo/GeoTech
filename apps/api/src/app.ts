import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Env } from './env.js';
import { ApiError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import adminRoutes from './routes/admin.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import photoRoutes from './routes/photos.js';
import recordRoutes from './routes/records.js';
import reportRoutes from './routes/reports.js';
import reviewRoutes from './routes/review.js';
import searchRoutes from './routes/search.js';
import syncRoutes from './routes/sync.js';

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(multipart);
  await app.register(authPlugin, { secret: env.JWT_SECRET });

  /**
   * Every error leaves here with a code and a sentence someone can act on.
   * "Something went wrong" is not an acceptable response in this system (§42).
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'validation.request',
          message: 'The request could not be read. Some fields are missing or the wrong type.',
          details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return reply.status(409).send({
        error: {
          code: 'db.unique_constraint',
          message: 'A record with this identifier already exists.',
          details: (error as { meta?: unknown }).meta,
        },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: {
        code: 'server.unexpected',
        message:
          'The server could not complete this request. Nothing you sent has been lost — it stays queued and will be retried.',
      },
    });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'unki-geotech-api', time: new Date().toISOString() }));

  await app.register(async (api) => {
    await api.register(authRoutes, { env });
    await api.register(syncRoutes, { env });
    await api.register(recordRoutes);
    await api.register(reviewRoutes);
    await api.register(dashboardRoutes);
    await api.register(searchRoutes);
    await api.register(reportRoutes);
    await api.register(adminRoutes);
    await api.register(auditRoutes);
    await api.register(photoRoutes, { env });
  }, { prefix: '/api/v1' });

  return app;
}
