import { describe, expect, it } from "vitest";
import { aiLoggingEntitlement } from "@/lib/ai-entitlement";

describe("aiLoggingEntitlement (design hook for a per-client add-on)", () => {
  it("allows AI logging while the coach's budget has room", () => {
    for (const budgetLevel of ["ok", "low", "unlimited"] as const) {
      expect(aiLoggingEntitlement({ trackingEnabled: true, budgetLevel })).toEqual({ allowed: true, reason: "ok" });
    }
  });
  it("pauses it when the coach's budget is used up", () => {
    expect(aiLoggingEntitlement({ trackingEnabled: true, budgetLevel: "out" })).toEqual({ allowed: false, reason: "budget_out" });
  });
  it("a client with the (future) add-on keeps AI logging after the coach's budget is used up", () => {
    expect(aiLoggingEntitlement({ trackingEnabled: true, budgetLevel: "out", clientAddOn: true })).toEqual({ allowed: true, reason: "add_on" });
  });
  it("nothing is allowed when the coach turned food tracking off, add-on or not", () => {
    expect(aiLoggingEntitlement({ trackingEnabled: false, budgetLevel: "ok", clientAddOn: true })).toEqual({ allowed: false, reason: "tracking_off" });
  });
  it("is not connected to anything that charges: no module imports it yet", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", ".git"].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !full.endsWith("ai-entitlement.ts") && readFileSync(full, "utf8").includes("ai-entitlement")) hits.push(full);
      }
    };
    for (const top of ["app", "lib", "components"]) walk(join(process.cwd(), top));
    expect(hits).toEqual([]);
  });
});
