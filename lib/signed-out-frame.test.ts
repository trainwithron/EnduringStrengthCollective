import { describe, it, expect } from "vitest";
import { SIGNED_OUT_FRAME_HTML } from "./signed-out-frame";
import { SIGNED_OUT_MESSAGE } from "./workspace-mutation";

describe("the page a pane shows when the session ended", () => {
  it("tells only the same site's window, with the message the workspace listens for", () => {
    expect(SIGNED_OUT_FRAME_HTML).toContain(SIGNED_OUT_MESSAGE);
    expect(SIGNED_OUT_FRAME_HTML).toContain("location.origin");
    expect(SIGNED_OUT_FRAME_HTML).not.toContain('"*"');
  });
  it("loads nothing from outside", () => {
    expect(SIGNED_OUT_FRAME_HTML).not.toMatch(/src=|href=|https?:\/\//);
  });
});
