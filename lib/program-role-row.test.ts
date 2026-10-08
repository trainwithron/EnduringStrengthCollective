import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Label and order sits in the program's button row", () => {
  it("the program page gives it to the builder's button row and no longer shows a block of its own above the builder", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
    expect(page).toContain("toolbarExtra={");
    expect(page.indexOf("<ProgramRoleControl")).toBeGreaterThan(page.indexOf("toolbarExtra={"));
    expect(page.indexOf("<ProgramRoleControl")).toBeGreaterThan(page.indexOf("<ProgramBuilderDesktop"));
  });
  it("the builder shows it after Print or PDF, and the control is one compact inline row with the same fields and saving", () => {
    const builder = read("components/coach/desktop/program-builder-desktop.tsx");
    expect(builder.indexOf("{toolbarExtra}")).toBeGreaterThan(builder.indexOf("Print or PDF"));
    const control = read("components/coach/program-role-control.tsx");
    expect(control).not.toContain("Label and order</h3>");
    expect(control).toContain('.update({ label: label.trim() === "" ? null : label.trim(), sort_order: parsedOrder })');
    expect(control).toContain("available");
  });
});
