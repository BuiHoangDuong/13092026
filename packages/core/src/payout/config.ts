// Auto payout skeleton (Req 21, draft). Reads worker-only configuration and reports
// secret-free readiness. Nothing here signs, broadcasts, or touches wallet balances.
export const autoPayoutNetworks = {
  ETHEREUM: { asset: "ETH", family: "EVM", decimals: 18, rpcEnv: "PAYOUT_ETHEREUM_RPC_URL", chainIds: { mainnet: 1, testnet: 11155111 } },
  BSC: { asset: "BNB", family: "EVM", decimals: 18, rpcEnv: "PAYOUT_BSC_RPC_URL", chainIds: { mainnet: 56, testnet: 97 } },
  SOLANA: { asset: "SOL", family: "SOLANA", decimals: 9, rpcEnv: "PAYOUT_SOLANA_RPC_URL", chainIds: null }
} as const;
export type AutoPayoutNetwork = keyof typeof autoPayoutNetworks;
export type PayoutChainEnv = "testnet" | "mainnet";
export type PayoutNetworkReadiness = { network: AutoPayoutNetwork; asset: string; ready: boolean; problems: string[] };
export type PayoutReadiness = { configured: boolean; enabled: boolean; chainEnv: PayoutChainEnv; problems: string[]; networks: PayoutNetworkReadiness[] };

const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(value: string): Uint8Array | null {
  if (!value || [...value].some(char => !base58.includes(char))) return null;
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(base58.indexOf(char));
  let hex = number === 0n ? "" : number.toString(16); if (hex.length % 2) hex = "0" + hex;
  const leadingZeros = value.length - value.replace(/^1+/, "").length;
  return Uint8Array.from([...new Array<number>(leadingZeros).fill(0), ...Buffer.from(hex, "hex")]);
}
const validEvmKey = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const validSolanaKey = (value: string) => base58Decode(value)?.length === 64;
function validRpcUrl(value: string, production: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return !production && url.protocol === "http:" && ["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname);
  } catch { return false; }
}
function dailyLimits(raw: string | undefined): Record<string, string> | null {
  try {
    const values: unknown = JSON.parse(raw || "{}");
    if (!values || typeof values !== "object" || Array.isArray(values)) return null;
    const entries = Object.entries(values as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string" || !/^\d{1,20}(?:\.\d{1,18})?$/.test(value))) return null;
    return Object.fromEntries(entries) as Record<string, string>;
  } catch { return null; }
}

/** Problems name env variables only; values and secrets never leave this function. */
export function payoutReadiness(env: NodeJS.ProcessEnv = process.env): PayoutReadiness {
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  const flag = (env.PAYOUT_AUTO_ENABLED ?? "").trim().toLowerCase();
  if (!["", "true", "false"].includes(flag)) problems.push("PAYOUT_AUTO_ENABLED must be true or false");
  const chainEnvRaw = (env.PAYOUT_CHAIN_ENV ?? "").trim() || "testnet";
  const chainEnv: PayoutChainEnv = chainEnvRaw === "mainnet" ? "mainnet" : "testnet";
  if (!["testnet", "mainnet"].includes(chainEnvRaw)) problems.push("PAYOUT_CHAIN_ENV must be testnet or mainnet");
  if (chainEnv === "mainnet" && !production) problems.push("PAYOUT_CHAIN_ENV=mainnet is blocked outside production");
  const limits = dailyLimits(env.PAYOUT_DAILY_LIMITS);
  if (!limits) problems.push("PAYOUT_DAILY_LIMITS must be a JSON object of decimal strings");
  const evmKey = (env.PAYOUT_EVM_PRIVATE_KEY ?? "").trim();
  const solanaKey = (env.PAYOUT_SOLANA_SECRET_KEY ?? "").trim();
  const networks = (Object.keys(autoPayoutNetworks) as AutoPayoutNetwork[]).map(network => {
    const spec = autoPayoutNetworks[network];
    const own: string[] = [];
    if (spec.family === "EVM") { if (!evmKey) own.push("PAYOUT_EVM_PRIVATE_KEY missing"); else if (!validEvmKey(evmKey)) own.push("PAYOUT_EVM_PRIVATE_KEY invalid format"); }
    else { if (!solanaKey) own.push("PAYOUT_SOLANA_SECRET_KEY missing"); else if (!validSolanaKey(solanaKey)) own.push("PAYOUT_SOLANA_SECRET_KEY invalid format"); }
    const rpc = (env[spec.rpcEnv] ?? "").trim();
    if (!rpc) own.push(`${spec.rpcEnv} missing`); else if (!validRpcUrl(rpc, production)) own.push(`${spec.rpcEnv} must be https`);
    if (limits && !limits[spec.asset]) own.push(`PAYOUT_DAILY_LIMITS.${spec.asset} missing`);
    return { network, asset: spec.asset, ready: !problems.length && !own.length, problems: own };
  });
  const configured = flag === "true" && !problems.length && networks.some(n => n.ready);
  // No sender is implemented yet, so auto payout stays off even when configured (Req 21.12).
  return { configured, enabled: false, chainEnv, problems, networks };
}
