import { describe, expect, it } from "vitest";
import { buildMoreSections } from "./more-links";

const flat = (o: Parameters<typeof buildMoreSections>[0]) => buildMoreSections(o).flatMap((s) => s.links);
const base = { groupId: "g1", athleteId: "a1", isCoach: false, historyImportEnabled: false };

describe("buildMoreSections", () => {
  it("keeps every destination that used to be under Settings", () => {
    const hrefs = flat({ ...base, historyImportEnabled: true }).map((l) => l.href);
    for (const h of [
      "/groups/g1/goal",
      "/groups/g1/tools/one-rep-max",
      "/groups/g1/tools/macro-calculator",
      "/partners",
      "/share/journey/a1",
      "/groups/g1/progress-photos",
      "/groups/g1/resources",
      "/groups/g1/quick-tips",
      "/groups/g1/records",
      "/groups/g1/video-checkins",
      "/groups/g1/my-history",
      "/groups/g1/messages",
    ]) {
      expect(hrefs).toContain(h);
    }
  });
  it("shows exercise history only to a client who has it switched on", () => {
    expect(flat(base).some((l) => l.href.endsWith("/my-history"))).toBe(false);
    expect(flat({ ...base, historyImportEnabled: true }).some((l) => l.href.endsWith("/my-history"))).toBe(true);
    expect(flat({ ...base, isCoach: true, historyImportEnabled: true }).some((l) => l.href.endsWith("/my-history"))).toBe(false);
  });
  it("does not offer a coach the client-only video check-ins", () => {
    expect(flat({ ...base, isCoach: true }).some((l) => l.href.endsWith("/video-checkins"))).toBe(false);
  });
  it("words Messages for who is reading", () => {
    expect(flat(base).find((l) => l.label === "Messages")?.hint).toBe("Message your coach");
    expect(flat({ ...base, isCoach: true }).find((l) => l.label === "Messages")?.hint).toBe("Message your clients");
  });
  it("has no empty sections and no repeated links", () => {
    const sections = buildMoreSections({ ...base, historyImportEnabled: true });
    expect(sections.every((s) => s.links.length > 0)).toBe(true);
    const hrefs = sections.flatMap((s) => s.links.map((l) => l.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
