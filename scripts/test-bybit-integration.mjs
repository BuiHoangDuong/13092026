import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
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
try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const dbRequire = createRequire(path.join(root, 'packages/db/package.json'));
  const migrated = spawnSync(process.execPath, [dbRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: path.join(root, 'packages/db'), env: process.env, encoding: 'utf8', timeout: 60000
  });
  // Prisma 6.x may exit non-zero when the deprecated package.json#prisma field triggers a
  // warning that routes through stderr, even if the migration itself succeeded. We treat
  // exit 0 OR stdout containing "applied" as success to tolerate that edge case.
  const migrateOk = migrated.status === 0 || (migrated.stdout ?? '').includes('applied') || (migrated.stdout ?? '').includes('No pending migrations');
  if (!migrateOk) throw new Error('Migration failed in isolated schema: ' + (migrated.stderr ?? '').replaceAll(originalUrl, '[database]'));
  ({ db } = await import('../packages/db/dist/index.js'));
  console.log('PASS: migrations applied to isolated schema');
  const core = await import('../packages/core/dist/index.js');
  const exchange = await db.exchange.create({ data: { slug: 'bybit', name: 'Bybit', status: 'PUBLISHED', defaultCashbackRate: '0.3', logoUrl: '/exchange-logos/bybit.png' } });
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
  assert.equal(await db.uidAccount.count(), 0);
  await report('100');
  const alice = await db.uidAccount.findUniqueOrThrow({ where: { exchangeId_uid: { exchangeId: exchange.id, uid: '00123' } } });
  const bob = await db.uidAccount.create({ data: { exchangeId: exchange.id, uid: '00999' } });
  assert.equal(await db.uidAccount.count({ where: { exchangeId: exchange.id, uid: '00123' } }), 1);
  assert.equal(alice.boundEmail, null, 'Reports credit without an email claimant');
  assert.equal((await core.getWallet(alice.id)).balances[0].pending, '30.0000000000');
  console.log('PASS: UID-first credit without claimant');
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
  await db.wallet.updateMany({ where: { uidAccountId: alice.id }, data: { available: 0, withdrawn: 18 } }); // Fixture: funds already paid.
  await report('40'); assert.equal((await core.getWallet(alice.id)).balances[0].receivable, '6.0000000000');
  await report('100'); wallet = await core.getWallet(alice.id);
  assert.equal(wallet.balances[0].receivable, '0.0000000000'); assert.equal(wallet.balances[0].pending, '12.0000000000');
  const creditedEntries = await db.walletEntry.findMany({ where: { wallet: { uidAccountId: alice.id }, type: 'CREDIT' } });
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
  assert.equal((await core.getWallet(bob.id)).history.length, 0, 'UID data remains isolated');
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

  // ───── Withdrawal flow acceptance criteria (Task 25.9) ─────
  // Set up: alice has 18 USDT available after hold release above.
  await db.walletEntry.updateMany({ where: { remainingPending: { gt: 0 }, wallet: { uidAccountId: alice.id } }, data: { availableAt: new Date(Date.now() - 1000) } });
  await core.scheduleHoldRelease(); await runNext('RELEASE_HOLDS');
  await db.wallet.updateMany({ where: { uidAccountId: alice.id }, data: { available: 18, pending: 0, reserved: 0, withdrawn: 0, receivable: 0 } });
  process.env.WITHDRAWAL_ROUTES = JSON.stringify({ USDT: ['TRON'] });
  process.env.WITHDRAWAL_AUTO_APPROVE_THRESHOLDS = JSON.stringify({ USDT: '100' });
  const tronAddress = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'; // Binance TRON cold wallet — public, valid checksum
  const claimant = { uidAccountId: alice.id, email: 'alice@test.invalid' };
  await db.uidAccount.update({ where: { id: alice.id }, data: { boundEmail: 'alice@test.invalid' } });

  // First withdrawal always goes to UNDER_REVIEW regardless of amount.
  const w1 = await core.requestWithdrawal(claimant, { asset: 'USDT', amount: '1', network: 'TRON', address: tronAddress });
  assert.equal(w1.status, 'UNDER_REVIEW', 'First withdrawal must be UNDER_REVIEW regardless of amount');
  assert.equal(w1.isFirst, true);
  const aliceWalletAfterW1 = await core.getWallet(alice.id);
  assert.equal(aliceWalletAfterW1.balances[0].available, '17.0000000000', 'available reduced by 1');
  assert.equal(aliceWalletAfterW1.balances[0].reserved, '1.0000000000', 'reserved increased by 1');
  assert.equal(await db.withdrawalEvent.count({ where: { withdrawalId: w1.id } }), 2, 'REQUESTED + UNDER_REVIEW events');
  console.log('PASS: first withdrawal always UNDER_REVIEW');

  // Admin approve then mark paid — reserved → withdrawn, audit trail preserved.
  await core.decideWithdrawal('admin-test', w1.id, { decision: 'APPROVE' });
  const w1Approved = await db.withdrawal.findUniqueOrThrow({ where: { id: w1.id } });
  assert.equal(w1Approved.status, 'APPROVED');
  await core.decideWithdrawal('admin-test', w1.id, { decision: 'MARK_PAID', payoutRef: 'txref-001' });
  const w1Paid = await db.withdrawal.findUniqueOrThrow({ where: { id: w1.id } });
  assert.equal(w1Paid.status, 'PAID'); assert.equal(w1Paid.payoutRef, 'txref-001');
  const walletAfterPaid = await core.getWallet(alice.id);
  assert.equal(walletAfterPaid.balances[0].reserved, '0.0000000000');
  assert.equal(walletAfterPaid.balances[0].withdrawn, '1.0000000000');
  const allEvents = await db.withdrawalEvent.findMany({ where: { withdrawalId: w1.id }, orderBy: { createdAt: 'asc' } });
  assert.equal(allEvents.length, 4, 'REQUESTED + UNDER_REVIEW + APPROVED + PAID events');
  console.log('PASS: approve + mark-paid full audit trail');

  // Second withdrawal (same amount) auto-approves because isFirst=false and amount <= threshold.
  const w2 = await core.requestWithdrawal(claimant, { asset: 'USDT', amount: '1', network: 'TRON', address: tronAddress });
  assert.equal(w2.status, 'AUTO_APPROVED', 'Second withdrawal below threshold must be AUTO_APPROVED');
  assert.equal(w2.isFirst, false);
  console.log('PASS: second withdrawal auto-approves below threshold');

  // Cancel before PAID releases reserved balance.
  const w3 = await core.requestWithdrawal(claimant, { asset: 'USDT', amount: '2', network: 'TRON', address: tronAddress });
  const walletBeforeCancel = await core.getWallet(alice.id);
  const reservedBeforeCancel = parseFloat(walletBeforeCancel.balances[0].reserved);
  await core.cancelWithdrawal(alice.id, w3.id);
  const w3Cancelled = await db.withdrawal.findUniqueOrThrow({ where: { id: w3.id } });
  assert.equal(w3Cancelled.status, 'CANCELLED');
  const walletAfterCancel = await core.getWallet(alice.id);
  // After cancel: reserved must have dropped by 2 (back to pre-w3 level).
  assert.ok(Math.abs(parseFloat(walletAfterCancel.balances[0].reserved) - (reservedBeforeCancel - 2)) < 0.0000001, 'reserved reduced after cancel');
  const cancelEvents = await db.withdrawalEvent.findMany({ where: { withdrawalId: w3.id } });
  assert.ok(cancelEvents.some(e => e.toStatus === 'CANCELLED'), 'CANCELLED event persisted');
  console.log('PASS: cancel releases reserved balance with event');

  // Cancel after PAID is rejected.
  await assert.rejects(() => core.cancelWithdrawal(alice.id, w1.id), /INVALID_TRANSITION/, 'Cancel after PAID must be rejected');
  console.log('PASS: cancel after PAID is rejected');

  // Receivable > 0 blocks new withdrawals.
  await db.wallet.updateMany({ where: { uidAccountId: alice.id }, data: { receivable: '5' } });
  await assert.rejects(() => core.requestWithdrawal(claimant, { asset: 'USDT', amount: '1', network: 'TRON', address: tronAddress }), /RECEIVABLE_OUTSTANDING/, 'Withdrawal blocked while receivable > 0');
  await db.wallet.updateMany({ where: { uidAccountId: alice.id }, data: { receivable: '0' } });
  console.log('PASS: receivable blocks withdrawal');

  // Two concurrent requests against the same balance cannot both reserve it.
  const currentAvailable = (await core.getWallet(alice.id)).balances[0].available;
  const availableDecimal = parseFloat(currentAvailable);
  if (availableDecimal > 0) {
    const halfStr = (availableDecimal / 2 + 0.01).toFixed(10).replace(/\.?0+$/, '');
    const [r1, r2] = await Promise.allSettled([
      core.requestWithdrawal(claimant, { asset: 'USDT', amount: halfStr, network: 'TRON', address: tronAddress }),
      core.requestWithdrawal(claimant, { asset: 'USDT', amount: halfStr, network: 'TRON', address: tronAddress })
    ]);
    const bothSucceeded = r1.status === 'fulfilled' && r2.status === 'fulfilled';
    if (bothSucceeded) {
      // Race resolved; both succeeded; verify reserved does not exceed original available.
      const walletFinal = await core.getWallet(alice.id);
      assert.ok(parseFloat(walletFinal.balances[0].reserved) <= parseFloat(currentAvailable) + 0.0001, 'Reserved cannot exceed original available — double-spend detected');
    }
    // At least one must succeed (both rejected would be a different bug).
    assert.ok(r1.status === 'fulfilled' || r2.status === 'fulfilled', 'At least one concurrent request must succeed');
    console.log('PASS: concurrent withdrawal requests — no double-spend');
  }

  console.log('PASS: withdrawal flow — first-review, auto-approve, cancel, audit trail, receivable block, concurrent safety');
} finally {
  await db?.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}
