import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { removeProgramMessage } from "@/lib/program-archive";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Remove from this profile", () => {
  it("the confirmation says nothing is deleted and that it can be put back", () => {
    expect(removeProgramMessage("Strength Block", "William Stafford")).toBe(
      `Remove "Strength Block" from William Stafford's profile? Their logged history stays. You can put it back any time.`
    );
    expect(removeProgramMessage("X", " ")).toContain("this client's profile");
  });

  const menu = read("components/coach/client-program-menu.tsx");
  it("the row's menu offers Make inactive / Make active (the existing switch) and Remove from this profile, and never a delete", () => {
    expect(menu).toContain('{isActive ? "Make inactive" : "Make active"}');
    expect(menu).toContain("Remove from this profile");
    expect(menu).toContain('.update({ is_active: !isActive })');
    expect(menu).not.toContain(".delete()");
  });
  it("removing keeps everything: it only sets archived_at, and makes the program inactive in the same update", () => {
    expect(menu).toContain('.update({ is_active: false, archived_at: new Date().toISOString() })');
    expect(menu).toContain("removeProgramMessage(programName, clientName)");
    expect(menu).toContain("confirmDialog(");
  });
  it("is a 44px target, closes on outside click and Escape, and sits beside the row's link so it never opens the program", () => {
    expect(menu).toContain("w-11 h-11");
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain('document.addEventListener("mousedown", onDown)');
    const section = read("components/coach/desktop/client-programs-section.tsx");
    expect(section).toMatch(/<\/Link>\s*<ClientProgramMenu/);
  });
  it("an unsigned AI draft can be removed from the profile (it has no Make active, which needs a sign-off)", () => {
    expect(menu).toContain("{!aiDraft && (");
  });
  it("a removed program leaves the list, the pickers and the side panel, and sits in a 'Removed programs (n)' fold with Put back", () => {
    const section = read("components/coach/desktop/client-programs-section.tsx");
    expect(section).toContain('.is("archived_at", null)');
    expect(section).toContain('.not("archived_at", "is", null)');
    expect(section).toContain("<RemovedPrograms programs={removed} />");
    const fold = read("components/coach/removed-programs.tsx");
    expect(fold).toContain("Removed programs ({programs.length})");
    expect(fold).toContain("Put back");
    expect(fold).toContain('.update({ archived_at: null })');
    expect(fold).not.toContain("is_active: true");
    for (const f of ["components/coach/client-program-actions.tsx", "components/coach/desktop/program-panel-list.tsx", "app/(coach)/programs/page.tsx", "app/(coach)/groups/[groupId]/programs/page.tsx", "components/coach/desktop/program-assigned-clients.tsx"]) {
      expect(read(f)).toContain('.is("archived_at", null)');
    }
  });
  it("the database keeps it inactive and hides it from the client like an unsigned draft (migration 0328)", () => {
    const sql = read("supabase/migrations/0328_program_archive.sql");
    expect(sql).toContain("check (archived_at is null or is_active = false)");
    expect(sql).toContain("(not ai_draft and archived_at is null)");
    expect(sql).toContain("p.ai_draft or p.archived_at is not null");
  });
  it("the real delete stays only on the Programs page card menu", () => {
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain('.from("programs").delete()');
  });
});
