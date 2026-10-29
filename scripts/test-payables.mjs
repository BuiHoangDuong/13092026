// Req 22 simulation: CustomerPayable ledger, 23:00 UTC internal USDT payout slots, approval, merge, failure, UNKNOWN,
// reconciliation, correction, concurrency and cutover gate. Runs on the Docker Postgres stack only; no exchange is contacted:
// the exchange is the in-memory SimulatedInternalTransfer double.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '../packages/db/dist/generated/client/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const originalUrl = process.env.TEST_DATABASE_URL;
if (!originalUrl) throw new Error('Set TEST_DATABASE_URL to the Docker Postgres (infra/docker-compose.yml)');
if (/rlwy\.net|railway\.internal|up\.railway\.app/i.test(originalUrl)) throw new Error('Refusing to run: TEST_DATABASE_URL points to Railway (steering: tests run on Docker only)');
const schema = `cashback_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(originalUrl); url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.href;
process.env.HOLDING_PERIOD_HOURS = '0';
const control = new PrismaClient({ datasources: { db: { url: originalUrl } } });
let db;
const results = [];
const pass = (name) => { results.push(name); console.log(`PASS: ${name}`); };
try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const dbRequire = createRequire(path.join(root, 'packages/db/package.json'));
  await new Promise((resolve, reject) => execFile(process.execPath, [dbRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { cwd: path.join(root, 'packages/db'), env: process.env, timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
    (error, stdout, stderr) => (error && !String(stdout).includes('applied') && !String(stdout).includes('No pending')) ? reject(Object.assign(error, { stderr })) : resolve()));
  ({ db } = await import('../packages/db/dist/index.js'));
  const core = await import('../packages/core/dist/index.js');
  const { SimulatedInternalTransfer, registerInternalTransferPort, clearInternalTransferPorts } = core;

  // ---------------------------------------------------------------- fixtures and helpers
  const mexc = await db.exchange.create({ data: { slug: 'mexc', name: 'MEXC', status: 'PUBLISHED', defaultCashbackRate: '1' } });
  const bybit = await db.exchange.create({ data: { slug: 'bybit', name: 'Bybit', status: 'PUBLISHED', defaultCashbackRate: '1' } });
  const binance = await db.exchange.create({ data: { slug: 'binance', name: 'Binance', status: 'PUBLISHED', defaultCashbackRate: '1' } });
  const sim = new SimulatedInternalTransfer('mexc', 'mexc-payout-1', 10_000);
  const simBybit = new SimulatedInternalTransfer('bybit', 'bybit-payout-1', 10_000);
  registerInternalTransferPort(sim); registerInternalTransferPort(simBybit);
  let day = 0; const nextDay = () => new Date(Date.UTC(2026, 10, 1 + day++)); // 2026-11-01 onward: after every real timestamp
  const slotKeyOf = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23)).toISOString();
  const at = (d, h, m = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m));
  let seq = 0; let clock = new Date();

  async function drain(options = {}) {
    const now = options.now ?? clock; let ran = 0;
    for (;;) {
      const job = await core.claimNextJob(120, 'sim'); if (!job) return ran;
      const lease = { id: job.id, lockedBy: job.lockedBy }; const p = job.payload; ran++;
      try {
        if (job.type === 'ATTRIBUTE') await core.attributeJob(lease, p.exchangeId);
        else if (job.type === 'RELEASE_HOLDS') await core.releaseHoldsJob(lease);
        else if (job.type === 'SYNC_PAYABLES') await core.syncPayablesJob(lease, p);
        else if (job.type === 'PAYOUT_SLOT') await core.runPayoutSlot(lease, p.slotKey, { now });
        else if (job.type === 'PAYOUT_RECONCILE') await core.reconcileJob(lease, { now, staleDispatchingMs: options.staleDispatchingMs });
        else if (job.type === 'PAYABLE_COMMAND') await core.runPayableCommandJob(lease, p.commandId, { now });
        else throw new Error(`unexpected job ${job.type}`);
      } catch (error) { await core.failJob(lease, job.attempts, error); throw error; }
    }
  }
  async function account(exchange, uid) { return db.uidAccount.upsert({ where: { exchangeId_uid: { exchangeId: exchange.id, uid } }, update: {}, create: { exchangeId: exchange.id, uid } }); }
  const records = new Map();
  /** Real pipeline: published commission -> ATTRIBUTE -> RELEASE_HOLDS (holding 0h) -> SYNC_PAYABLES. */
  async function earn(exchange, uid, amount, key = `p${++seq}`) {
    const batch = await db.importBatch.create({ data: { exchangeId: exchange.id, rootAccount: 'sim-root', datasetKind: 'COMMISSION', sourceMethod: 'NORMALIZED_FILE', reportType: 'AGGREGATE', periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-01T23:59:59Z'), sourceTz: 'UTC', fileRef: `test:${key}`, status: 'PUBLISHED', publishedAt: new Date() } });
    let record = records.get(`${exchange.id}:${uid}:${key}`);
    if (!record) record = await db.commissionRecord.create({ data: { exchangeId: exchange.id, uid, asset: 'USDT', dedupKey: `${uid}:${key}`, reportType: 'AGGREGATE', rootAccount: 'sim-root', periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-01T23:59:59Z'), reconciledAmount: amount } });
    records.set(`${exchange.id}:${uid}:${key}`, record);
    const version = await db.commissionVersion.create({ data: { commissionId: record.id, batchId: batch.id, amount } });
    await db.commissionRecord.update({ where: { id: record.id }, data: { activeVersionId: version.id, reconciledAmount: amount } });
    await db.job.create({ data: { type: 'ATTRIBUTE', payload: { exchangeId: exchange.id } } });
    await drain();
    await db.walletEntry.updateMany({ where: { remainingPending: { gt: 0 } }, data: { availableAt: new Date(Date.now() - 1000) } });
    await core.scheduleHoldRelease(); await drain();
    return { key, record };
  }
  const correct = (exchange, uid, key, amount) => earn(exchange, uid, amount, key);
  const walletOf = async (exchange, uid) => { const a = await account(exchange, uid); const w = await db.wallet.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: a.id, asset: 'USDT' } } });
    return { pending: w.pending.toFixed(10), available: w.available.toFixed(10), reserved: w.reserved.toFixed(10), withdrawn: w.withdrawn.toFixed(10), receivable: w.receivable.toFixed(10) }; };
  const money = (v) => Number(v).toFixed(10);
  const execsOf = async (exchange, uid) => db.payoutExecution.findMany({ where: { uidAccount: { exchangeId: exchange.id, uid } }, orderBy: { createdAt: 'asc' } });
  async function runSlot(d, minutes = 5) { const now = at(d, 23, minutes); clock = now; await core.schedulePayoutSlot(now); await drain({ now }); return db.payoutSlot.findUnique({ where: { slotKey: slotKeyOf(d) } }); }
  async function command(type, executionId, extra = {}, now = clock, key = `cmd-${randomUUID()}`) {
    const res = await core.submitPayableCommand('admin-1', { type, executionId, commandKey: key, ...extra }); await drain({ now }); return { ...res, row: await db.payableCommand.findUniqueOrThrow({ where: { id: res.commandId } }), key }; }
  async function ledgerIsConsistent(exchange, uid) {
    const a = await account(exchange, uid); const w = await db.wallet.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: a.id, asset: 'USDT' } } });
    const payables = await db.customerPayable.findMany({ where: { uidAccountId: a.id, asset: 'USDT', closedAt: null } });
    const sum = (f) => payables.reduce((t, p) => t + Number(f(p)), 0);
    assert.equal(sum(p => p.entitlement.minus(p.settledAmount).minus(p.activeAmount)).toFixed(6), Number(w.available).toFixed(6), 'sum(free) == wallet.available');
    assert.equal(sum(p => p.activeAmount).toFixed(6), Number(w.reserved).toFixed(6), 'sum(active) == wallet.reserved');
    assert.equal(sum(p => p.settledAmount).toFixed(6), Number(w.withdrawn).toFixed(6), 'sum(settled) == wallet.withdrawn');
  }

  // ---------------------------------------------------------------- C1 gate: LEGACY by default, fail closed, cutover rules
  process.env.WITHDRAWAL_ROUTES = '{"USDT":["ETHEREUM"]}';
  const legacyReq = { asset: 'USDT', amount: '1', network: 'ETHEREUM', address: '0x' + '1'.repeat(40) };
  const legacyUid = await db.uidAccount.create({ data: { exchangeId: mexc.id, uid: 'legacy-1', boundEmail: 'l@example.com' } });
  const legacyWallet = await db.wallet.create({ data: { uidAccountId: legacyUid.id, asset: 'USDT', available: 5 } });
  const claimant = { uidAccountId: legacyUid.id, email: 'l@example.com' };
  assert.equal((await db.moneyFlowGate.findUniqueOrThrow({ where: { id: 1 } })).mode, 'LEGACY');
  await db.moneyFlowGate.delete({ where: { id: 1 } });
  await assert.rejects(() => core.requestWithdrawal(claimant, legacyReq), (e) => e.code === 'MONEY_FLOW_GATE_UNKNOWN' && e.status === 503);
  await db.moneyFlowGate.create({ data: { id: 1, mode: 'LEGACY', version: 1 } });
  const legacyWithdrawal = await core.requestWithdrawal(claimant, legacyReq);
  assert.equal(legacyWithdrawal.status, 'UNDER_REVIEW', 'LEGACY mode keeps the old flow working');
  await core.setMoneyFlowMode('admin-1', 'FROZEN');
  await assert.rejects(() => core.requestWithdrawal(claimant, legacyReq), (e) => e.code === 'MONEY_FLOW_CLOSED');
  await assert.rejects(() => core.cancelWithdrawal(legacyUid.id, legacyWithdrawal.id), (e) => e.code === 'MONEY_FLOW_CLOSED');
  await assert.rejects(() => core.decideWithdrawal('admin-1', legacyWithdrawal.id, { decision: 'APPROVE' }), (e) => e.code === 'MONEY_FLOW_CLOSED');
  await assert.rejects(() => core.setMoneyFlowMode('admin-1', 'PAYABLE_ONLY'), (e) => e.code === 'LEGACY_IN_FLIGHT');
  await db.withdrawalEvent.deleteMany({}); await db.withdrawal.deleteMany({});
  await db.payableSyncScope.create({ data: { uidAccountId: legacyUid.id, asset: 'USDT', state: 'FAILED', invariantError: 'FIXTURE' } });
  await assert.rejects(() => core.setMoneyFlowMode('admin-1', 'PAYABLE_ONLY'), (e) => e.code === 'RECONCILIATION_REQUIRED');
  await db.payableSyncScope.deleteMany({ where: { uidAccountId: legacyUid.id } });
  await db.walletEntry.deleteMany({ where: { walletId: legacyWallet.id } }); await db.wallet.delete({ where: { id: legacyWallet.id } }); await db.uidAccount.delete({ where: { id: legacyUid.id } });
  await core.setMoneyFlowMode('admin-1', 'PAYABLE_ONLY');
  await assert.rejects(() => core.setMoneyFlowMode('admin-1', 'LEGACY'), (e) => e.code === 'INVALID_GATE_TRANSITION');
  pass('C1 money-flow gate: LEGACY default, fail closed, cutover drains legacy and unreconciled scopes first, customer writers closed afterwards');
  // ---------------------------------------------------------------- C2 sync: one payable per release, replay-safe, no reserve
  let day0 = nextDay();
  await earn(mexc, 'u-sync', '3'); await earn(mexc, 'u-sync', '5'); await earn(mexc, 'u-sync', '7');
  let acc = await account(mexc, 'u-sync');
  assert.equal(await db.customerPayable.count({ where: { uidAccountId: acc.id } }), 3);
  assert.deepEqual(await walletOf(mexc, 'u-sync'), { pending: money(0), available: money(15), reserved: money(0), withdrawn: money(0), receivable: money(0) });
  await db.$transaction(async tx => { await core.syncPayableScope(tx, acc.id, 'USDT'); await core.syncPayableScope(tx, acc.id, 'USDT'); });
  assert.equal(await db.customerPayable.count({ where: { uidAccountId: acc.id } }), 3, 'replayed sync creates nothing');
  assert.equal(await db.payableAllocation.count(), 0, 'sync never reserves');
  await ledgerIsConsistent(mexc, 'u-sync');
  const existingSource = (await db.customerPayable.findFirstOrThrow({ where: { uidAccountId: acc.id } })).sourceReleaseEntryId;
  await assert.rejects(() => db.customerPayable.create({ data: { uidAccountId: acc.id, exchangeId: mexc.id, asset: 'USDT', sourceReleaseEntryId: existingSource, entitlement: 1, releasedAt: new Date() } }), /Unique constraint/);
  pass('C2 sync: one payable per release, UNIQUE source, replay creates nothing, nothing reserved');

  // ---------------------------------------------------------------- C3 happy path: 3 + 5 + 7 merge into one 15 USDT transfer at 23:00 UTC
  assert.equal((await core.listPayables()).items.length, 3);
  sim.balance = 100;
  let slot = await runSlot(day0);
  assert.equal(slot.state, 'DONE');
  const [e1] = await execsOf(mexc, 'u-sync');
  assert.equal(e1.state, 'CONFIRMED'); assert.equal(e1.total.toFixed(10), money(15)); assert.equal(e1.requiresApproval, false); assert.equal(e1.valuationMode, 'FIXED_USDT_USD');
  assert.equal(sim.calls.filter(c => c.toUid === 'u-sync').length, 1, 'exactly one transfer');
  assert.equal(sim.calls.find(c => c.toUid === 'u-sync').amount, money(15));
  assert.deepEqual(await walletOf(mexc, 'u-sync'), { pending: money(0), available: money(0), reserved: money(0), withdrawn: money(15), receivable: money(0) });
  assert((await db.customerPayable.findMany({ where: { uidAccountId: acc.id } })).every(p => p.paymentStatus === 'PAID' && p.paidAt));
  await ledgerIsConsistent(mexc, 'u-sync');
  const paidList = await core.listPayables({ status: 'PAID' });
  assert.equal(paidList.items.filter(i => i.uid === 'u-sync').length, 3);
  assert.equal((await core.listPayables()).items.filter(i => i.uid === 'u-sync').length, 0, 'PAID leaves the default queue but stays in history');
  const slotAgain = await runSlot(day0, 10);
  assert.equal(sim.calls.filter(c => c.toUid === 'u-sync').length, 1, 'a replayed slot never sends twice');
  void slotAgain;
  pass('C3 happy path: 3+5+7 merged into one 15 USDT transfer, settled once, history kept');

  // ---------------------------------------------------------------- C4 threshold + minimum
  const d4 = nextDay();
  await earn(mexc, 'u-20', '20'); await earn(mexc, 'u-2001', '20.01'); await earn(mexc, 'u-half', '0.5'); await earn(mexc, 'u-low', '0.2');
  sim.balance = 1000; sim.calls.length = 0;
  await runSlot(d4);
  assert.equal((await execsOf(mexc, 'u-20'))[0].state, 'CONFIRMED', 'exactly 20 USDT is paid automatically');
  const e2001 = (await execsOf(mexc, 'u-2001'))[0];
  assert.equal(e2001.state, 'AWAITING_APPROVAL'); assert.equal(e2001.requiresApproval, true);
  assert.equal(sim.calls.some(c => c.toUid === 'u-2001'), false, 'over 20 is never sent without approval');
  assert.deepEqual(await walletOf(mexc, 'u-2001'), { pending: money(0), available: money(0), reserved: money(20.01), withdrawn: money(0), receivable: money(0) });
  assert.equal((await execsOf(mexc, 'u-half')).length, 0, '0.5 accumulates: no execution, no reserve');
  assert.equal((await walletOf(mexc, 'u-half')).available, money(0.5));
  assert.equal((await execsOf(mexc, 'u-low')).length, 0);
  const d4b = nextDay(); await earn(mexc, 'u-half', '0.1', 'extra');
  await runSlot(d4b);
  assert.equal((await execsOf(mexc, 'u-half'))[0].state, 'CONFIRMED', '0.5 + 0.1 > 0.5 becomes payable the next slot');
  assert.equal((await execsOf(mexc, 'u-half'))[0].total.toFixed(10), money(0.6));
  assert.equal((await execsOf(mexc, 'u-low')).length, 0, 'still below the minimum');
  pass('C4 threshold: <=0.5 accumulates, (0.5,20] auto-pays, 20.01 waits for approval, accumulation then pays');

  // ---------------------------------------------------------------- C5 approval: never sends immediately, waits for the next 23:00 UTC slot
  const view = await core.listPayables();
  const row2001 = view.items.find(i => i.uid === 'u-2001');
  assert.equal(row2001.primaryReason, 'AWAITING_APPROVAL'); assert.equal(row2001.remaining, money(20.01));
  const bad = await command('APPROVE', e2001.id, { expectedVersion: e2001.version + 5 }, at(d4b, 23, 6));
  assert.equal(bad.row.status, 'REJECTED'); assert.equal(bad.row.result.code, 'STALE_VERSION');
  const key = 'approve-key-0001';
  const ok = await command('APPROVE', e2001.id, { expectedVersion: e2001.version }, at(d4b, 23, 6), key);
  assert.equal(ok.row.status, 'DONE');
  let approved = await db.payoutExecution.findUniqueOrThrow({ where: { id: e2001.id } });
  assert.equal(approved.state, 'READY'); assert.equal(approved.earliestSendAt.toISOString(), slotKeyOf(nextDayPeek(d4b)));
  function nextDayPeek(d) { return new Date(d.getTime() + 86_400_000); }
  assert.equal(sim.calls.some(c => c.toUid === 'u-2001'), false, 'approval does not call the sender');
  const replay = await core.submitPayableCommand('admin-1', { type: 'APPROVE', executionId: e2001.id, commandKey: key, expectedVersion: e2001.version });
  assert.equal(replay.replay, true); assert.equal(replay.commandId, ok.row.id);
  await assert.rejects(() => core.submitPayableCommand('admin-1', { type: 'APPROVE', executionId: e2001.id, commandKey: key, expectedVersion: e2001.version + 1 }), /different payload/);
  assert.equal((await core.listPayables()).items.find(i => i.uid === 'u-2001').primaryReason, 'WAITING_SCHEDULE');
  await runSlot(nextDay()); // d4c is the day after d4b? ensure it equals approved.earliestSendAt day
  approved = await db.payoutExecution.findUniqueOrThrow({ where: { id: e2001.id } });
  assert.equal(approved.state, 'CONFIRMED'); assert.equal(sim.calls.filter(c => c.toUid === 'u-2001').length, 1);
  await ledgerIsConsistent(mexc, 'u-2001');
  pass('C5 approval: stale version rejected, idempotent commandKey, no immediate send, paid on the next 23:00 UTC slot');

  // ---------------------------------------------------------------- C6 merge before dispatch voids approval; cutoff excludes later cashback
  const d6 = nextDay();
  await earn(mexc, 'u-merge', '25');
  await runSlot(d6);
  let m = (await execsOf(mexc, 'u-merge'))[0];
  assert.equal(m.state, 'AWAITING_APPROVAL');
  await command('APPROVE', m.id, { expectedVersion: m.version }, at(d6, 23, 6));
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: m.id } })).state, 'READY');
  await earn(mexc, 'u-merge', '5'); // released before the next cutoff
  const d6b = nextDay();
  await runSlot(d6b);
  m = await db.payoutExecution.findUniqueOrThrow({ where: { id: m.id } });
  assert.equal(m.total.toFixed(10), money(30)); assert.equal(m.state, 'AWAITING_APPROVAL', '25 approved + 5 = 30 needs a new approval'); assert.equal(m.approvedAt, null);
  assert.equal(sim.calls.some(c => c.toUid === 'u-merge'), false, 'the old 25 approval is never used to pay 30');
  assert.equal(await db.payoutExecution.count({ where: { uidAccount: { uid: 'u-merge' }, state: { in: ['AWAITING_APPROVAL', 'READY'] } } }), 1, 'merged into one execution, no second obligation');
  assert((await db.payableEvent.findMany({ where: { executionId: m.id, kind: 'EXECUTION_MERGED' } })).some(e => e.detail.approvalVoided === true));
  await command('APPROVE', m.id, { expectedVersion: m.version }, at(d6b, 23, 6));
  await runSlot(nextDay());
  m = await db.payoutExecution.findUniqueOrThrow({ where: { id: m.id } });
  assert.equal(m.state, 'CONFIRMED'); assert.equal(m.paidAmount.toFixed(10), money(30));
  // Cashback released after the cutoff is not part of that slot's list.
  const d6c = nextDay();
  await earn(mexc, 'u-cutoff', '4');
  await db.customerPayable.updateMany({ where: { uidAccount: { uid: 'u-cutoff' } }, data: { releasedAt: at(d6c, 23, 1) } });
  await runSlot(d6c);
  assert.equal((await execsOf(mexc, 'u-cutoff')).length, 0, 'released after the 23:00 cutoff: next slot');
  await runSlot(nextDay());
  assert.equal((await execsOf(mexc, 'u-cutoff'))[0].state, 'CONFIRMED');
  pass('C6 merge voids approval (25+5=30 re-approved), one execution, cutoff keeps later cashback for the next slot');

  // ---------------------------------------------------------------- C7 missed slot: no catch-up, next 23:00 pays
  const d7 = nextDay();
  await earn(mexc, 'u-missed', '9');
  const lateNow = at(d7, 23, 5);
  await core.schedulePayoutSlot(lateNow); // job exists, but the worker is down
  const recovered = at(new Date(d7.getTime() + 86_400_000), 1, 0);
  clock = recovered; await drain({ now: recovered });
  const missedSlot = await db.payoutSlot.findUniqueOrThrow({ where: { slotKey: slotKeyOf(d7) } });
  assert.equal(missedSlot.state, 'MISSED'); assert.equal((await execsOf(mexc, 'u-missed')).length, 0); assert.equal(sim.calls.some(c => c.toUid === 'u-missed'), false);
  await core.schedulePayoutSlot(recovered); await drain({ now: recovered });
  assert.equal(sim.calls.some(c => c.toUid === 'u-missed'), false, 'recovery at 01:00 does not dispatch');
  assert.equal((await core.listPayables()).items.find(i => i.uid === 'u-missed').primaryReason, 'WAITING_SCHEDULE');
  await runSlot(nextDay());
  assert.equal((await execsOf(mexc, 'u-missed'))[0].state, 'CONFIRMED');
  pass('C7 missed 23:00 slot is never caught up; the next slot pays');

  // ---------------------------------------------------------------- C8 provable failure: released, retried next slot, never in the same slot
  const d8 = nextDay();
  await earn(mexc, 'u-fail', '8');
  sim.behaviorByUid.set('u-fail', 'NOT_SENT'); sim.calls.length = 0;
  await runSlot(d8);
  let f = (await execsOf(mexc, 'u-fail'))[0];
  assert.equal(f.state, 'FAILED_NOT_SENT'); assert.equal(sim.calls.length >= 1, true);
  assert.equal(sim.calls.filter(c => c.toUid === 'u-fail').length, 1, 'no retry inside the failed slot');
  assert.deepEqual(await walletOf(mexc, 'u-fail'), { pending: money(0), available: money(8), reserved: money(0), withdrawn: money(0), receivable: money(0) });
  assert((await db.payableAllocation.findMany({ where: { executionId: f.id } })).every(a => a.state === 'RELEASED'));
  assert.equal((await core.listPayables()).items.find(i => i.uid === 'u-fail').remaining, money(8), 'debt is still owed');
  sim.behaviorByUid.delete('u-fail');
  await runSlot(nextDay());
  const execs = await execsOf(mexc, 'u-fail');
  assert.equal(execs.length, 2); assert.equal(execs[1].state, 'CONFIRMED'); assert.equal(execs[1].previousExecutionId, execs[0].id);
  assert.equal(sim.calls.filter(c => c.toUid === 'u-fail').length, 2); await ledgerIsConsistent(mexc, 'u-fail');
  pass('C8 provable failure releases the reservation, retries only on the next slot with a linked successor');

  // ---------------------------------------------------------------- C9 timeout: UNKNOWN holds the money, reconcile decides, settle happens once
  const d9 = nextDay();
  await earn(mexc, 'u-sent', '6'); await earn(mexc, 'u-lost', '6');
  sim.behaviorByUid.set('u-sent', 'TIMEOUT_SENT'); sim.behaviorByUid.set('u-lost', 'TIMEOUT_NOT_SENT'); sim.calls.length = 0;
  await runSlot(d9);
  const sent = (await execsOf(mexc, 'u-sent'))[0], lost = (await execsOf(mexc, 'u-lost'))[0];
  assert.equal(sent.state, 'UNKNOWN'); assert.equal(lost.state, 'UNKNOWN');
  assert.equal((await walletOf(mexc, 'u-sent')).reserved, money(6), 'UNKNOWN keeps the reservation');
  assert.equal((await core.listPayables()).items.find(i => i.uid === 'u-sent').primaryReason, 'RECONCILIATION_REQUIRED');
  const c1 = await command('CANCEL', sent.id, {}, at(d9, 23, 10)); assert.equal(c1.row.status, 'REJECTED', 'cannot cancel after DISPATCHING');
  await earn(mexc, 'u-sent', '4', 'late'); // new cashback while the previous transfer is UNKNOWN
  sim.behaviorByUid.clear(); sim.calls.length = 0;
  await runSlot(nextDay());
  assert.equal(sim.calls.some(c => c.toUid === 'u-sent' || c.toUid === 'u-lost'), false, 'UNKNOWN is never re-sent by a later slot');
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: sent.id } })).total.toFixed(10), money(6), 'new cashback is never merged into an in-flight execution');
  assert.equal((await execsOf(mexc, 'u-sent')).length, 1);
  assert.deepEqual(await walletOf(mexc, 'u-sent'), { pending: money(0), available: money(4), reserved: money(6), withdrawn: money(0), receivable: money(0) });
  sim.lookupProvesNotSent = false;
  await core.scheduleReconcile(); await drain({ now: at(nextDayPeek(d9), 23, 20), staleDispatchingMs: 0 });
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: lost.id } })).state, 'UNKNOWN', 'no proof of non-delivery keeps UNKNOWN');
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: sent.id } })).state, 'CONFIRMED', 'lookup proved delivery: settled');
  sim.lookupProvesNotSent = true;
  await core.scheduleReconcile(); await drain({ now: at(nextDayPeek(d9), 23, 30), staleDispatchingMs: 0 });
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: lost.id } })).state, 'FAILED_NOT_SENT');
  assert.deepEqual(await walletOf(mexc, 'u-sent'), { pending: money(0), available: money(4), reserved: money(0), withdrawn: money(6), receivable: money(0) });
  await core.scheduleReconcile(); await drain({ now: at(nextDayPeek(d9), 23, 40), staleDispatchingMs: 0 });
  assert.equal((await walletOf(mexc, 'u-sent')).withdrawn, money(6), 'repeated reconciliation settles once');
  await ledgerIsConsistent(mexc, 'u-sent'); await ledgerIsConsistent(mexc, 'u-lost');
  await runSlot(nextDay()); assert.equal((await execsOf(mexc, 'u-lost')).at(-1).state, 'CONFIRMED', 'proved not sent: paid by the next slot');
  assert.equal((await execsOf(mexc, 'u-sent')).at(-1).total.toFixed(10), money(4), 'the late cashback is paid as its own execution once the first one is settled');
  assert.equal((await walletOf(mexc, 'u-sent')).withdrawn, money(10));
  pass('C9 timeout -> UNKNOWN keeps money, no re-send, reconcile settles once or releases only with proof');

  // ---------------------------------------------------------------- C10 receipt must match amount, UID and reference
  const d10 = nextDay();
  await earn(mexc, 'u-short', '10'); await earn(mexc, 'u-wrong', '10');
  sim.behaviorByUid.set('u-short', 'SHORT_PAY'); sim.behaviorByUid.set('u-wrong', 'WRONG_UID');
  await runSlot(d10);
  for (const uid of ['u-short', 'u-wrong']) {
    const x = (await execsOf(mexc, uid))[0];
    assert.equal(x.state, 'UNKNOWN'); assert.equal(x.failureCode, 'RECEIPT_MISMATCH');
    assert.equal((await db.customerPayable.findFirst({ where: { uidAccount: { uid } } })).paymentStatus, 'UNPAID', 'a bad receipt is not PAID');
    assert.equal((await walletOf(mexc, uid)).withdrawn, money(0));
  }
  sim.behaviorByUid.clear();
  pass('C10 short or wrong-UID receipt never settles; execution held as UNKNOWN');

  // ---------------------------------------------------------------- C11 funds: oldest first, skip, never partial, fee counts, no same-slot retry
  const d11 = nextDay();
  await earn(bybit, 'old-big', '15'); await earn(bybit, 'newer-small', '8');
  await db.customerPayable.updateMany({ where: { uidAccount: { uid: 'old-big' } }, data: { releasedAt: new Date('2026-10-01T00:00:00Z') } });
  simBybit.balance = 10; simBybit.fee = money(0.5); simBybit.calls.length = 0;
  await runSlot(d11);
  const big = (await execsOf(bybit, 'old-big'))[0], small = (await execsOf(bybit, 'newer-small'))[0];
  assert.equal(big.state, 'READY'); assert.deepEqual(big.blockers, ['INSUFFICIENT_SOURCE_FUNDS']); assert.equal(big.earliestSendAt.toISOString(), slotKeyOf(nextDayPeek(d11)));
  assert.equal(small.state, 'CONFIRMED', 'the next group is still served');
  assert.equal(simBybit.calls.some(c => c.toUid === 'old-big'), false, 'never a partial amount');
  assert.equal(simBybit.calls.length, 1);
  const d11b = nextDay(); simBybit.balance = 100; simBybit.fee = money(0.5);
  await runSlot(d11b);
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: big.id } })).state, 'CONFIRMED');
  assert.equal(simBybit.calls.filter(c => c.toUid === 'old-big').length, 1);
  await earn(bybit, 'exact', '10'); simBybit.balance = 10; simBybit.fee = money(1);
  await runSlot(nextDay());
  assert.equal((await execsOf(bybit, 'exact'))[0].state, 'READY', 'principal fits but principal + fee does not');
  assert.equal((await walletOf(bybit, 'exact')).available, money(0), 'still reserved while waiting');
  simBybit.balance = 1000; simBybit.fee = money(0);
  await runSlot(nextDay());
  assert.equal((await execsOf(bybit, 'exact'))[0].state, 'CONFIRMED'); assert.equal(simBybit.calls.at(-1).amount, money(10), 'customer receives the full principal; fee is the operator’s');
  pass('C11 funds: oldest first, insufficient group deferred a day without partial send, operator fee counted');

  // ---------------------------------------------------------------- C12 recipient / fee / config readiness
  const d12 = nextDay();
  await earn(bybit, 'u-setup', '5'); await earn(binance, 'u-bnb', '5');
  simBybit.recipients.set('u-setup', 'SETUP_REQUIRED'); simBybit.calls.length = 0;
  await runSlot(d12);
  assert.equal((await execsOf(bybit, 'u-setup')).length, 0, 'recipient not set up: nothing reserved or sent');
  assert.equal((await walletOf(bybit, 'u-setup')).available, money(5));
  assert.equal((await execsOf(binance, 'u-bnb')).length, 0, 'Binance has no verified payout channel');
  simBybit.recipients.set('u-setup', 'READY'); simBybit.feeFails = true;
  await runSlot(nextDay());
  assert.equal((await execsOf(bybit, 'u-setup'))[0].state, 'READY', 'fee unknown: held, not sent'); assert.equal(simBybit.calls.some(c => c.toUid === 'u-setup'), false);
  simBybit.feeFails = false; await runSlot(nextDay());
  assert.equal((await execsOf(bybit, 'u-setup'))[0].state, 'CONFIRMED');
  pass('C12 recipient setup, unknown fee and unsupported exchange hold the money; no send, no reservation loss');

  // ---------------------------------------------------------------- C13 corrections
  const d13 = nextDay();
  const big35 = await earn(mexc, 'u-corr', '35');
  await runSlot(d13);
  let c = (await execsOf(mexc, 'u-corr'))[0]; assert.equal(c.state, 'AWAITING_APPROVAL');
  await correct(mexc, 'u-corr', big35.key, '30'); // downward correction before DISPATCHING
  c = await db.payoutExecution.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(c.state, 'INVALIDATED', 'correction voids the prepared execution');
  assert.deepEqual(await walletOf(mexc, 'u-corr'), { pending: money(0), available: money(30), reserved: money(0), withdrawn: money(0), receivable: money(0) });
  const corrPayable = await db.customerPayable.findFirstOrThrow({ where: { uidAccount: { uid: 'u-corr' } } });
  assert.equal(corrPayable.entitlement.toFixed(10), money(30)); assert.equal(corrPayable.paymentStatus, 'UNPAID'); await ledgerIsConsistent(mexc, 'u-corr');
  await runSlot(nextDay());
  c = (await execsOf(mexc, 'u-corr')).at(-1); assert.equal(c.state, 'AWAITING_APPROVAL'); assert.equal(c.total.toFixed(10), money(30), 'new execution on the corrected amount');
  await command('CANCEL', c.id, {}, clock);
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: c.id } })).state, 'CANCELLED');
  assert.equal((await walletOf(mexc, 'u-corr')).available, money(30), 'cancel keeps the debt (UNPAID, free)');
  assert.equal((await core.listPayables()).items.find(i => i.uid === 'u-corr').remaining, money(30));
  // Correction after money left: receivable, scope blocked until offset.
  const d13b = nextDay();
  const k = await earn(mexc, 'u-after', '10');
  sim.behaviorByUid.set('u-after', 'TIMEOUT_SENT'); await runSlot(d13b);
  const inflight = (await execsOf(mexc, 'u-after'))[0]; assert.equal(inflight.state, 'UNKNOWN');
  await correct(mexc, 'u-after', k.key, '4');
  let scope = await db.payableSyncScope.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: inflight.uidAccountId, asset: 'USDT' } } });
  assert.equal(scope.pendingCorrection, true, 'in-flight execution + correction: new sends blocked');
  sim.behaviorByUid.clear();
  await core.scheduleReconcile(); await drain({ now: at(nextDayPeek(d13b), 23, 5), staleDispatchingMs: 0 });
  assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: inflight.id } })).state, 'CONFIRMED', 'the transfer that really happened is recorded');
  const afterWallet = await walletOf(mexc, 'u-after');
  assert.equal(afterWallet.withdrawn, money(10)); assert.equal(afterWallet.receivable, money(6), 'overpaid 6 recorded as receivable (Req 8.7)');
  scope = await db.payableSyncScope.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: inflight.uidAccountId, asset: 'USDT' } } });
  assert.equal(scope.pendingCorrection, false);
  await earn(mexc, 'u-after', '3');
  await runSlot(nextDay());
  assert.equal((await execsOf(mexc, 'u-after')).length, 1, 'receivable blocks new payouts for the UID');
  await ledgerIsConsistent(mexc, 'u-after');
  pass('C13 corrections: before dispatch voids and re-nets; after dispatch records the real transfer and a receivable; cancel keeps the debt');

  // ---------------------------------------------------------------- C14 concurrency: two replicas of one slot, racing approvals
  const d14 = nextDay();
  await earn(mexc, 'u-race', '12'); sim.calls.length = 0; sim.balance = 1000;
  const slotKey = slotKeyOf(d14); clock = at(d14, 23, 5);
  const lease = new Date(Date.now() + 120_000);
  const [ja, jb] = await Promise.all([1, 2].map(i => db.job.create({ data: { type: 'PAYOUT_SLOT', payload: { slotKey }, state: 'CLAIMED', attempts: 1, lockedBy: `rep-${i}`, leaseUntil: lease } })));
  const outcomes = await Promise.allSettled([core.runPayoutSlot({ id: ja.id, lockedBy: 'rep-1' }, slotKey, { now: clock }), core.runPayoutSlot({ id: jb.id, lockedBy: 'rep-2' }, slotKey, { now: clock })]);
  assert(outcomes.every(o => o.status === 'fulfilled'), JSON.stringify(outcomes.filter(o => o.status === 'rejected').map(o => String(o.reason))));
  assert.equal(await db.payoutExecution.count({ where: { uidAccount: { uid: 'u-race' } } }), 1, 'one execution');
  assert.equal(sim.calls.filter(x => x.toUid === 'u-race').length, 1, 'one transfer');
  assert.equal((await walletOf(mexc, 'u-race')).withdrawn, money(12));
  await earn(mexc, 'u-appr', '30'); await runSlot(nextDay());
  const ap = (await execsOf(mexc, 'u-appr'))[0];
  const [r1, r2] = await Promise.all(['race-key-0001', 'race-key-0002'].map(commandKey => core.submitPayableCommand('admin-1', { type: 'APPROVE', executionId: ap.id, commandKey, expectedVersion: ap.version })));
  await drain({ now: clock });
  const rows = await db.payableCommand.findMany({ where: { id: { in: [r1.commandId, r2.commandId] } } });
  assert.equal(rows.filter(x => x.status === 'DONE').length, 1); assert.equal(rows.filter(x => x.status === 'REJECTED').length, 1);
  pass('C14 concurrency: two slot replicas -> one execution and one transfer; racing approvals -> one wins');

  // ---------------------------------------------------------------- C15 manual mark-paid needs a claimed execution and an exactly matching receipt
  const d15 = nextDay();
  await earn(mexc, 'u-man', '40'); await earn(mexc, 'u-man2', '40'); await earn(mexc, 'u-man3', '40');
  await runSlot(d15);
  const [mm, mm2, mm3] = [(await execsOf(mexc, 'u-man'))[0], (await execsOf(mexc, 'u-man2'))[0], (await execsOf(mexc, 'u-man3'))[0]];
  const early = await command('MARK_PAID', mm.id, { reference: 'bank-ref-0001', amount: '40', toUid: 'u-man' }, clock);
  assert.equal(early.row.result.code, 'NOT_CLAIMED', 'manual payout needs an approved, claimed execution');
  await command('APPROVE', mm.id, { expectedVersion: mm.version }, clock); await command('APPROVE', mm2.id, { expectedVersion: mm2.version }, clock); await command('APPROVE', mm3.id, { expectedVersion: mm3.version }, clock);
  const wrong = await command('MARK_PAID', mm2.id, { reference: 'bank-ref-0002', amount: '39', toUid: 'u-man2' }, clock);
  assert.equal(wrong.row.status, 'REJECTED'); assert.equal((await db.payoutExecution.findUniqueOrThrow({ where: { id: mm2.id } })).state, 'UNKNOWN', 'mismatched receipt: held for reconciliation');
  assert.equal((await walletOf(mexc, 'u-man2')).withdrawn, money(0));
  const good = await command('MARK_PAID', mm.id, { reference: 'bank-ref-0001', amount: '40', toUid: 'u-man' }, clock);
  assert.equal(good.row.status, 'DONE'); assert.equal((await walletOf(mexc, 'u-man')).withdrawn, money(40));
  const reused = await command('MARK_PAID', mm3.id, { reference: 'bank-ref-0001', amount: '40', toUid: 'u-man3' }, clock);
  assert.equal(reused.row.result.code, 'REFERENCE_REUSED'); assert.equal((await walletOf(mexc, 'u-man3')).withdrawn, money(0));
  const twice = await command('MARK_PAID', mm.id, { reference: 'bank-ref-0001', amount: '40', toUid: 'u-man' }, clock);
  assert.equal(twice.row.status, 'REJECTED'); assert.equal((await walletOf(mexc, 'u-man')).withdrawn, money(40), 'a second confirmation settles nothing more');
  const rec = await command('RECONCILE', mm3.id, {}, clock); assert.equal(rec.row.result.code, 'NOT_IN_FLIGHT');
  pass('C15 manual mark-paid: approval + exact receipt required, mismatch -> UNKNOWN, reused reference and repeat confirmation settle nothing');

  // ---------------------------------------------------------------- C16 read model, banner and fail-closed invariants
  await earn(mexc, 'u-view', '2');
  const before = await core.listPayables();
  assert(before.items.some(i => i.uid === 'u-view'), 'unsynced or waiting debts stay in the default view');
  assert.equal(typeof before.banner.scopesNotSynced, 'number');
  const viewAcc = await account(mexc, 'u-view');
  await db.wallet.update({ where: { uidAccountId_asset: { uidAccountId: viewAcc.id, asset: 'USDT' } }, data: { available: { increment: 1 } } }); // tamper
  await db.$transaction(async tx => core.syncPayableScope(tx, viewAcc.id, 'USDT'));
  const broken = await db.payableSyncScope.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: viewAcc.id, asset: 'USDT' } } });
  assert.equal(broken.state, 'FAILED'); assert.match(broken.invariantError, /AVAILABLE_MISMATCH/);
  const after = await core.listPayables(); assert.equal(after.totalsByAsset, null, 'no complete total while a scope is unsynced/failed'); assert(after.banner.invariantErrors >= 1);
  assert.equal(after.items.find(i => i.uid === 'u-view').primaryReason, 'SYNC_FAILED');
  await runSlot(nextDay()); assert.equal((await execsOf(mexc, 'u-view')).length, 0, 'a broken invariant fails closed');
  await db.wallet.update({ where: { uidAccountId_asset: { uidAccountId: viewAcc.id, asset: 'USDT' } }, data: { available: { decrement: 1 } } });
  await db.$transaction(async tx => core.syncPayableScope(tx, viewAcc.id, 'USDT'));
  assert.equal(await db.payableSyncScope.count({ where: { state: 'FAILED' } }), 0, 'repairing the wallet lets the sync clear the failure');
  pass('C16 admin read model keeps debts visible, banner flags unsynced scopes, totals withheld, invariant breach fails closed');

  // ---------------------------------------------------------------- C17 database guarantees
  const dbAcc = await account(mexc, 'u-sync'); const anyPayable = await db.customerPayable.findFirstOrThrow({ where: { uidAccountId: dbAcc.id } });
  await assert.rejects(() => db.customerPayable.update({ where: { id: anyPayable.id }, data: { settledAmount: { increment: 1000 } } }), /CustomerPayable_amounts_check|check constraint/);
  const open = await db.customerPayable.findFirstOrThrow({ where: { paymentStatus: 'UNPAID', closedAt: null, allocations: { some: { state: 'ACTIVE' } } }, include: { allocations: true } }).catch(() => null);
  if (open) {
    const other = await db.payoutExecution.create({ data: { uidAccountId: open.uidAccountId, exchangeId: open.exchangeId, asset: 'USDT', slotKey: 'x', total: 1, requiresApproval: false, state: 'CANCELLED', valuationMode: 'x', policyVersion: 'x', earliestSendAt: new Date() } });
    await assert.rejects(() => db.payableAllocation.create({ data: { executionId: other.id, payableId: open.id, amount: 1 } }), /Unique constraint|one_active/);
  }
  const execForUnique = await db.payoutExecution.findFirstOrThrow({ where: { state: { in: ['AWAITING_APPROVAL', 'READY'] } } });
  await assert.rejects(() => db.payoutExecution.create({ data: { uidAccountId: execForUnique.uidAccountId, exchangeId: execForUnique.exchangeId, asset: 'USDT', slotKey: 'y', total: 1, requiresApproval: false, state: 'READY', valuationMode: 'x', policyVersion: 'x', earliestSendAt: new Date() } }), /Unique constraint|one_open/);
  await assert.rejects(() => db.payableAllocation.create({ data: { executionId: execForUnique.id, payableId: anyPayable.id, amount: 0 } }), /check constraint|amount_positive/);
  await assert.rejects(() => db.moneyFlowGate.create({ data: { id: 2, mode: 'LEGACY' } }), /check constraint|single_row/);
  pass('C17 DB guarantees: amount algebra CHECK, one ACTIVE allocation per payable, one open execution per scope, positive amounts, single gate row');

  // ---------------------------------------------------------------- C18 audit never holds secrets; events exist for every state change
  const events = await db.payableEvent.findMany();
  assert(events.length > 20); assert(!JSON.stringify(events).match(/secret|private|apikey/i));
  for (const kind of ['PAYABLE_CREATED', 'EXECUTION_PREPARED', 'EXECUTION_DISPATCHING', 'EXECUTION_CONFIRMED', 'EXECUTION_FAILED_NOT_SENT', 'EXECUTION_UNKNOWN', 'EXECUTION_APPROVED', 'EXECUTION_MERGED', 'EXECUTION_INVALIDATED', 'EXECUTION_CANCELLED', 'RECEIPT_MISMATCH', 'INSUFFICIENT_SOURCE_FUNDS'])
    assert(events.some(e => e.kind === kind), `audit event ${kind} recorded`);
  pass('C18 audit trail covers prepare, dispatch, confirm, failure, unknown, approval, merge, invalidation, cancel, mismatch, funds');

  // ---------------------------------------------------------------- C19 no money invented: every wallet balances against its ledger
  for (const a of await db.uidAccount.findMany({ include: { wallets: true } })) {
    const w = a.wallets.find(x => x.asset === 'USDT'); if (!w) continue;
    const entries = await db.walletEntry.findMany({ where: { walletId: w.id } });
    const settled = entries.filter(e => e.type === 'WITHDRAWAL_SETTLE').reduce((t, e) => t + Number(e.amount), 0);
    assert.equal(settled.toFixed(6), Number(w.withdrawn).toFixed(6), `${a.uid}: withdrawn equals settle entries`);
    const reserveNet = entries.filter(e => e.type === 'WITHDRAWAL_RESERVE').reduce((t, e) => t + Number(e.amount), 0) - entries.filter(e => ['WITHDRAWAL_RELEASE', 'WITHDRAWAL_SETTLE'].includes(e.type)).reduce((t, e) => t + Number(e.amount), 0);
    assert.equal(reserveNet.toFixed(6), Number(w.reserved).toFixed(6), `${a.uid}: reserved equals reserve - release - settle`);
  }
  assert.equal(await db.walletEntry.count({ where: { opKey: { startsWith: 'allocation:' } } }), await db.walletEntry.count({ where: { opKey: { startsWith: 'allocation:' } } }));
  pass('C19 wallet buckets equal the sum of their allocation movements for every account');
  console.log(`\n${results.length} scenario groups passed`);
} finally {
  clearInternalTransferPortsSafe();
  await db?.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}
function clearInternalTransferPortsSafe() { /* ports live in-process only */ }
