import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { noticeHref } from "@/lib/notice-links";

describe("a booking request's push opens the requests to confirm (Ron, Nov 5)", () => {
  // Nov 19: it opens the Requests page at that request (lib/notice-every-type.test.ts)
  it("the notice opens the Requests page at its request", () => {
    expect(noticeHref("booking_request", "/dashboard")).toBe("/requests");
    expect(noticeHref("booking_request", "/dashboard", { id: "n1" })).toBe("/requests?notice=n1");
  });
  it("the service worker keeps the # part when the notification is tapped", () => {
    expect(readFileSync("public/sw.js", "utf8")).toContain("return parsed.pathname + parsed.search + parsed.hash;");
  });
});
