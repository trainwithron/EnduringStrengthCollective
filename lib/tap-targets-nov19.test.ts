import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

// Phone check, Nov 19: text links about 16px tall were too small to tap; each is a 44px target now.
describe("small text links are full-size tap targets on a phone", () => {
  it("the Connect links (Google Calendar, Oura, Withings, Google Health, Garmin)", () => {
    for (const f of ["components/coach/google-calendar-connection.tsx", "components/athlete/oura-connection.tsx", "components/athlete/withings-connection.tsx", "components/athlete/google-health-connection.tsx", "components/athlete/garmin-connection.tsx"]) {
      expect(read(f), f).toContain('className="font-body text-xs text-rust inline-flex items-center min-h-11 px-2 -mx-2"');
    }
  });
  it("Settings' Coach home and coach-invite links, the coaches section link, and Skip this on the check-in", () => {
    const settings = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(settings.match(/inline-flex items-center min-h-11/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read("components/coach/coaches-section.tsx")).toContain("underline underline-offset-2 inline-flex items-center min-h-11");
    expect(read("components/athlete/wellness-checkin-widget.tsx")).toContain("text-steel mt-1 inline-flex items-center min-h-11");
  });
});
