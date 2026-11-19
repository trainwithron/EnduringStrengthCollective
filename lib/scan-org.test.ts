import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseScanPath, loadScanOrg, pickScanOrgId } from "./scan-org";

// Nov 19 (review, confirmed live): Ron owns three organizations, so "the coach's organization" as exactly one row failed, and every scan page said "this gym" with no logo.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron's three, as they are live (oldest first: Enduring Strength Co. on Sept 8).
const RON = [
  { organization_id: "trojans", created_at: "2026-09-14T02:25:30Z", departing_since: null },
  { organization_id: "enduring", created_at: "2026-09-08T00:35:11Z", departing_since: null },
  { organization_id: "coast2coast", created_at: "2026-09-16T17:41:47Z", departing_since: null },
];

describe("which gym a scan page shows", () => {
  it("the code's own organization, while the coach is in it", () => {
    expect(pickScanOrgId(RON, "trojans")).toBe("trojans");
  });
  it("an old code without one (or one the coach is not in) shows the coach's oldest organization, always the same", () => {
    expect(pickScanOrgId(RON, null)).toBe("enduring");
    expect(pickScanOrgId(RON, "someone-elses")).toBe("enduring");
    expect(pickScanOrgId([...RON].reverse(), undefined)).toBe("enduring");
  });
  it("an organization the coach is leaving is not used; a coach in none shows none", () => {
    const leaving = RON.map((m) => (m.organization_id === "enduring" ? { ...m, departing_since: "2026-11-01T00:00:00Z" } : m));
    expect(pickScanOrgId(leaving, "enduring")).toBe("trojans");
    expect(pickScanOrgId(leaving, null)).toBe("trojans");
    expect(pickScanOrgId([], "x")).toBeNull();
  });
  it("reads every membership (never exactly one) and the chosen organization's name and logo", async () => {
    const calls: string[] = [];
    const db = {
      from: (table: string) => {
        calls.push(table);
        const q: any = {
          select: () => q,
          eq: () => q,
          then: (resolve: (v: unknown) => void) => resolve({ data: RON, error: null }),
          maybeSingle: async () => ({ data: { id: "enduring", display_name: null, name: "Enduring Strength Co.", logo_url: "https://x/logo.png" }, error: null }),
        };
        return q;
      },
    } as never;
    expect(await loadScanOrg(db, "ron", null)).toEqual({ id: "enduring", name: "Enduring Strength Co.", logoUrl: "https://x/logo.png" });
    expect(calls).toEqual(["organization_memberships", "organizations"]);
    expect(read("lib/scan-org.ts")).not.toMatch(/organization_memberships"\)[^;]*maybeSingle/);
  });
});

describe("the codes and pages use it", () => {
  it("a printed exercise code carries the workspace's organization; without one it is the plain address", () => {
    expect(exerciseScanPath("ex1", "org1")).toBe("/scan/ex1?org=org1");
    expect(exerciseScanPath("ex1", null)).toBe("/scan/ex1");
    expect(read("components/coach/exercise-qr-code-button.tsx")).toContain('return <ScanQrCodeButton path={exerciseScanPath(exerciseId, orgId)} name={exerciseName} what="exercise" />;');
    expect(read("components/coach/exercise-library-list.tsx")).toContain("<ExerciseQrCodeButton exerciseId={ex.id} exerciseName={ex.name} orgId={orgId} />");
    const page = read("app/(coach)/groups/[groupId]/exercise-library/page.tsx");
    expect(page).toContain('.select("name, organization_id")');
    expect(page).toContain("orgId={(group as { organization_id?: string | null } | null)?.organization_id ?? null}");
  });
  it("the exercise scan page and the machine scan page both find the gym this way (no single-membership lookup left)", () => {
    const ex = read("app/scan/[exerciseId]/page.tsx");
    expect(ex).toContain("const org = await loadScanOrg(serviceRole, exercise.created_by, requestedOrg ?? null);");
    expect(ex).toContain("organizationId={org.id}");
    expect(ex).not.toContain('.from("organization_memberships")');
    const machine = read("app/scan/machine/[machineId]/page.tsx");
    expect(machine).toContain("const org = await loadScanOrg(serviceRole, machine.created_by, machine.organization_id);");
    expect(machine).not.toContain('.from("organization_memberships")');
  });
});
