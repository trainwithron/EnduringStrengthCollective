import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanMachineName, machineScanPath, machinesFromRows, nextPosition, scanRows } from "./gym-machines";

// Ron, Nov 19: "on a machine I could put a QR code and it'll show you all of the exercise variations for that machine"; "i need to obiously be able to add excercises by machine in the
// excercise library also". (The database rules themselves run in scripts/sql-tests/gym-machines.test.mjs.)
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("machines: the pure parts", () => {
  it("a machine's name is tidied and 1 to 80 characters, as the database checks", () => {
    expect(cleanMachineName("  Viking   press ")).toEqual({ ok: true, name: "Viking press" });
    expect(cleanMachineName("   ")).toEqual({ ok: false, error: "Give the machine a name." });
    expect(cleanMachineName("x".repeat(81))).toEqual({ ok: false, error: "Keep the name to 80 characters." });
    expect(cleanMachineName("x".repeat(80)).ok).toBe(true);
  });
  it("its QR code opens /scan/machine/<id>, which the public allowlist already lets in", () => {
    expect(machineScanPath("m1")).toBe("/scan/machine/m1");
    expect(read("lib/supabase/middleware.ts")).toContain('pathname.startsWith("/scan/") ||');
  });
  it("the exercises keep their order; a new one goes after every saved one, even after a removal; an exercise gone from the library is left out", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([0, 2])).toBe(3);
    const [m] = machinesFromRows(
      [{ id: "m1", name: "Viking press" }],
      [
        { machine_id: "m1", exercise_id: "shrug", position: 3 },
        { machine_id: "m1", exercise_id: "viking", position: 0 },
        { machine_id: "m1", exercise_id: "gone", position: 5 },
        { machine_id: "m2", exercise_id: "other", position: 1 },
      ],
      new Set(["viking", "shrug", "other"]),
    );
    expect(m).toEqual({ id: "m1", name: "Viking press", exerciseIds: ["viking", "shrug"], nextPos: 6 });
  });
  it("the public list is in the machine's order, only exercises that still exist", () => {
    const rows = scanRows(
      [
        { exercise_id: "b", position: 1 },
        { exercise_id: "a", position: 0 },
        { exercise_id: "x", position: 2 },
      ],
      [{ id: "a", name: "Viking Press" }, { id: "b", name: "Z Press" }],
    );
    expect(rows.map((r) => r.name)).toEqual(["Viking Press", "Z Press"]);
  });
});

describe("machines: the database step (206, migration 0451)", () => {
  const migration = read("supabase/migrations/0451_gym_machines.sql").trim();
  it("the paste file is the migration, byte for byte, in one transaction, then a check of one row", () => {
    const paste = read("supabase/apply/apply-step206-0451.sql");
    expect(paste.startsWith("-- PASTE: step 206 ")).toBe(true);
    expect(paste).toContain(`begin;\n\n${migration}\n\ncommit;`);
    expect(paste).toContain("-- Check: one row, all true.");
    expect(read("supabase/apply/undo-step206-0451.sql")).toContain("drop table if exists public.gym_machine_exercises;\ndrop table if exists public.gym_machines;");
  });
  it("only the owning coach, only their own exercises, nobody signed out", () => {
    expect(migration).toContain("revoke all on public.gym_machines from anon, authenticated;");
    expect(migration).toContain("revoke all on public.gym_machine_exercises from anon, authenticated;");
    expect(migration).toContain("using (created_by = (select auth.uid()))");
    expect(migration).toContain("exists (select 1 from public.exercise_library e where e.id = exercise_id and e.created_by = (select auth.uid()))");
    expect(migration).toContain("name text not null check (char_length(name) between 1 and 80)");
    expect(migration).toContain("primary key (machine_id, exercise_id)");
  });
});

