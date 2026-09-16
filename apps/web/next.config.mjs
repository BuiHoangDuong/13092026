import path from "node:path";

/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ["@cashback/contracts"],
  serverExternalPackages: ["@cashback/core", "@cashback/db", "@prisma/client"],
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  experimental: { optimizePackageImports: ["@cashback/contracts"] }
};

export default config;
