import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const isolatedHome = path.resolve(process.cwd(), ".next/build-home");
const result = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
  cwd: process.cwd(),
  env: { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome },
  stdio: "inherit"
});

process.exit(result.status ?? 1);
