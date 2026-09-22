import assert from "node:assert/strict";
import test from "node:test";
import { adminRouteRequiresSession } from "../src/lib/session-cookie.ts";

test("admin routes require a session cookie except login", () => {
  assert.equal(adminRouteRequiresSession("/admin"), true);
  assert.equal(adminRouteRequiresSession("/admin/imports"), true);
  assert.equal(adminRouteRequiresSession("/admin/links"), true);
  assert.equal(adminRouteRequiresSession("/admin/login"), false);
  assert.equal(adminRouteRequiresSession("/admin/login/"), false);
  assert.equal(adminRouteRequiresSession("/"), false);
  assert.equal(adminRouteRequiresSession("/api/admin/imports"), false);
});
