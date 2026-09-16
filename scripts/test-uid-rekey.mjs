import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '../packages/db/dist/generated/client/index.js';
dotenv.config({ path: '.env', quiet: true });
const url=process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if(!url) throw new Error('Configure a test database');
const schema=`cashback_test_${randomUUID().replaceAll('-','')}`;
assert.match(schema,/^cashback_test_[a-f0-9]{32}$/);
const db=new PrismaClient({datasources:{db:{url}}});
const require=createRequire(path.resolve('packages/db/package.json'));
const dir='packages/db/prisma/migrations';
// Discover prior SQL in order, preserving the original migration files unchanged.
const { readdirSync } = await import('node:fs');
const previous=readdirSync(dir).filter(x=>x<'202609160003_uid_first' && !x.includes('.')).sort();
const fixture=`
INSERT INTO "Exchange" (id,slug,name,"updatedAt") VALUES ('ex','bybit','Bybit',now());
INSERT INTO "Customer" (id,email) VALUES ('old','old@test.invalid');
INSERT INTO "AdminAccount" (id,email) VALUES ('admin','admin@test.invalid');
INSERT INTO "Session" (id,"principalType","subjectId","tokenHash","expiresAt") VALUES ('as','ADMIN','admin','ah',now()+interval '1 day'),('cs','CUSTOMER','old','ch',now()+interval '1 day');
INSERT INTO "UidLink" (id,"customerId","exchangeId",uid,status) VALUES ('link','old','ex','00123','VERIFIED');
INSERT INTO "CommissionRecord" (id,"exchangeId",uid,asset,"dedupKey","periodStart","periodEnd","attributedCustomerId","creditedCashback","updatedAt") VALUES ('record','ex','00123','USDT','key',now(),now(),'old',30,now());
INSERT INTO "Wallet" (id,"customerId",asset,pending,available,receivable) VALUES ('wallet','old','USDT',18,12,6);
INSERT INTO "WalletEntry" (id,"walletId",type,amount,"remainingPending") VALUES ('entry','wallet','CREDIT',30,18);
INSERT INTO "Withdrawal" (id,"customerId",asset,amount,network,address,status,"updatedAt") VALUES ('withdraw','old','USDT',1,'TRON','fixture-address','CANCELLED',now());
INSERT INTO "WithdrawalEvent" (id,"withdrawalId","toStatus","actorType","actorId") VALUES ('event','withdraw','CANCELLED','CUSTOMER','old');
`;
function execute(sql) {
 return spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'db','execute','--stdin','--schema',path.resolve('packages/db/prisma/schema.prisma')],{input:sql,env:{...process.env,DATABASE_URL:url},encoding:'utf8',timeout:90000});
}
const ambiguousSchema=`${schema}_ambiguous`;
assert.match(ambiguousSchema,/^cashback_test_[a-f0-9]{32}_ambiguous$/);
try {
 await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
 const sql=`SET search_path TO "${schema}";\n`+previous.map(x=>readFileSync(`${dir}/${x}/migration.sql`,'utf8')).join('\n')+fixture+readFileSync(`${dir}/202609160003_uid_first/migration.sql`,'utf8');
 const run=execute(sql);
 assert.equal(run.status,0,(run.stderr??'Migration failed').replaceAll(url,'[database]'));
 const wallets=await db.$queryRawUnsafe(`SELECT * FROM "${schema}"."Wallet"`);
 assert.equal(wallets[0].id,'wallet');assert.equal(wallets[0].pending.toString(),'18');assert.equal(wallets[0].available.toString(),'12');assert.equal(wallets[0].receivable.toString(),'6');
 const accounts=await db.$queryRawUnsafe(`SELECT * FROM "${schema}"."UidAccount"`);
 assert.equal(accounts.length,1);assert.equal(accounts[0].uid,'00123');assert.equal(accounts[0].boundEmail,null);assert.equal(wallets[0].uidAccountId,accounts[0].id);
 const sessions=await db.$queryRawUnsafe(`SELECT * FROM "${schema}"."Session"`);assert.equal(sessions.length,1);assert.equal(sessions[0].adminId,'admin');
 const entries=await db.$queryRawUnsafe(`SELECT * FROM "${schema}"."WalletEntry"`);assert.equal(entries[0].id,'entry');assert.equal(entries[0].remainingPending.toString(),'18');
 const events=await db.$queryRawUnsafe(`SELECT * FROM "${schema}"."WithdrawalEvent"`);assert.equal(events[0].actorType,'CLAIMANT');
 const withdrawals=await db.$queryRawUnsafe(`SELECT * FROM "${schema}"."Withdrawal"`);assert.equal(withdrawals[0].isFirst,true);assert.equal(withdrawals[0].email,'old@test.invalid');
 console.log('PASS: populated UID re-key preserves balances, pending lots, audit history and admin session; does not trust legacy email');
 await db.$executeRawUnsafe(`CREATE SCHEMA "${ambiguousSchema}"`);
 const prefix=`SET search_path TO "${ambiguousSchema}";\n`;
 const old=execute(prefix+previous.map(x=>readFileSync(`${dir}/${x}/migration.sql`,'utf8')).join('\n')+fixture+`INSERT INTO "CommissionRecord" (id,"exchangeId",uid,asset,"dedupKey","periodStart","periodEnd","attributedCustomerId","updatedAt") VALUES ('second','ex','00999','USDT','second',now(),now(),'old',now());`);
 assert.equal(old.status,0,(old.stderr??'Fixture failed').replaceAll(url,'[database]'));
 const rejected=execute(prefix+readFileSync(`${dir}/202609160003_uid_first/migration.sql`,'utf8'));
 assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/ambiguous\/unmapped legacy wallets/);
 const unchanged=await db.$queryRawUnsafe(`SELECT "customerId",pending FROM "${ambiguousSchema}"."Wallet"`);
 assert.equal(unchanged[0].customerId,'old');assert.equal(unchanged[0].pending.toString(),'18');
 console.log('PASS: ambiguous legacy allocation rejects and rolls back without changing money');
} finally {
 await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
 await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ambiguousSchema}" CASCADE`);
 await db.$disconnect();
}
