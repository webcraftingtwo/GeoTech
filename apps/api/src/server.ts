import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { prisma } from './lib/prisma.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = loadEnv();
const app = await buildApp(env);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(`Unki GeoTech API listening on ${env.HOST}:${env.PORT}`);
