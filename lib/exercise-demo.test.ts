import { describe, it, expect } from "vitest";
import { findDemo, youtubeEmbedUrl, type DemoRow } from "./exercise-demo";

const YT = "https://www.youtube.com/watch?v=abcdefghijk";
const library: DemoRow[] = [
  { name: "Bulgarian Split Squat", videoPath: null, youtubeUrl: null },
  { name: "Bulgarian Split Squats", videoPath: null, youtubeUrl: null },
  { name: "Rear Foot Elevated Split Squat", videoPath: null, youtubeUrl: YT },
  { name: "Barbell Rear Foot Elevated Split Squat", videoPath: null, youtubeUrl: "https://youtu.be/zzzzzzzzzzz" },
  { name: "Split Squat", videoPath: null, youtubeUrl: "https://youtu.be/yyyyyyyyyyy" },
  { name: "Walking Lunge", videoPath: null, youtubeUrl: "https://youtu.be/wwwwwwwwwww" },
  { name: "Reverse Lunge", videoPath: null, youtubeUrl: null },
  { name: "Dips", videoPath: null, youtubeUrl: "https://youtu.be/ddddddddddd" },
  { name: "Band Pull-Apart", videoPath: "uploads/band.mp4", youtubeUrl: "https://youtu.be/bbbbbbbbbbb" },
  { name: "Band Pull Apart", videoPath: null, youtubeUrl: "https://youtu.be/ccccccccccc" },
];

describe("finding an exercise's demo by what the exercise is", () => {
  it("uses the exact name when that row has a demo", () => {
    expect(findDemo(library, "Walking Lunge")?.foundAs).toBe("Walking Lunge");
    expect(findDemo(library, "  walking lunge ")?.foundAs).toBe("Walking Lunge");
  });

  it("finds the demo on a duplicate spelling: plural, hyphen, word order", () => {
    expect(findDemo(library, "Walking Lunges")?.foundAs).toBe("Walking Lunge");
    expect(findDemo(library, "Dip")?.foundAs).toBe("Dips");
    expect(findDemo(library, "Pull Apart Band")?.foundAs).toBe("Band Pull-Apart");
  });

  it("Ron's case: a Bulgarian split squat with no video of its own uses the rear foot elevated split squat's", () => {
    expect(findDemo(library, "Bulgarian Split Squat")?.foundAs).toBe("Rear Foot Elevated Split Squat");
    expect(findDemo(library, "Bulgarian Split Squats")?.youtubeUrl).toBe(YT);
    expect(findDemo(library, "Rear Foot Elevated Split Squats")?.foundAs).toBe("Rear Foot Elevated Split Squat");
  });

  it("prefers an upload over a YouTube link among duplicates", () => {
    const d = findDemo(library, "Band Pull-Aparts");
    expect(d?.foundAs).toBe("Band Pull-Apart");
    expect(d?.videoPath).toBe("uploads/band.mp4");
  });

  it("never borrows a demo from a different movement that merely shares a word", () => {
    expect(findDemo(library, "Reverse Lunge")).toBeNull();
    expect(findDemo(library, "Lateral Lunge")).toBeNull();
    expect(findDemo(library, "Split Squat")?.foundAs).toBe("Split Squat");
    expect(findDemo(library, "Rear Foot Elevated Split Squat Machine")).toBeNull();
  });

  it("returns nothing for an empty name, an empty library, or a link that is not a YouTube video", () => {
    expect(findDemo(library, "   ")).toBeNull();
    expect(findDemo([], "Walking Lunge")).toBeNull();
    expect(findDemo([{ name: "Press", videoPath: null, youtubeUrl: "https://example.com/video" }], "Press")).toBeNull();
  });

  it("chooses the same row every time when several qualify", () => {
    const rows: DemoRow[] = [
      { name: "Chin-Up", videoPath: null, youtubeUrl: "https://youtu.be/aaaaaaaaaaa" },
      { name: "Chin Ups", videoPath: null, youtubeUrl: "https://youtu.be/bbbbbbbbbbb" },
    ];
    expect(findDemo(rows, "Chin Up")?.foundAs).toBe("Chin-Up");
    expect(findDemo([...rows].reverse(), "Chin Up")?.foundAs).toBe("Chin-Up");
  });
});

describe("the embed link", () => {
  it("is the no-cookie embed, never autoplaying", () => {
    const u = youtubeEmbedUrl("https://youtu.be/abcdefghijk")!;
    expect(u).toContain("youtube-nocookie.com/embed/abcdefghijk");
    expect(u).not.toContain("autoplay");
  });
  it("is null for something that is not a YouTube link", () => {
    expect(youtubeEmbedUrl("https://example.com/x")).toBeNull();
  });
});
