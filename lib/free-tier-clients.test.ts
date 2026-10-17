import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_LIMIT_NEUTRAL_MESSAGE, clientLimitMessage, isClientLimitError } from "./free-tier-clients";
import { FREE_TIER_CLIENT_LIMIT } from "./ai-usage";
import { TRIAL_DAYS, GRACE_DAYS } from "./coach-plan-pricing";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the free plan's client limit", () => {
  const sql = src("supabase/migrations/0397_free_tier_client_limit.sql");

  it("says the same thing in the database and in the app, and uses the same numbers", () => {
    expect(sql).toContain(clientLimitMessage());
    expect(sql).toContain(CLIENT_LIMIT_NEUTRAL_MESSAGE);
    expect(sql).toContain(`>= ${FREE_TIER_CLIENT_LIMIT}`);
    expect(sql).toContain(`interval '${TRIAL_DAYS} days'`);
    expect(sql).toContain(`past_due_since, now()) + interval '${GRACE_DAYS} days'`);
    expect(clientLimitMessage()).toContain(String(FREE_TIER_CLIENT_LIMIT));
  });
  it("is installed switched off, and only a new training client is ever refused", () => {
    expect(sql).toMatch(/free_tier_clients_enforced\(\)[\s\S]*?select false/);
    expect(sql).toContain("if not public.free_tier_clients_enforced() then");
    expect(sql).toContain("new.membership_type is distinct from 'training'");
  });
  it("counts the people the bill counts, takes a lock per organization, and also watches a client moved between organizations", () => {
    expect(sql).toContain("g.archived_at is null");
    // the "already one of your clients" shortcut ignores retired seasons too
    expect(sql).toContain("from public._org_training_client_ids(v_org) c where c.profile_id = new.profile_id");
    expect(sql).toContain("select count(*)::int from public._org_training_client_ids(p_org)");
    expect(sql).toContain("om.departing_group_ids");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(v_org::text, 0))");
    expect(sql.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(sql.indexOf("if not public.org_is_free_tier(v_org) then"));
    expect(sql).toContain("update of role, membership_type, group_id on public.group_memberships");
    expect(sql).toContain("return public._org_training_clients(p_org_id)");
  });
  it("the roster import counts the room once and never makes an account it cannot place", () => {
    const route = src("app/api/clients/import-roster/route.ts");
    expect(route).toContain('rpc("free_tier_client_headroom"');
    expect(route.indexOf("free_tier_client_headroom")).toBeLessThan(route.indexOf("createUnclaimedClient(serviceRole"));
    expect(route).toContain("reason: clientLimitMessage()");
  });
  it("recognizes its own refusal and nothing else", () => {
    expect(isClientLimitError(`Couldn't add: ${clientLimitMessage()}`)).toBe(true);
    expect(isClientLimitError(CLIENT_LIMIT_NEUTRAL_MESSAGE)).toBe(true);
    expect(isClientLimitError("duplicate key value")).toBe(false);
    expect(isClientLimitError(null)).toBe(false);
  });
  it("adding a client turns the refusal into a plain answer, not a failure", () => {
    const code = src("lib/create-unclaimed-client.ts");
    expect(code).toContain("isClientLimitError(membershipError.message)");
    expect(code).toContain("status: 403, error: clientLimitMessage()");
  });
  it("is a step of its own with an undo, and nothing depends on it", () => {
    const steps = src("scripts/build-paste-files.mjs");
    expect(steps).toContain('slug: "0397"');
    expect(steps).toContain("drop trigger if exists group_memberships_free_tier_limit");
  });
});
