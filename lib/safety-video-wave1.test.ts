import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoFileProblem, FORM_CHECK_LIMITS } from "./exercise-demo-upload";
import { REPORT_REASONS, reportReasonLabel } from "./video-reports";

// Ron's Nov 20 approvals S3, S4, S5, V1, V2 (R6 is in lib/coach-congrats.test.ts).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("V1/V2: a client's form-check video", () => {
  const src = read("components/logging/exercise-video-upload.tsx");
  it("offers the camera as well as the gallery (any video type, no exact list, no capture)", () => {
    expect(src).toContain('accept="video/*"');
    expect(src).not.toContain('accept="video/mp4,video/quicktime,video/webm"');
    expect(src).not.toMatch(/\bcapture=/);
  });
  it("uses the demo uploader: made 1080p, resumable with progress, into the client video bucket, a minute at most", () => {
    expect(src).toContain("prepareDemo(picked, { mute: false, onProgress: setProgress, limits: FORM_CHECK_LIMITS })");
    expect(src).toContain('bucket: "athlete-exercise-videos"');
    expect(FORM_CHECK_LIMITS.maxSeconds).toBe(60);
    expect(FORM_CHECK_LIMITS.maxBytes).toBe(100 * 1024 * 1024);
  });
  it("says a too-long form check plainly, and the demo wording is unchanged", () => {
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 1 }, 75, FORM_CHECK_LIMITS)).toContain("Form-check videos can be up to 60 seconds");
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 101 * 1048576 }, 30, FORM_CHECK_LIMITS)).toContain("the limit is 100 MB. Trim");
    expect(demoFileProblem({ type: "video/mp4", name: "a.mp4", size: 400 * 1048576 }, null)).toContain("the limit is 350 MB (30 seconds of 4K)");
  });
  it("shows the filming tip and who can see it", () => {
    expect(src).toContain("Film from the side with your whole body in the frame.");
    expect(src).toContain("Only you and your coach can see this.");
  });
});

describe("S3: a video of a minor", () => {
  it("the paste guards the person in the video on form checks and check-ins, and keeps the own-upload rule", () => {
    const paste = read("supabase/apply/apply-step211-0455.sql");
    expect(paste).toMatch(/create policy minor_subject_guard_insert on public\.session_exercise_videos as restrictive/);
    expect(paste).toMatch(/create policy minor_subject_guard_insert on public\.coach_video_checkins as restrictive/);
    expect(paste).toContain("own_upload_rule_kept");
    // an unknown age is never taken for an adult (Assistant review, Nov 20): no date of birth falls through to the parent's-OK check
    expect(paste).not.toMatch(/if v_youngest is null then\s+return true;/);
    expect(paste).toContain("-- 13 to 17, or no date of birth on file: only with a parent's OK on file");
  });
  it("a refused save says why and takes the video back out of storage", () => {
    const rec = read("components/coach/video-checkin-recorder.tsx");
    expect(rec).toContain('insertError?.code === "42501"');
    expect(rec).toContain('storage.from("coach-video-checkins").remove([path])');
    expect(read("components/logging/exercise-video-upload.tsx")).toContain('storage.from("athlete-exercise-videos").remove([up.path])');
  });
});

describe("S4: shared machine demos", () => {
  const form = read("components/coach/machine-catalog-section.tsx");
  it("a filmed video needs the on-camera consent tick and sends it; a YouTube link has its own wording", () => {
    expect(form).toContain("Everyone shown agreed to be filmed and shared; anyone under 18 has a parent's OK");
    expect(form).toContain("subject_consent: true");
    expect(form).toContain("This is my video, or I have the right to share it");
    expect(form).toContain("async function sendLink() {\n    if (!needLinkRights()) return;".split("\n").join(form.includes("\r\n") ? "\r\n" : "\n"));
  });
  it("the report route is public, rate limited by address, and only the server writes reports", () => {
    const route = read("app/api/public/report-video/route.ts");
    expect(route).toContain('rateLimitResponse("scan-report-video", clientIp(request), 5, 3600)');
    expect(route).toContain('from("video_reports").insert(');
  });
  it("the admin's remove and dismiss check the admin under their own sign-in before the server key", () => {
    const route = read("app/api/admin/video-reports/route.ts");
    expect(route.indexOf("is_platform_admin")).toBeGreaterThan(-1);
    expect(route.indexOf("is_platform_admin")).toBeLessThan(route.indexOf("createServiceRoleClient()"));
  });
  it("every reason has words", () => {
    for (const r of REPORT_REASONS.filter((x) => x !== "other")) expect(reportReasonLabel(r)).not.toBe("Something else");
  });
});

describe("S5: InBody and photos", () => {
  it("the InBody screen says an outside AI reads the photo", () => {
    expect(read("components/body/inbody-scan-flow.tsx")).toContain("The photo is read by an outside AI service");
  });
  it("Download my data includes the photo and video files as links", () => {
    expect(read("app/api/account/export/route.ts")).toContain("files: ownFiles.files");
    const lib = read("lib/export-files.ts");
    for (const b of ["progress-photos", "inbody-scans", "athlete-exercise-videos"]) expect(lib).toContain(b);
  });
});
