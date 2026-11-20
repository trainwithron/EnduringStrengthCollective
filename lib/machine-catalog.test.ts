import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogDemo,
  catalogFromRows,
  catalogYoutubeLink,
  cleanMachineRequest,
  planAddToGym,
  requestFromRow,
  requestStatusLabel,
  requestSummary,
  searchCatalog,
  type CatalogItem,
} from "./machine-catalog";
import { scanDemo } from "./machine-catalog-scan";
import { scanRows } from "./gym-machines";

// The shared machine list with Ron's approval (Ron, Nov 19; migration 0453, step 208). The database rules themselves are rehearsed in scripts/sql-tests/machine-catalog.test.mjs.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({ id: "i1", catalogExerciseId: "c1", name: "Viking Press", category: "Push", position: 0, videoPath: null, youtubeUrl: null, ...over });

const catalog = catalogFromRows([
  {
    id: "m2",
    brand: "Hammer Strength",
    model: "Plate-Loaded Row",
    catalog_machine_exercises: [{ id: "r1", catalog_exercise_id: "row", position: 0, video_path: null, youtube_url: null, exercise_catalog: { name: "Machine Row", category: "Pull" } }],
  },
  {
    id: "m1",
    brand: "Bolt",
    model: "Viking Press",
    catalog_machine_exercises: [
      { id: "b", catalog_exercise_id: "shrug", position: 1, video_path: null, youtube_url: null, exercise_catalog: [{ name: "Viking Shrug", category: null }] },
      { id: "a", catalog_exercise_id: "vp", position: 0, video_path: "u/a.mp4", youtube_url: null, exercise_catalog: { name: "Viking Press", category: "Push" } },
    ],
  },
]);

describe("the shared machine list", () => {
  it("machines by brand then model, each machine's exercises in their saved order", () => {
    expect(catalog.map((m) => m.brand)).toEqual(["Bolt", "Hammer Strength"]);
    expect(catalog[0].items.map((i) => i.name)).toEqual(["Viking Press", "Viking Shrug"]);
    expect(catalog[0].items[1].category).toBeNull();
  });

  it('search: "viking press" and "hammer strength" both find their machine, any case, any order, dashes or not', () => {
    expect(searchCatalog(catalog, "viking press").map((m) => m.id)).toEqual(["m1"]);
    expect(searchCatalog(catalog, "Hammer Strength").map((m) => m.id)).toEqual(["m2"]);
    expect(searchCatalog(catalog, "press bolt").map((m) => m.id)).toEqual(["m1"]);
    expect(searchCatalog(catalog, "plate loaded").map((m) => m.id)).toEqual(["m2"]);
    expect(searchCatalog(catalog, "squat")).toEqual([]);
    expect(searchCatalog(catalog, "   ")).toEqual([]);
  });

  it("the filmed video is shown over a YouTube link; a link alone is shown; nothing is nothing", () => {
    expect(catalogDemo(item({ videoPath: "u/a.mp4", youtubeUrl: "https://youtu.be/abcdefghijk" }))).toEqual({ kind: "video", path: "u/a.mp4" });
    expect(catalogDemo(item({ youtubeUrl: " https://youtu.be/abcdefghijk " }))).toEqual({ kind: "youtube", url: "https://youtu.be/abcdefghijk" });
    expect(catalogDemo(item())).toBeNull();
    expect(catalogDemo(null)).toBeNull();
  });

  it("the QR pages: a machine from the list shows the list's demo (read live), else the coach's own", () => {
    const own = { video_path: "coach/own.mp4", youtube_url: null };
    expect(scanDemo({ videoPath: "c/shared.mp4", youtubeUrl: null }, own)).toEqual({ kind: "video", bucket: "machine-demos", path: "c/shared.mp4" });
    expect(scanDemo({ videoPath: null, youtubeUrl: "https://youtu.be/abcdefghijk" }, own)).toEqual({ kind: "youtube", url: "https://youtu.be/abcdefghijk" });
    expect(scanDemo({ videoPath: null, youtubeUrl: null }, own)).toEqual({ kind: "video", bucket: "exercise-media", path: "coach/own.mp4" });
    expect(scanDemo(undefined, { video_path: null, youtube_url: "https://youtu.be/abcdefghijk" })).toEqual({ kind: "youtube", url: "https://youtu.be/abcdefghijk" });
    expect(scanDemo(undefined, { video_path: null, youtube_url: null })).toBeNull();
    const rows = scanRows([{ exercise_id: "x", position: 0, catalog_item_id: "a" }, { exercise_id: "y", position: 1 }], [{ id: "x" }, { id: "y" }]);
    expect(rows).toEqual([{ id: "x", catalogItemId: "a" }, { id: "y", catalogItemId: null }]);
  });
});

