import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

import { unconfirmedIds } from "@/lib/unconfirmed-emails";
import { EMAIL_NOT_CONFIRMED_LABEL } from "@/lib/unconfirmed-emails-label";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit item 18: Amber B. (since Sept 10) and Jeff Z. (since Sept 24) signed up from a group link, never confirmed, never signed in, and showed as ordinary active clients.
describe("who has not confirmed their email", () => {
  it("an account with an address and no confirmation", () => {
    expect(unconfirmedIds([{ id: "amber", email: "amber@example.com", email_confirmed_at: null }])).toEqual(["amber"]);
  });
  it("not a confirmed one, not a client set up by the coach with a placeholder address (a different state), not an account with no address", () => {
    expect(
      unconfirmedIds([
        { id: "ok", email: "a@example.com", email_confirmed_at: "2026-09-01T00:00:00Z" },
        { id: "placeholder", email: "client-x@pending.invalid", email_confirmed_at: null },
        { id: "none", email: null, email_confirmed_at: null },
      ])
    ).toEqual([]);
  });
});

describe("the Clients list", () => {
  it("shows the mark on the row and the card, from the cached list of ids", () => {
    expect(EMAIL_NOT_CONFIRMED_LABEL).toBe("Email not confirmed");
    const page = read("app/(coach)/clients/page.tsx");
    expect(page).toContain("const unconfirmed = await loadUnconfirmedUserIds();");
    expect(page).toContain("emailUnconfirmed: unconfirmed.has(c.id),");
    expect(read("components/coach/desktop/coach-clients-list.tsx").match(/\{c\.emailUnconfirmed && /g)?.length).toBe(2);
  });
  it("holds only ids (never an address), caches for five minutes, and a failed read gives no marks", () => {
    const src = read("lib/unconfirmed-emails.ts");
    expect(src).toContain("revalidate: 300");
    expect(src).toContain("} catch {\n    return new Set();");
    expect(src).not.toMatch(/out\.push\([^)]*email/);
  });
  it("the label file has no server-only imports (the list is a client component)", () => {
    expect(read("lib/unconfirmed-emails-label.ts")).not.toContain("import");
  });
});
