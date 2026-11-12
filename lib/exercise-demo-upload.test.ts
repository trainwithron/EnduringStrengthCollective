import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoContentType, demoExtension, demoFileProblem } from "./exercise-demo-upload";
import { phoneCoachRedirect } from "./phone-coach-routes";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("adding an exercise demo from a phone", () => {
  it("takes the phone's video even when the browser hands over no type", () => {
    expect(demoContentType({ type: "video/mp4", name: "a.mp4" })).toBe("video/mp4");
    expect(demoContentType({ type: "", name: "VID_2026.MP4" })).toBe("video/mp4");
    expect(demoContentType({ type: "", name: "clip.mov" })).toBe("video/quicktime");
    expect(demoContentType({ type: "video/3gpp", name: "clip.3gp" })).toBeNull();
    expect(demoExtension("video/quicktime")).toBe("mov");
  });
  it("says plainly when a video is too big or the wrong kind", () => {
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 5_000_000 })).toBeNull();
    // 30 seconds of 4K (Ron, Nov 12): about 300 MB at 60 frames a second fits; 31 seconds passes (a few frames over), 45 does not.
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 300 * 1048576 }, 30)).toBeNull();
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 300 * 1048576 }, 30.9)).toBeNull();
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 50 * 1048576 }, 45)).toContain("45 seconds");
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 400 * 1048576 }, null)).toContain("400 MB");
    expect(read("supabase/apply/apply-step203-0448.sql")).toContain("file_size_limit = 367001600");
    expect(demoFileProblem({ type: "image/jpeg", name: "a.jpg", size: 10 })).toBe("Use an MP4, MOV or WebM video.");
  });
  it("the library opens on a phone, from Spotlight > Program beside All programs, with the big button on top", () => {
    expect(phoneCoachRedirect("/groups/11111111-1111-1111-1111-111111111111/exercise-library")).toBeNull();
    const hub = read("components/coach/mobile/coach-spot-hub.tsx");
    expect(hub).toContain("Exercise library →");
    expect(hub.indexOf("All programs →")).toBeLessThan(hub.indexOf("Exercise library →"));
    const list = read("components/coach/exercise-library-list.tsx");
    expect(list.indexOf("<AddExerciseDemo")).toBeLessThan(list.indexOf('aria-label="Search exercises"'));
    expect(read("components/coach/add-exercise-demo.tsx")).toContain('accept="video/*"');
  });
});
