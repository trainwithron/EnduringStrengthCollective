import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cardScanMessage, isScannerBurst, matchCardRows, normalizeCardCode, parseCardCsv } from "./checkin-cards";
import { SAVING_API } from "./workspace-mutation";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("key cards at the Kiosk (Ron, Nov 2, step 198)", () => {
  it("a card number is 3 to 64 visible characters, trimmed", () => {
    expect(normalizeCardCode("  0042817 ")).toBe("0042817");
    expect(normalizeCardCode("12")).toBeNull();
    expect(normalizeCardCode("12 34")).toBeNull();
    expect(normalizeCardCode(42)).toBeNull();
  });

  it("tells a scanner (fast) from a person typing (slow)", () => {
    expect(isScannerBurst([0, 8, 16, 24, 31, 40])).toBe(true);
    expect(isScannerBurst([0, 180, 350, 520])).toBe(false);
    expect(isScannerBurst([0, 10])).toBe(false);
  });

  it("reads a Mindbody-style export: the barcode column over the client id, first and last name, email; never a payment card column", () => {
    const csv = 'Client ID,First Name,Last Name,Email,Barcode ID,Credit Card Last 4\n1001,Amber,Belt,AMBER@x.com,0042817,4242\n1002,"Glen, Jr",Key,,0042818,1111\n1003,No,Card,n@x.com,,\n';
    const out = parseCardCsv(csv);
    expect("rows" in out && out.rows).toEqual([
      { name: "Amber Belt", email: "amber@x.com", code: "0042817" },
      { name: "Glen, Jr Key", email: "", code: "0042818" },
    ]);
    expect("rows" in out && out.skipped).toBe(1);
    expect(parseCardCsv("Name,Email\nA,b@x.com")).toEqual({ error: expect.stringContaining("card or barcode column") });
  });

  it("matches by email first, then by a full name only one client has", () => {
    const people = [
      { athleteId: "a1", fullName: "Amber Belt", email: "amber@x.com" },
      { athleteId: "a2", fullName: "Sam Lee" },
      { athleteId: "a3", fullName: "Sam Lee" },
      { athleteId: "a4", fullName: "Glen Key" },
    ];
    const { matched, unmatched } = matchCardRows(
      [
        { name: "A. Belt", email: "amber@x.com", code: "111" },
        { name: "Sam Lee", email: "", code: "222" },
        { name: "glen  key", email: "", code: "333" },
        { name: "Nobody", email: "", code: "444" },
      ],
      people
    );
    expect(matched).toEqual([
      { athleteId: "a1", code: "111", name: "A. Belt" },
      { athleteId: "a4", code: "333", name: "glen  key" },
    ]);
    expect(unmatched).toEqual(["Sam Lee", "Nobody"]);
  });

  it("the tablet says plainly why a scan did not check anyone in", () => {
    expect(cardScanMessage("unknown")).toContain("isn't linked to anyone");
    expect(cardScanMessage("not_here")).toContain("isn't for this check-in");
  });

  it("the database step: cards only through the functions, the same who-may-check-in rules and wrong-code limit as a PIN", () => {
    const sql = read("supabase/migrations/0443_checkin_cards_and_kiosk_mode.sql");
    expect(sql).toContain("revoke all on public.checkin_cards from anon, authenticated;");
    expect(sql).toContain("unique (organization_id, card_code)");
    expect(sql).toContain("v_scope text := public._front_desk_scope(p_org);");
    expect(sql).toContain("from public.front_desk_pin_misses x where x.caller = v_me and x.missed_at > now() - interval '15 minutes') >= 10");
    expect(sql).toContain("revoke execute on function public._may_manage_checkin_card(uuid, uuid) from public, anon, authenticated;");
    expect(read("supabase/apply/apply-step198-0443.sql")).toContain(sql.trim().slice(0, 200));
  });

  it("both check-in screens take a scan, the settings page has the switch, and the upload counts as a save", () => {
    for (const f of ["components/front-desk/front-desk-screen.tsx", "components/coach/kiosk-checkin-screen.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("useCardScanner(async (code) => {");
      expect(src, f).toContain('rpc("card_check_in"');
    }
    const settings = read("app/(coach)/groups/[groupId]/kiosk/settings/page.tsx");
    expect(settings).toContain("<KioskModeSwitch");
    expect(settings).toContain("`/front-desk?org=${organizationId}`");
    expect(read("components/coach/desktop/kiosk-mode-switch.tsx")).toContain("Who checks in on this tablet?");
    expect(SAVING_API.test("/api/kiosk/cards/import")).toBe(true);
  });
});
