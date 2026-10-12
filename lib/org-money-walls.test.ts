import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the money settings on a membership are the server's", () => {
  it("the database removes broad write rights and leaves only the role and the share", () => {
    const sql = read("supabase/migrations/0354_organization_money_columns_server_only.sql");
    expect(sql).toContain("revoke insert, update on public.organization_memberships from authenticated, anon;");
    expect(sql).toContain("grant update (role, revenue_share_pct) on public.organization_memberships to authenticated;");
    expect(sql).toContain("These shares add up to more than 100%. Lower one to save.");
  });
  it("the only code that writes the connected account is the Connect route, with the service role", () => {
    const route = read("app/api/stripe/connect/onboard/route.ts");
    expect(route).toContain("createServiceRoleClient");
    expect(route).toContain("stripe_connect_account_id: accountId");
  });
  it("the share editor saves when the box is left and says so when the total would pass 100%", () => {
    const ed = read("components/coach/desktop/revenue-split-editor.tsx");
    expect(ed).toContain("onBlur={() => persistShare(share.profileId)}");
    expect(ed).toContain("These shares add up to more than 100%. Lower one to save.");
  });
});
