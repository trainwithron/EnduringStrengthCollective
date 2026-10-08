import { describe, expect, it, vi } from "vitest";
import { savePlanThenLibrary } from "@/lib/plan-save-flow";

describe("savePlanThenLibrary", () => {
  it("saves the plan, then the library, and returns the library line", async () => {
    const lib = vi.fn(async () => "Saved 2 new meals to your library.");
    const r = await savePlanThenLibrary(async () => ({ error: null }), lib);
    expect(r).toEqual({ ok: true, libraryMessage: "Saved 2 new meals to your library.", error: null });
    expect(lib).toHaveBeenCalledTimes(1);
  });
  it("when the plan save returns an error the library save is NOT called and the error is shown", async () => {
    const lib = vi.fn(async () => "Saved 2 new meals to your library.");
    const r = await savePlanThenLibrary(async () => ({ error: { message: "row-level security" } }), lib);
    expect(lib).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.libraryMessage).toBeNull();
    expect(r.error).toContain("Nothing was added to your library");
  });
  it("when the plan save throws, likewise", async () => {
    const lib = vi.fn(async () => "x");
    const r = await savePlanThenLibrary(async () => { throw new Error("offline"); }, lib);
    expect(lib).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, libraryMessage: null });
  });
  it("a plan that saved but had nothing for the library is just ok", async () => {
    expect(await savePlanThenLibrary(async () => ({ error: null }), async () => null)).toEqual({ ok: true, libraryMessage: null, error: null });
  });
});
