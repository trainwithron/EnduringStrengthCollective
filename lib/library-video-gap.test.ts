import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// The exercise library tells a coach how many exercises have a demo video, and (Release VG1) lets them show only the ones that do not, so the gap can be closed one exercise at a time.
describe("the exercise library's video gap", () => {
  const list = src("components/coach/exercise-library-list.tsx");

  it("has a one-tap filter for exercises without a video, that only shows while there is a gap", () => {
    expect(list).toContain("const [onlyWithoutVideo, setOnlyWithoutVideo] = useState(false);");
    expect(list).toContain(".filter((e) => !onlyWithoutVideo || !(e.videoPath || e.youtubeUrl))");
    expect(list).toContain("Show only those without a video");
    expect(list).toContain("exercises.length - withVideoCount > 0 && (");
    expect(list).toContain("aria-pressed={onlyWithoutVideo}");
  });

  it("says so when every exercise already has a video, and never offers an empty filter", () => {
    expect(list).toContain("Every exercise has a video.");
  });

  it("an exercise counts as covered when it has an uploaded video or a YouTube link", () => {
    expect(list).toContain("const withVideoCount = exercises.filter((e) => e.videoPath || e.youtubeUrl).length;");
  });
});
