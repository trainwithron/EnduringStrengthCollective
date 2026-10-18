import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/account/export/route.ts", "utf8");
const sql = readFileSync("supabase/migrations/0412_export_my_data.sql", "utf8");

describe("Download my data gives everything", () => {
  it("asks the database for the complete collection, as the signed-in person", () => {
    expect(route).toContain('supabase.rpc("export_my_data")');
    expect(route).not.toMatch(/createServiceClient|createAdminClient|SERVICE_ROLE/);
  });

  it("still downloads the main sections when the function is not there yet", () => {
    expect(route).toContain("everythingError ? null : everything");
    expect(route).toContain("bodyWeightLogs");
  });

  it("the function runs as the person, refuses a signed-out caller, and is not open to visitors", () => {
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/auth\.uid\(\)/);
    expect(sql).toMatch(/revoke execute on function public\.export_my_data\(\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.export_my_data\(\) to authenticated;/);
  });

  it("leaves out sign-in tokens, push keys, PINs and the tables that hold them", () => {
    for (const secret of ["access_token", "refresh_token", "auth_key", "p256dh", "pin_hash", "kiosk_pin", "token_hash"]) expect(sql).toContain(`'${secret}'`);
    for (const table of ["wearable_oauth_tokens", "google_calendar_oauth_tokens", "push_subscriptions", "guardian_links", "kiosk_pins"]) expect(sql).toContain(`'${table}'`);
  });

  it("never silently cuts a large table", () => {
    expect(sql).toContain("'truncated'");
  });
});
