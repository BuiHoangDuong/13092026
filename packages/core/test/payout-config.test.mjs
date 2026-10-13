import test from "node:test";
import assert from "node:assert/strict";
import { base58Decode, payoutReadiness } from "../dist/index.js";

// Synthetic, non-wallet values only.
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) {
  let number = BigInt("0x" + Buffer.from(bytes).toString("hex")), out = "";
  while (number > 0n) { out = alphabet[Number(number % 58n)] + out; number /= 58n; }
  return "1".repeat(bytes.findIndex(b => b !== 0)) + out;
}
const evmKey = "0x" + "ab".repeat(32);
const solanaKey = base58Encode(Buffer.alloc(64, 7));
const full = {
  PAYOUT_AUTO_ENABLED: "true", PAYOUT_CHAIN_ENV: "testnet", PAYOUT_EVM_PRIVATE_KEY: evmKey, PAYOUT_SOLANA_SECRET_KEY: solanaKey,
  PAYOUT_ETHEREUM_RPC_URL: "https://rpc.example.test", PAYOUT_BSC_RPC_URL: "https://rpc.example.test", PAYOUT_SOLANA_RPC_URL: "https://rpc.example.test",
  PAYOUT_DAILY_LIMITS: JSON.stringify({ ETH: "0.01", BNB: "0.05", SOL: "0.2" })
};

test("base58 decode keeps leading zero bytes", () => {
  assert.equal(base58Decode(solanaKey).length, 64);
  assert.deepEqual([...base58Decode("11")], [0, 0]);
  assert.equal(base58Decode("0OIl"), null);
});

test("empty configuration reports every network as not ready and stays disabled", () => {
  const readiness = payoutReadiness({});
  assert.equal(readiness.configured, false);
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.chainEnv, "testnet");
  assert.ok(readiness.networks.every(n => !n.ready));
});

test("complete testnet configuration is configured but sending stays off and secrets never appear", () => {
  const readiness = payoutReadiness(full);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.enabled, false);
  assert.deepEqual(readiness.networks.map(n => [n.network, n.ready]), [["ETHEREUM", true], ["BSC", true], ["SOLANA", true]]);
  const text = JSON.stringify(readiness);
  assert.ok(!text.includes(evmKey) && !text.includes(solanaKey));
});

test("invalid key formats, http RPC and missing limits are named without values", () => {
  const readiness = payoutReadiness({ ...full, PAYOUT_EVM_PRIVATE_KEY: "0x1234", PAYOUT_SOLANA_RPC_URL: "http://rpc.example.test", PAYOUT_DAILY_LIMITS: "{\"ETH\":\"0.01\"}" });
  const byNetwork = Object.fromEntries(readiness.networks.map(n => [n.network, n.problems]));
  assert.ok(byNetwork.ETHEREUM.includes("PAYOUT_EVM_PRIVATE_KEY invalid format"));
  assert.ok(byNetwork.BSC.includes("PAYOUT_DAILY_LIMITS.BNB missing"));
  assert.ok(byNetwork.SOLANA.includes("PAYOUT_SOLANA_RPC_URL must be https"));
  assert.ok(!JSON.stringify(readiness).includes("0x1234"));
});

test("mainnet is blocked outside production", () => {
  const local = payoutReadiness({ ...full, PAYOUT_CHAIN_ENV: "mainnet" });
  assert.ok(local.problems.includes("PAYOUT_CHAIN_ENV=mainnet is blocked outside production"));
  assert.equal(local.configured, false);
  assert.equal(payoutReadiness({ ...full, PAYOUT_CHAIN_ENV: "mainnet", NODE_ENV: "production" }).configured, true);
});
