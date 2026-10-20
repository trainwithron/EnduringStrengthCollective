import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/(coach)/groups/[groupId]/settings/page.tsx", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: in the coach's own app (the personal space, no organization) Settings saved "What do you call your people?" into an arbitrary organization, and "Your coaching workspace" opened an empty dashboard.
describe("Settings in the coach's own personal space", () => {
  it("knows it is the personal space: acting as oneself in a group with no organization", () => {
    expect(page).toContain("organization_id");
    expect(page).toContain("const inPersonalSpace = effective.isActingAsOther && (group as { organization_id?: string | null } | null)?.organization_id == null;");
  });
  it("hides the organization's vocabulary choice there", () => {
    expect(page).toContain("const terminologyGroup = isCoach && !inPersonalSpace ? (");
  });
  it("has no 'Coach home' there (Release 2: the phone is their own app; the layout switch and the app download instead), and the group's workspace everywhere else", () => {
    expect(page).toContain("{inPersonalSpace ? (");
    expect(page).toContain('<TabletLayoutSwitch to="desktop" />');
    expect(page).toContain("<DownloadAppButton />");
    expect(page).toContain("<Link href={`/groups/${params.groupId}/dashboard`} className=\"font-body text-sm font-bold text-rust\">");
    expect(page).toContain("const viewingOther = effective.isActingAsOther && athleteId !== user.id;");
  });
});