describe("machines: the screens", () => {
  it("the library's Machines tab shows only once the database has machines (before step 206 the read fails and it is hidden)", () => {
    const tabs = read("components/coach/exercise-library-tabs.tsx");
    expect(tabs).toContain("{initialMachines && (");
    expect(tabs).toContain('{tab === "machines" && initialMachines && <GymMachinesPanel coachId={coachId} orgId={orgId} initialMachines={initialMachines} exercises={initialExercises} />}');
    const page = read("app/(coach)/groups/[groupId]/exercise-library/page.tsx");
    expect(page).toContain('.from("gym_machines").select("id, name").eq("created_by", user.id)');
    expect(page).toContain("initialMachines={initialMachines}");
  });
  it("a machine's exercises are picked with the library's one search-or-add piece (shared with Add exercise demo, not a copy), and its QR code is the exercise QR button pointed at the machine", () => {
    const panel = read("components/coach/gym-machines-panel.tsx");
    expect(panel).toContain("<ExercisePickOrAdd");
    expect(panel).toContain('<ScanQrCodeButton path={machineScanPath(machine.id)} name={machine.name} what="machine" label="QR code" />');
    expect(panel).toContain("confirmDialog({ message: `Delete ${machine.name}?");
    const demo = read("components/coach/add-exercise-demo.tsx");
    expect(demo).toContain("<ExercisePickOrAdd coachId={coachId} exercises={exercises} onPick={setChosen} onExerciseAdded={onExerciseAdded} demoFirst />");
    expect(demo).not.toContain("addLibraryExercise(");
    expect(read("components/coach/exercise-pick-or-add.tsx")).toContain("await addLibraryExercise(supabase, {");
    const qr = read("components/coach/exercise-qr-code-button.tsx");
    expect(qr).toContain('return <ScanQrCodeButton path={exerciseScanPath(exerciseId, orgId)} name={exerciseName} what="exercise" />;');
    expect(qr).toContain("const url = `${appOriginBrowser()}${path}`;");
  });
  it("the machine's main buttons are at least 44px (phone)", () => {
    const panel = read("components/coach/gym-machines-panel.tsx");
    for (const m of panel.matchAll(/<button[^>]*className="([^"]*)"/g)) expect(m[1]).toMatch(/min-h-1[12]|w-11 h-11/);
  });
  it("the public page: each exercise is a big row opening its own scan page; an unknown machine says the code is not valid", () => {
    const page = read("app/scan/machine/[machineId]/page.tsx");
    expect(page).toContain('<Link href={`/scan/${r.id}`} className="flex items-center gap-3 min-h-16');
    expect(page).toContain('if (!machine) return <Message text="This QR code isn\'t valid anymore." />;');
    expect(page).toContain("No exercises on this machine yet.");
    expect(page).toContain("createServiceRoleClient()");
  });
});

describe("machines: the gym and honest saves (review, Nov 19)", () => {
  it("a machine records the organization it was made in, only one the coach belongs to", () => {
    const migration = read("supabase/migrations/0451_gym_machines.sql");
    expect(migration).toContain("organization_id uuid references public.organizations(id) on delete set null,");
    expect(migration).toContain("with check (created_by = (select auth.uid()) and (organization_id is null or public.is_org_member(organization_id)));");
    expect(read("supabase/apply/apply-step206-0451.sql")).toContain("as machine_has_its_gym,");
    const panel = read("components/coach/gym-machines-panel.tsx");
    expect(panel).toContain('.from("gym_machines").insert({ created_by: coachId, organization_id: orgId, name: cleaned.name })');
    expect(read("components/coach/exercise-library-tabs.tsx")).toContain("<GymMachinesPanel coachId={coachId} orgId={orgId} initialMachines={initialMachines} exercises={initialExercises} />");
  });
  it("rename, delete and taking an exercise off only say done when the row really changed (0 rows is a failure)", () => {
    const panel = read("components/coach/gym-machines-panel.tsx");
    expect(panel).toContain('savedRows(createBrowserClient().from("gym_machines").update({ name: cleaned.name }).eq("id", machine.id).select("id"),');
    expect(panel).toContain('savedRows(createBrowserClient().from("gym_machines").delete().eq("id", machine.id).select("id"),');
    expect(panel).toContain('.eq("exercise_id", row.id).select("machine_id"),');
    expect(panel).toContain("const result = await checked(operation, { expectRows: true, message });");
  });
});
