import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '../packages/db/dist/generated/client/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const originalUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!originalUrl) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL for isolated integration tests');
const schema = `cashback_test_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^cashback_test_[a-f0-9]{32}$/);
const url = new URL(originalUrl); url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.href;
process.env.HOLDING_PERIOD_HOURS = '1';
const control = new PrismaClient({ datasources: { db: { url: originalUrl } } });
let db;
let web;
try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const dbRequire = createRequire(path.join(root, 'packages/db/package.json'));
  const migrated = spawnSync(process.execPath, [dbRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: path.join(root, 'packages/db'), env: process.env, encoding: 'utf8', timeout: 60000
  });
  if (migrated.status !== 0) throw new Error('Migration failed in isolated schema: ' + (migrated.stderr ?? '').replaceAll(originalUrl, '[database]'));
  ({ db } = await import('../packages/db/dist/index.js'));
  console.log('PASS: migrations applied to isolated schema');
  const core = await import('../packages/core/dist/index.js');
  const exchange = await db.exchange.create({ data: { slug: 'bybit', name: 'Bybit', status: 'PUBLISHED', defaultCashbackRate: '0.3', logoUrl: '/exchange-logos/bybit.png' } });
  const alice = await db.customer.create({ data: { email: 'alice@test.invalid' } });
  const bob = await db.customer.create({ data: { email: 'bob@test.invalid' } });
  const offer = await db.offer.create({ data: { exchangeId: exchange.id, cashbackRate: '0.5', status: 'PUBLISHED' } });
  const referral = await db.referralLink.create({ data: { exchangeId: exchange.id, offerId: offer.id, destination: 'https://www.bybit.com/' } });
  const base = { exchangeId: exchange.id, rootAccount: 'bybit-test-root', reportType: 'AGGREGATE', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-09-01T23:59:59Z', sourceTz: 'UTC' };
  async function runNext(expected) {
    const job = await core.claimNextJob(120, 'test');
    assert(job && job.lockedBy); if (expected) assert.equal(job.type, expected);
    const lease = { id: job.id, lockedBy: job.lockedBy };
    if (job.type === 'PARSE') await core.parseImportJob(lease, job.payload.batchId);
    else if (job.type === 'PUBLISH') await core.publishImportJob(lease, job.payload.batchId);
    else if (job.type === 'ATTRIBUTE') await core.attributeJob(lease, job.payload.exchangeId);
    else if (job.type === 'RELEASE_HOLDS') await core.releaseHoldsJob(lease);
    else throw Error('Unexpected job type');
    assert.equal((await db.job.findUnique({where: { id: job.id }})).state, 'DONE');
  }
  async function importCsv(text, metadata = {}) {
    const result = await core.createImportBatch({ ...base, ...metadata }, { bytes: Buffer.from(text), extension: 'csv' });
    await runNext('PARSE'); return result.batchId;
  }
  async function report(amount, metadata = {}) {
    const id = await importCsv(`uid,asset,commission\n00123,USDT,${amount}`, metadata);
    assert.equal((await core.getImportPreview(id)).preview.flaggedRows, 0);
    await Promise.all([core.commitImportBatch(id), core.commitImportBatch(id)]);
    assert.equal(await db.job.count({ where: { type: 'PUBLISH', state: 'PENDING' } }), 1);
    await runNext('PUBLISH'); await runNext('ATTRIBUTE'); return id;
  }
  const claim = await core.createUidLink(alice.id, { exchangeId: exchange.id, uid: '00123', referralLinkId: referral.id });
  const other = await core.createUidLink(bob.id, { exchangeId: exchange.id, uid: '00123' });
  assert.equal((await core.createUidLink(alice.id, { exchangeId: exchange.id, uid: '00123' })).id, claim.id);
  assert.equal((await core.getWallet(alice.id)).hasData, false);
  await report('100');
  assert.equal((await core.getWallet(alice.id)).hasData, false, 'Report membership alone must not award money');
  await core.approveUidOwnership(claim.id, 'admin-test', 'Verified control via test support ticket');
  await core.approveUidOwnership(other.id, 'admin-test', 'Competing test ownership claim');
  await runNext('ATTRIBUTE'); await runNext('ATTRIBUTE');
  assert.equal((await db.uidLink.findUnique({ where: { id: claim.id } })).status, 'VERIFIED');
  assert.equal((await db.uidLink.findUnique({ where: { id: other.id } })).status, 'REJECTED');
  assert.equal((await core.getWallet(alice.id)).balances[0].pending, '30.0000000000', 'Uncorroborated customer offer must not override default rate');
  assert.equal((await core.getWallet(bob.id)).hasData, false);
  console.log('PASS: ownership and initial commission credit');
  await report('100');
  assert.equal((await core.getWallet(alice.id)).balances[0].pending, '30.0000000000', 'Reimport must not double credit');
  await db.exchange.update({ where: { id: exchange.id }, data: { defaultCashbackRate: '0.9' } });
  await report('60');
  assert.equal((await core.getWallet(alice.id)).balances[0].pending, '18.0000000000', 'Rate snapshot persists across corrections');
  await core.scheduleHoldRelease(); await runNext('RELEASE_HOLDS');
  assert.equal((await core.getWallet(alice.id)).balances[0].available, '0.0000000000');
  await db.walletEntry.updateMany({ where: { remainingPending: { gt: 0 } }, data: { availableAt: new Date(Date.now() - 1000) } });
  await core.scheduleHoldRelease(); await runNext('RELEASE_HOLDS');
  let wallet = await core.getWallet(alice.id);
  assert.equal(wallet.balances[0].pending, '0.0000000000'); assert.equal(wallet.balances[0].available, '18.0000000000');
  await core.scheduleHoldRelease(); await runNext('RELEASE_HOLDS');
  assert.equal((await core.getWallet(alice.id)).balances[0].available, '18.0000000000', 'Hold release is idempotent');
  await db.wallet.updateMany({ where: { customerId: alice.id }, data: { available: 0, withdrawn: 18 } }); // Fixture: funds already paid.
  await report('40'); assert.equal((await core.getWallet(alice.id)).balances[0].receivable, '6.0000000000');
  await report('100'); wallet = await core.getWallet(alice.id);
  assert.equal(wallet.balances[0].receivable, '0.0000000000'); assert.equal(wallet.balances[0].pending, '12.0000000000');
  const creditedEntries = await db.walletEntry.findMany({ where: { wallet: { customerId: alice.id }, type: 'CREDIT' } });
  assert(creditedEntries.every(entry => entry.balanceChanges && typeof entry.balanceChanges.pending === 'string'));
  console.log('PASS: corrections, rate snapshots, hold release and receivable offset');
  const overlap = await importCsv('uid,asset,commission\n00123,USDT,200', { periodEnd: '2026-09-02T23:59:59Z' });
  assert.equal((await core.getImportPreview(overlap)).preview.flaggedRows, 1);
  await assert.rejects(() => core.commitImportBatch(overlap));
  const malformed = await importCsv('uid,asset,volume\n00123,USDT,200');
  assert.equal((await core.getImportPreview(malformed)).batch.status, 'FAILED');
  await assert.rejects(() => core.createImportBatch(base, { bytes: Buffer.from('dummy'), extension: 'xlsx' }));
  // Lost leases roll back every business write, even if the handler began with a valid lease.
  const leaseJob = await db.job.create({ data: { type: 'ATTRIBUTE', payload: {} } });
  const claimed = await core.claimNextJob(120, 'lease-test'); assert.equal(claimed.id, leaseJob.id);
  await assert.rejects(() => core.withJobLease({ id: claimed.id, lockedBy: claimed.lockedBy }, async tx => {
    await tx.exchange.update({ where: { id: exchange.id }, data: { name: 'Must roll back' } });
    await tx.job.update({ where: { id: claimed.id }, data: { leaseUntil: new Date(0) } });
  }), /LEASE_LOST/);
  assert.equal((await db.exchange.findUnique({ where: { id: exchange.id } })).name, 'Bybit');
  await db.job.update({ where: { id: claimed.id }, data: { leaseUntil: new Date(0) } }); await core.reapExpiredJobs();
  const reclaimed = await core.claimNextJob(120, 'replacement');
  assert.notEqual(reclaimed.lockedBy, claimed.lockedBy);
  assert.equal((await core.heartbeat({ id: claimed.id, lockedBy: claimed.lockedBy }, 120)).count, 0);
  await assert.rejects(() => core.withJobLease({ id: claimed.id, lockedBy: claimed.lockedBy }, async () => {}), /LEASE_LOST/);
  await core.withJobLease({ id: reclaimed.id, lockedBy: reclaimed.lockedBy }, async () => {});
  assert.equal((await core.getWallet(bob.id)).history.length, 0, 'Customer data remains isolated');
  await assert.rejects(() => core.getWallet(bob.id, wallet.history[0].id));
  // An invalid second row must roll back a first row that already wrote its version.
  const rollbackId = await importCsv('uid,asset,commission\n88801,USDT,10\n88802,USDT,10', { periodStart: '2026-09-03T00:00:00Z', periodEnd: '2026-09-03T23:59:59Z' });
  const staged = await db.stagingRow.findMany({ where: { batchId: rollbackId }, orderBy: { id: 'asc' } });
  await db.stagingRow.update({ where: { id: staged[1].id }, data: { normalized: { ...staged[1].normalized, referralLinkId: 'missing-referral' } } });
  await core.commitImportBatch(rollbackId);
  const rollbackJob = await core.claimNextJob(120, 'rollback');
  await assert.rejects(() => core.publishImportJob({ id: rollbackJob.id, lockedBy: rollbackJob.lockedBy }, rollbackId), /INVALID_REPORT_REFERRAL_LINK/);
  assert.equal(await db.commissionVersion.count({ where: { batchId: rollbackId } }), 0);
  assert.equal(await db.commissionRecord.count({ where: { uid: { in: ['88801', '88802'] } } }), 0);
  await core.failJob({ id: rollbackJob.id, lockedBy: rollbackJob.lockedBy }, 5, new Error('Test failure'));
  assert.equal((await core.getImportPreview(rollbackId)).batch.status, 'FAILED');
  console.log('PASS: atomic publish rollback and failed-batch status');

  // Exercise real Next handlers and server-rendered home with isolated sessions.
  const password = 'BybitLocalTest123!';
  const bcrypt = createRequire(path.join(root, 'packages/core/package.json'))('bcryptjs');
  await db.customer.update({ where: { id: alice.id }, data: { passwordHash: await bcrypt.hash(password, 4) } });
  const aliceToken = await core.createSession('CUSTOMER', alice.id);
  const bobToken = await core.createSession('CUSTOMER', bob.id);
  const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
  web = spawn(process.execPath, [webRequire.resolve('next/dist/bin/next'), 'start', '-p', '3198', '-H', '127.0.0.1'], {
    cwd: path.join(root, 'apps/web'), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'ignore'
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch('http://127.0.0.1:3198/api/health'); if (response.ok) { ready = true; break; } } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'Next server started');
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'cashback_session';
  const get = (route, token) => fetch(`http://127.0.0.1:3198${route}`, { headers: token ? { Cookie: `${cookieName}=${token}` } : {} });
  assert.equal((await get('/api/me/wallet')).status, 401);
  const response = await get('/api/me/wallet', aliceToken);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const apiWallet = await response.json();
  assert.equal(apiWallet.balances[0].pending, '12.0000000000');
  const { walletResponseSchema } = await import('../packages/contracts/dist/index.js');
  walletResponseSchema.parse(apiWallet);
  assert.equal((await (await get(`/api/me/wallet?customerId=${alice.id}`, bobToken)).json()).hasData, false);
  assert.equal((await get('/api/admin/uids', aliceToken)).status, 403);
  const crossOrigin = await fetch('http://127.0.0.1:3198/api/me/uids', { method: 'POST', headers: { Cookie: `${cookieName}=${aliceToken}`, Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeId: exchange.id, uid: '123' }) });
  assert.equal(crossOrigin.status, 403);
  const guestHtml = await (await get('/')).text(); assert(guestHtml.includes('Sign in to check cashback'));
  const ownHtml = await (await get('/', aliceToken)).text();
  assert(ownHtml.indexOf('id="cashback-title"') < ownHtml.indexOf('Crypto affiliate cashback'));
  assert(ownHtml.includes('00123')); assert(ownHtml.includes('Pending'));
  console.log('PASS: real HTTP authentication, account isolation, private cache, home placement and wallet payload');
  if (process.env.BYBIT_PREVIEW_STOP_FILE) {
    console.log('PREVIEW: http://127.0.0.1:3198/login (alice@test.invalid / BybitLocalTest123! — isolated test data only)');
    const deadline = Date.now() + 300000;
    while (!existsSync(process.env.BYBIT_PREVIEW_STOP_FILE) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log('PASS: isolated migrations, CSV upload/parse/publish, ownership verification, rate snapshots, idempotent credit/release, reversals/debt offset, overlap rejection, customer isolation, lease fencing');
} finally {
  if (web && web.exitCode === null) { web.kill(); await new Promise(resolve => web.once('exit', resolve)); }
  await db?.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}
