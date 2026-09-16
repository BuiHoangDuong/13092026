import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const _13092026 = github("BuiHoangDuong/13092026", { checkSuites: false });

  const _cashbackworker = service("@cashback/worker", {
    source: _13092026,
    build: { buildCommand: "pnpm --filter @cashback/worker... build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/apps/worker/**"] },
    start: "pnpm --filter @cashback/worker start",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "cashbackworker" },
  });
  const _cashbackweb = service("@cashback/web", {
    source: _13092026,
    build: { buildCommand: "pnpm --filter @cashback/web... build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/apps/web/**"] },
    start: "pnpm --filter @cashback/web start",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "cashbackweb" },
  });

  return project("13092026", {
    resources: [_cashbackworker, _cashbackweb],
  });
});
