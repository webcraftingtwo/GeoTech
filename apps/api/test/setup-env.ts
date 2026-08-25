/**
 * Runs before any test module is imported, so the Prisma client picks up the
 * test database rather than the development one.
 */
process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'] ?? 'postgresql://geotech@127.0.0.1:5432/geotech_test?schema=public';
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret-value-not-for-production';
process.env['SITE_CODE'] = 'UNK';
process.env['STORAGE_LOCAL_PATH'] = './.test-storage';
