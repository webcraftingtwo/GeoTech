import { z } from 'zod';

/**
 * Configuration is read once, validated, and never re-read. A misconfigured
 * server should fail to start rather than fail at 3 a.m. on a sync request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().default(60),

  /**
   * How long a device may keep capturing underground without reaching the
   * server. Set to the mine IT policy (§31).
   */
  OFFLINE_GRANT_HOURS: z.coerce.number().default(16),

  SITE_CODE: z.string().default('UNK'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
  CORS_ORIGINS: z.string().default('*'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.includes('change-me')) {
    throw new Error('JWT_SECRET is still the example value. Set a strong per-environment secret.');
  }
  return parsed.data;
}
