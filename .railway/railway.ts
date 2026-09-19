import { defineRailway, github, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const _13092026 = github("BuiHoangDuong/13092026", { checkSuites: false });

  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 5000 });
  const _cashbackworker = service("@cashback/worker", {
    source: _13092026,
    build: { buildCommand: "pnpm --filter @cashback/worker... build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/apps/worker/**", "/packages/core/**", "/packages/db/**", "/packages/contracts/**", "/pnpm-lock.yaml", "/pnpm-workspace.yaml"] },
    start: "pnpm --filter @cashback/worker start",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "cashbackworker" },
    env: { DATABASE_URL: Postgres.env.DATABASE_URL },
  });
  const _cashbackweb = service("@cashback/web", {
    source: _13092026,
    build: { buildCommand: "pnpm --filter @cashback/web... build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/apps/web/**", "/packages/core/**", "/packages/db/**", "/packages/contracts/**", "/pnpm-lock.yaml", "/pnpm-workspace.yaml"] },
    preDeploy: "pnpm --filter @cashback/db db:migrate",
    start: "pnpm --filter @cashback/web start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "cashbackweb" },
    env: {
      DATABASE_URL: Postgres.env.DATABASE_URL,
      CLIENT_IP_HEADER: "x-forwarded-for",
      APP_URL: "https://cashbackweb-production.up.railway.app",
    },
  });

  return project("13092026", {
    resources: [_cashbackworker, _cashbackweb, Postgres, postgresVolume],
  });
});
