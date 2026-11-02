import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("Resources: a referral partner or Pro Shop link can be edited, not only deleted (Ron, Nov 2)", () => {
  for (const [file, table, label] of [
    ["components/coach/desktop/referral-directory-manager.tsx", "referral_partners", "Edit referral partner"],
    ["components/coach/desktop/pro-shop-manager.tsx", "pro_shop_links", "Edit Pro Shop link"],
  ] as const) {
    it(file, () => {
      const src = read(file);
      // A pencil beside the trash can fills the form; Save writes over that row and checks a row was changed.
      expect(src).toContain("onClick={() => startEdit(");
      expect(src).toContain("aria-label={`Edit ");
      expect(src).toContain(label);
      expect(src).toContain(`await supabase.from("${table}").update(fields).eq("id", id).select("id");`);
      expect(src).toContain("if (updateError || !updated?.length) {");
      expect(src).toContain("Cancel");
    });
  }
});
