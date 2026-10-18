import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the Garmin Connect button", () => {
  it("is hidden in Settings for anyone who has not connected, and stays for someone already connected so they can disconnect", () => {
    const panel = src("components/athlete/wearable-placeholder.tsx");
    expect(panel).toContain("{garminConnected && (");
    expect(panel.indexOf("{garminConnected && (")).toBeLessThan(panel.indexOf("<GarminConnection"));
    // the other three connections are unchanged
    for (const other of ["<OuraConnection", "<WithingsConnection", "<GoogleHealthConnection"]) expect(panel).toContain(other);
  });

  it("the routes and the webhook are left alone", () => {
    expect(src("app/api/garmin/webhook/route.ts")).toContain("export async function POST");
  });
});
