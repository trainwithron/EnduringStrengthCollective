import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const form = readFileSync("components/coach/desktop/add-client-button.tsx", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit item 12: adding a private client while standing in the Trojans page quietly created them inside Lee County West Trojans.
describe("Add client names the organization it uses", () => {
  it("reads the organization's name for the page's group when the box opens", () => {
    expect(form).toContain('.select("organization_id, organizations ( name )")');
    expect(form).toContain("setOrgInfo({ checked: true, name: current?.organization_id");
  });
  it("the one-on-one form says 'Adding to <organization>.' before anything is typed", () => {
    expect(form).toContain('{step === "one_on_one" && orgInfo.checked && (');
    expect(form).toContain("Adding to <span className=\"text-chalk\">{orgInfo.name}</span>.");
  });
  it("a space with no organization says so up front instead of failing after the name is typed", () => {
    expect(form).toContain("This space is not part of an organization, so a one-on-one client cannot be added from here. Open one of your organizations first.");
  });
  it("shows nothing until the organization has been read (no flash of the wrong line)", () => {
    expect(form).toContain("const [orgInfo, setOrgInfo] = useState<{ checked: boolean; name: string | null }>({ checked: false, name: null });");
  });
});
