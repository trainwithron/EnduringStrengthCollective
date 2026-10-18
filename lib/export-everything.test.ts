import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/account/export/route.ts", "utf8");
const lib = readFileSync("lib/account-export.ts", "utf8");
const sql = readFileSync("supabase/migrations/0412_export_my_data.sql", "utf8");
const button = readFileSync("components/athlete/export-data-button.tsx", "utf8");
const sweeper = readFileSync("app/api/cron/coach-chat-cleanup/route.ts", "utf8");

describe("Download my data gives everything", () => {
  it("reads as the signed-in person, one page of one table per database call", () => {
    expect(lib).toContain('client.rpc("export_my_data_tables")');
    expect(lib).toContain('client.rpc("export_my_data_table"');
    expect(route).toContain("collectEverything(supabase");
  });

  it("uses the server key only to store a large download, and rate-limits the route", () => {
    expect(route.match(/createServiceRoleClient\(\)/g)).toHaveLength(1);
    expect(route).toContain('rateLimitResponse("account-export-hour", user.id, 5, 3600)');
  });

  it("sends compact JSON, and a large one as a link (a redirect for a browser address, JSON for the button)", () => {
    expect(route).toContain("JSON.stringify(exportData)");
    expect(route).not.toContain("JSON.stringify(exportData, null");
    expect(route).toContain('deliveryFor(Buffer.byteLength(body)) === "link"');
    expect(route).toContain('"sec-fetch-mode") === "navigate"');
    expect(button).toContain("X-Export-Link");
  });

  it("still downloads the main sections when the functions are not there yet", () => {
    expect(route).toContain("everything ? everything.tables : null");
    expect(route).toContain("bodyWeightLogs");
  });

  it("the functions run as the person, refuse a signed-out caller, are closed to visitors and only accept a listed table and column", () => {
    expect((sql.match(/^security invoker$/gm) ?? []).length).toBe(2);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toMatch(/auth\.uid\(\)/);
    expect(sql).toMatch(/revoke execute on function public\.export_my_data_tables\(\) from public, anon/);
    expect(sql).toMatch(/revoke execute on function public\.export_my_data_table\(text, text, integer, integer\) from public, anon/);
    expect(sql).toContain("from public.export_my_data_tables() x where x.tbl = p_table and x.col = p_col");
    expect(sql).toContain("public.%I where %I = $1");
  });

  it("leaves out sign-in tokens, push keys, PINs and the tables that hold them", () => {
    for (const secret of ["access_token", "refresh_token", "auth_key", "p256dh", "pin_hash", "kiosk_pin", "token_hash", "api_key_hash"]) expect(sql).toContain(`'${secret}'`);
    for (const table of ["wearable_oauth_tokens", "google_calendar_oauth_tokens", "push_subscriptions", "guardian_links", "kiosk_pins", "coach_api_keys"]) expect(sql).toContain(`'${table}'`);
  });

  it("covers requests, invites and blocks that name the person", () => {
    for (const column of ["from_athlete_id", "to_athlete_id", "invited_profile_id", "blocker_id"]) expect(sql).toContain(`'${column}'`);
  });

  it("is in a fixed order, newest first, and says when it cut", () => {
    expect(sql).toContain("created_at desc nulls last");
    expect(lib).toMatch(/newest/);
    expect(lib).toContain("truncated");
  });

  it("the large-download files are tidied away daily", () => {
    expect(sweeper).toContain("sweepAccountExports(supabase)");
  });
});
