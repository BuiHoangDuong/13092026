import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const affiliateConfigured = Boolean(process.env.MEXC_AFFILIATE_API_KEY?.trim() && process.env.MEXC_AFFILIATE_API_SECRET?.trim());
const apiKey = (affiliateConfigured ? process.env.MEXC_AFFILIATE_API_KEY : process.env.MEXC_API_KEY)?.trim();
const apiSecret = (affiliateConfigured ? process.env.MEXC_AFFILIATE_API_SECRET : process.env.MEXC_API_SECRET)?.trim();
if (!apiKey || !apiSecret) {
  console.error("MISSING_KEY: fill MEXC_AFFILIATE_API_KEY and MEXC_AFFILIATE_API_SECRET in .env");
  process.exitCode = 1;
} else {
  const startTime = Date.now() - 24 * 60 * 60 * 1000;
  const params = new URLSearchParams({
    startTime: String(startTime), endTime: String(Date.now()), page: "1", pageSize: "1",
    recvWindow: "10000", timestamp: String(Date.now())
  });
  params.set("signature", createHmac("sha256", apiSecret).update(params.toString()).digest("hex"));

  try {
    const response = await fetch(`https://api.mexc.com/api/v3/rebate/affiliate/referral?${params}`, {
      headers: { "X-MEXC-APIKEY": apiKey }, signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === "number" ? body.code : "UNKNOWN";
    if (response.ok && body?.success === true && code === 0 && Array.isArray(body?.data?.resultList)) {
      console.log(JSON.stringify({ connected: true, endpoint: "affiliate/referral", httpStatus: response.status,
        firstPageRows: body.data.resultList.length, rootUidConfigured: Boolean(process.env.MEXC_AFFILIATE_MASTER_UID?.trim()) }));
    } else {
      console.error(JSON.stringify({ connected: false, endpoint: "affiliate/referral", httpStatus: response.status, code }));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ connected: false, endpoint: "affiliate/referral",
      error: error instanceof Error ? error.name : "REQUEST_FAILED" }));
    process.exitCode = 1;
  }
}
