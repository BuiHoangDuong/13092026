// One-off probe: report the Railway Postgres server version and whether the connecting
// role can create databases (needed to decide on a temp restore target for the drill).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '../packages/db/dist/generated/client/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
try {
  const v = await db.$queryRawUnsafe('SHOW server_version');
  const who = await db.$queryRawUnsafe('SELECT current_user AS u, current_database() AS d');
  const role = await db.$queryRawUnsafe(
    "SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname = current_user"
  );
  const dbs = await db.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  );
  console.log('SERVER_VERSION=' + JSON.stringify(v));
  console.log('WHOAMI=' + JSON.stringify(who));
  console.log('ROLE=' + JSON.stringify(role));
  console.log('PUBLIC_TABLES=' + JSON.stringify(dbs));
} finally {
  await db.$disconnect();
}