describe("Add to my gym", () => {
  it("each exercise uses the coach's row with that catalog exercise, else one with the same name, else a new one", () => {
    const plan = planAddToGym(
      [item({ id: "a", catalogExerciseId: "vp", name: "Viking Press" }), item({ id: "b", catalogExerciseId: "shrug", name: "Viking Shrug" }), item({ id: "c", catalogExerciseId: "z", name: "Z Press" })],
      [
        { id: "mine-vp", name: "Landmine press", catalogId: "vp" },
        { id: "mine-shrug", name: "viking shrug ", catalogId: null },
      ],
    );
    expect(plan.map((p) => [p.item.id, p.reuseId])).toEqual([
      ["a", "mine-vp"],
      ["b", "mine-shrug"],
      ["c", null],
    ]);
  });

  it("the machine is linked to the shared one (not a copy) and the coach's library gets what it lacks", () => {
    const s = read("components/coach/machine-catalog-section.tsx");
    expect(s).toContain("catalog_machine_id: machine.id");
    expect(s).toContain("catalog_item_id: p.item.id");
    expect(s).toContain("created_by: coachId, name: p.item.name, catalog_id: p.item.catalogExerciseId, category: p.item.category");
    // a half-made machine is removed again
    expect(s).toContain('await bestEffort(supabase.from("gym_machines").delete().eq("id", gymRow.id));');
    // the editor shows the list's demos for a linked machine
    expect(read("components/coach/gym-machines-panel.tsx")).toContain("const sharedDemo = (row: LibraryExerciseRow) => catalogDemo(catalogItems.get(machine.catalogItemByExercise?.[row.id] ?? \"\"));");
  });
});

