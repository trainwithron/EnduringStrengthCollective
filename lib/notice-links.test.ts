import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { noticeHref } from "@/lib/notice-links";

describe("a booking request's push opens the requests to confirm (Ron, Nov 5)", () => {
  it("the notice links to the late-changes panel", () => {
    expect(noticeHref("booking_request", "/dashboard")).toBe("/dashboard#late-changes");
  });
  it("the service worker keeps the # part when the notification is tapped", () => {
    expect(readFileSync("public/sw.js", "utf8")).toContain("return parsed.pathname + parsed.search + parsed.hash;");
  });
});
