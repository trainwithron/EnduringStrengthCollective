import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";

describe("isAllowedPushEndpoint", () => {
  it("accepts the real push services over https", () => {
    for (const e of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/abc",
    ]) expect(isAllowedPushEndpoint(e)).toBe(true);
  });
  it("refuses other hosts, plain http, look-alikes and junk", () => {
    for (const e of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/latest", "not a url", "", undefined, 5]) {
      expect(isAllowedPushEndpoint(e as unknown)).toBe(false);
    }
  });
});