describe("sending a request", () => {
  it("a new machine needs a brand, a model and 1 to 30 exercises; names are tidied and repeats dropped", () => {
    expect(cleanMachineRequest({ brand: "", model: "Viking Press", exercises: [{ name: "x", catalogId: null }] })).toEqual({ ok: false, error: "Enter the brand, for example Bolt or Hammer Strength." });
    expect(cleanMachineRequest({ brand: "Bolt", model: " ", exercises: [{ name: "x", catalogId: null }] }).ok).toBe(false);
    expect(cleanMachineRequest({ brand: "Bolt", model: "Viking Press", exercises: [] })).toEqual({ ok: false, error: "Add at least one exercise done on this machine." });
    expect(cleanMachineRequest({ brand: "Bolt", model: "VP", exercises: Array.from({ length: 31 }, (_, i) => ({ name: `E${i}`, catalogId: null })) }).ok).toBe(false);
    expect(cleanMachineRequest({ brand: " Bolt ", model: "Viking  Press", exercises: [{ name: "Viking  Press", catalogId: "vp" }, { name: "viking press", catalogId: null }, { name: "Shrug", catalogId: null }] })).toEqual({
      ok: true,
      brand: "Bolt",
      model: "Viking Press",
      exercises: [{ name: "Viking Press", catalogId: "vp" }, { name: "Shrug", catalogId: null }],
    });
  });

  it("a YouTube link is sent as the plain watch link; anything else is refused", () => {
    expect(catalogYoutubeLink("https://youtu.be/abcdefghijk?t=3")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(catalogYoutubeLink(" https://www.youtube.com/watch?v=abcdefghijk&x=1 ")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(catalogYoutubeLink("https://vimeo.com/123")).toBeNull();
  });

  it("a demo needs the tick: the coach's own filming only; the video goes to the private machine-demos bucket in the coach's own folder", () => {
    const s = read("components/coach/machine-catalog-section.tsx");
    expect(s).toContain('const RIGHTS_LABEL = "I filmed this video and have the right to share it";');
    expect(s).toContain("if (!picked || !needRights()) return;");
    // a YouTube link has its own tick (Nov 20, S4): "This is my video, or I have the right to share it"
    expect(s).toContain("if (!needLinkRights()) return;\n    const url = catalogYoutubeLink(link);");
    expect(s).toContain("path: `${coachId}/${crypto.randomUUID()}.${demoExtension(contentType)}`,");
    expect(s).toContain("bucket: MACHINE_DEMOS_BUCKET,");
    expect(read("lib/exercise-demo-upload.ts")).toContain("metadata: { bucketName: bucket, objectName: path, contentType, cacheControl: \"3600\" },");
  });

  it("Ron's own requests go on the list at once through the same server-checked review; he can use one of his existing demos (copied inside storage, not uploaded again)", () => {
    const s = read("components/coach/machine-catalog-section.tsx");
    expect(s).toContain('if (!isAdmin) return { ok: true };\n  const { error: reviewError } = await supabase.rpc("review_catalog_request", {');
    expect(s).toContain('.storage.from("exercise-media").copy(row.videoPath, to, { destinationBucket: MACHINE_DEMOS_BUCKET });');
    expect(s).toContain("const myDemos = isAdmin ? library.filter(");
  });

  it("the coach sees what came of each request, with Ron's note", () => {
    const r = requestFromRow({ id: "q", kind: "machine", brand: "Bolt", model: "Viking Press", exercises: [{ name: "Viking Press", catalogId: null }, { name: 3 }], item_id: null, video_path: null, youtube_url: null, status: "denied", review_note: "Too dark", created_at: "2026-11-19" });
    expect(r.exercises).toEqual([{ name: "Viking Press", catalogId: null }, { name: "", catalogId: null }]);
    expect(requestSummary(r, () => null)).toBe("Bolt Viking Press (2 exercises)");
    expect(requestStatusLabel("pending")).toBe("Waiting for review");
    expect(requestStatusLabel("approved")).toBe("Approved");
    expect(requestStatusLabel("denied")).toBe("Not approved");
    const demo = requestFromRow({ ...{ id: "d", kind: "demo", brand: null, model: null, exercises: null, item_id: "a", video_path: "u/a.mp4", youtube_url: null, status: "pending", review_note: null, created_at: "2026-11-19" } });
    expect(requestSummary(demo, () => "Viking Press on Bolt Viking Press")).toBe("Video for Viking Press on Bolt Viking Press");
    expect(requestSummary(demo, () => null)).toBe("Video for an exercise that is no longer on the list");
    expect(read("components/coach/machine-catalog-section.tsx")).toContain("Note from Spotlight: {r.reviewNote}");
  });
});

describe("Ron reviews", () => {
  it("the review page is the platform admin's only, and Approve or Deny goes through the server-checked review", () => {
    const page = read("app/admin/machine-catalog/page.tsx");
    expect(page).toContain("if (!me?.is_platform_admin) return <NoAccess>");
    expect(page).toContain(".createSignedUrls(paths, 3600)");
    const card = read("components/admin/machine-catalog-review.tsx");
    expect(card).toContain('rpc("review_catalog_request", { p_request_id: r.id, p_approve: approve, p_note: note.trim() || null })');
    expect(read("components/coach/machine-catalog-section.tsx")).toContain('<Link href="/admin/machine-catalog"');
  });
});

describe("phone first", () => {
  it("every button on the shared list and the review page is at least 44px", () => {
    for (const f of ["components/coach/machine-catalog-section.tsx", "components/admin/machine-catalog-review.tsx"]) {
      const s = read(f);
      const buttons = [...s.matchAll(/<button\b[\s\S]*?className="([^"]*)"/g)];
      expect(buttons.length).toBeGreaterThan(1);
      for (const m of buttons) expect(m[1]).toMatch(/min-h-1[1-4]|\bh-1[1-4]\b|w-11 h-11/);
    }
  });
});

describe("the database step (208, migration 0453)", () => {
  const migration = read("supabase/migrations/0453_machine_catalog.sql").trim();
  it("the paste file is the migration, byte for byte, in one transaction, then a check of one row", () => {
    const paste = read("supabase/apply/apply-step208-0453.sql");
    expect(paste.startsWith("-- PASTE: step 208 ")).toBe(true);
    expect(paste).toContain(`begin;\n\n${migration}\n\ncommit;`);
    expect(paste).toContain("-- Check: one row, all true.");
    expect(read("supabase/apply/undo-step208-0453.sql")).toContain("drop table if exists public.catalog_requests;");
  });
  it("row security on every new table; only the admin changes the list; a coach only sends, pending and unreviewed; the review checks the admin on the server", () => {
    for (const t of ["catalog_machines", "catalog_machine_exercises", "catalog_requests"]) {
      expect(migration).toContain(`alter table public.${t} enable row level security;`);
      expect(migration).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(migration).toContain("grant select, insert on public.catalog_requests to authenticated;");
    expect(migration).toContain("with check (submitted_by = (select auth.uid()) and status = 'pending' and review_note is null and reviewed_at is null and public.is_any_group_coach());");
    expect(migration).toContain("if not public.is_platform_admin() then\n    raise exception 'Only the platform admin reviews shared-list requests.'");
    expect(migration).toContain("and rights_confirmed\n");
    expect(migration).toContain("values ('machine-demos', 'machine-demos', false, 367001600,");
    expect(migration).toContain("public.is_platform_admin() or public.is_catalog_demo_object(name)");
  });
  it("review fixes: an approved demo replaces the one there (a link over a video shows); only someone who coaches a group sends a request or uploads a video", () => {
    expect(migration).toContain("set video_path = r.video_path, youtube_url = r.youtube_url\n        where id = r.item_id;");
    expect(migration).toContain("select exists (select 1 from public.group_memberships where profile_id = (select auth.uid()) and role = 'coach')");
    expect(migration).toContain("review_note is null and reviewed_at is null and public.is_any_group_coach());");
    expect(migration).toContain("(storage.foldername(name))[1] = (select auth.uid())::text and public.is_any_group_coach());");
  });
  it("exercises approved later for a machine reach every gym that added it, on the server, in the list's order (rehearsed in scripts/sql-tests/machine-catalog.test.mjs)", () => {
    expect(migration).toContain("for g in select id, created_by from public.gym_machines where catalog_machine_id = v_machine order by created_at, id loop");
    expect(migration).toContain("where x.id = any (v_new)\n          order by x.position");
    expect(migration).toContain("continue when exists (select 1 from public.gym_machine_exercises l where l.machine_id = g.id and l.catalog_item_id = it.id);");
    expect(migration).toContain("insert into public.gym_machine_exercises (machine_id, exercise_id, position, catalog_item_id)");
  });
  it("the scan pages and the library page read the new columns only after the step (they fall back to the old ones before it)", () => {
    expect(read("app/scan/machine/[machineId]/page.tsx")).toContain('if (linkRead.error) linkRead = (await serviceRole.from("gym_machine_exercises").select("exercise_id, position")');
    expect(read("app/(coach)/groups/[groupId]/exercise-library/page.tsx")).toContain('if (machineRead.error) machineRead = (await supabase.from("gym_machines").select("id, name")');
    expect(read("app/scan/[exerciseId]/page.tsx")).toContain('.select("catalog_item_id").eq("machine_id", fromMachine).eq("exercise_id", exercise.id)');
  });
});
