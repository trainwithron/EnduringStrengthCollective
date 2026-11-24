import { describe, expect, it } from "vitest";
import { parseHeightInput } from "@/lib/units";
import { heightFromParts, heightParts, HEIGHT_FEET, HEIGHT_INCHES } from "@/components/shared/height-picker";

// Ron, Nov 23: an iPhone client typed 5'2 and got "Height looks wrong" (the phone curls ' into ’). Height is now two drop-downs, and the reader takes curly quotes too.
describe("height", () => {
  it("reads curly quotes the way phones type them", () => {
    const straight = parseHeightInput("5'2", "lb");
    expect(straight).not.toBeNull();
    expect(parseHeightInput("5’2", "lb")).toBe(straight);
    expect(parseHeightInput("5’2”", "lb")).toBe(straight);
    expect(parseHeightInput("5′2″", "lb")).toBe(straight);
  });

  it("drop-down parts round-trip through the text the forms save", () => {
    expect(heightFromParts("5", "2")).toBe("5'2");
    expect(heightFromParts("6", "")).toBe("6'0");
    expect(heightFromParts("", "4")).toBe("");
    expect(heightParts("5'2", "lb")).toEqual({ ft: "5", inches: "2" });
    expect(heightParts("", "lb")).toEqual({ ft: "", inches: "" });
    for (const f of HEIGHT_FEET) for (const i of HEIGHT_INCHES) expect(heightParts(heightFromParts(String(f), String(i)), "lb")).toEqual({ ft: String(f), inches: String(i) });
  });

  it("every drop-down choice is a height the forms accept", () => {
    for (const f of HEIGHT_FEET) for (const i of HEIGHT_INCHES) expect(parseHeightInput(heightFromParts(String(f), String(i)), "lb")).not.toBeNull();
  });
});
