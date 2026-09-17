import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '../packages/db/dist/generated/client/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const c = new PrismaClient({ datasources: { db: { url } } });
try {
  const rows = await c.$queryRawUnsafe(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'cashback_test_%'`
  );
  console.log('Found test schemas:', rows.map(r => r.schema_name));
  for (const r of rows) {
    await c.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${r.schema_name}" CASCADE`);
    console.log('Dropped', r.schema_name);
  }
  console.log('CLEANUP_DONE count=' + rows.length);
} finally {
  await c.$disconnect();
}
