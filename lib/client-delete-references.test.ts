import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("deleting a client clears what points at them", () => {
  it("eraseAccount calls the clearing function before deleting the account and never shows a raw database message", () => {
    const src = read("lib/account-deletion.ts");
    expect(src.indexOf('db.rpc("detach_profile_references"')).toBeGreaterThan(0);
    expect(src.indexOf('db.rpc("detach_profile_references"')).toBeLessThan(src.indexOf("db.auth.admin.deleteUser"));
    expect(src).toContain("Their account was not deleted.");
    expect(src).not.toMatch(/error: `\$\{what\}: \$\{message\}`/);
    expect(src).toContain("so they can't be deleted here.");
  });
  it("the migration is server-only, ASCII, and refuses before it changes anything", () => {
    const sql = read("supabase/migrations/0322_client_delete_references.sql");
    expect(/[^\x00-\x7f]/.test(sql)).toBe(false);
    expect(sql.match(/revoke all on function/g)?.length).toBe(4);
    expect(sql.match(/grant execute on function .* to service_role/g)?.length).toBe(4);
    expect(sql).not.toMatch(/to (anon|authenticated|public)/);
    expect(sql.indexOf("raise exception 'cannot_delete: this person still owns")).toBeLessThan(sql.indexOf("execute format('delete from public.%I"));
  });
});
