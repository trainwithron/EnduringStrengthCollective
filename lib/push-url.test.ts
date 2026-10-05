import { describe, expect, it } from "vitest";
import { safePushPath } from "./push-url";

describe("safePushPath", () => {
  it("keeps in-app paths", () => {
    expect(safePushPath("/groups/abc/calendar")).toBe("/groups/abc/calendar");
    expect(safePushPath("/sessions/1?x=2")).toBe("/sessions/1?x=2");
  });
  it("turns anything else into the home path", () => {
    expect(safePushPath("https://evil.example/login")).toBe("/");
    expect(safePushPath("//evil.example")).toBe("/");
    expect(safePushPath("/\\evil.example")).toBe("/");
    expect(safePushPath("javascript:alert(1)")).toBe("/");
    expect(safePushPath("groups/abc")).toBe("/");
    expect(safePushPath(undefined)).toBe("/");
    expect(safePushPath("/ok\nbad")).toBe("/");
  });
});
