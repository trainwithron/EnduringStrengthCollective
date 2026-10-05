import { describe, it, expect } from "vitest";
import { detectPlatform, computeGuideSteps, isGuideComplete } from "./first-run-guide";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36";

describe("detectPlatform", () => {
  it("tells iPhone Safari from other iPhone browsers", () => {
    expect(detectPlatform(IPHONE_SAFARI)).toBe("ios-safari");
    expect(detectPlatform(IPHONE_CHROME)).toBe("ios-other");
  });
  it("recognises Android and desktop", () => {
    expect(detectPlatform(ANDROID_CHROME)).toBe("android");
    expect(detectPlatform(DESKTOP)).toBe("desktop");
  });
});

describe("computeGuideSteps", () => {
  it("iPhone in Safari: install first, notifications blocked until installed", () => {
    const s = computeGuideSteps({ platform: "ios-safari", standalone: false, push: "off" });
    expect(s[0]).toMatchObject({ key: "install", status: "todo" });
    expect(s[1]).toMatchObject({ key: "notifications", status: "blocked", reason: "needs-install" });
    expect(isGuideComplete(s)).toBe(false);
  });

  it("iPhone installed: notifications become available", () => {
    const s = computeGuideSteps({ platform: "ios-safari", standalone: true, push: "off" });
    expect(s[0].status).toBe("done");
    expect(s[1].status).toBe("todo");
  });

  it("Android in Chrome can do notifications without installing first", () => {
    const s = computeGuideSteps({ platform: "android", standalone: false, push: "off" });
    expect(s[0].status).toBe("todo");
    expect(s[1].status).toBe("todo");
  });

  it("desktop has no install step", () => {
    const s = computeGuideSteps({ platform: "desktop", standalone: false, push: "off" });
    expect(s[0].status).toBe("hidden");
    expect(s[1].status).toBe("todo");
  });

  it("denied permission is a blocked step with its own reason", () => {
    const s = computeGuideSteps({ platform: "android", standalone: true, push: "denied" });
    expect(s[1]).toMatchObject({ status: "blocked", reason: "denied" });
    expect(isGuideComplete(s)).toBe(false);
  });

  it("everything done completes the card", () => {
    const s = computeGuideSteps({ platform: "ios-safari", standalone: true, push: "on" });
    expect(isGuideComplete(s)).toBe(true);
  });

  it("a browser that can never do push does not hold the card open once installed", () => {
    const s = computeGuideSteps({ platform: "android", standalone: true, push: "unsupported" });
    expect(isGuideComplete(s)).toBe(true);
  });
});
