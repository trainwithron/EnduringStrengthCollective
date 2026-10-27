import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readInstagramHandle, saveInstagramHandle } from "./instagram-handle";
import { readShareCardSettings } from "./share-card-settings";

// Ron, Oct 27: "there needs to be a place to input ig handle individually in the desktop version" / "maybe even in the mobile settings". Every coach sets their own handle in their own
// Settings, with or without a public page (live: 3 coaches, 1 page). It lives in one place, coach_profiles.instagram_handle (0438).
type Call = { table: string; op: string; payload?: unknown; onConflict?: string };
function db(rows: { coach_profiles?: Record<string, unknown> | null; coach_booking_pages?: Record<string, unknown> | null } = {}, errors: { coach_profiles?: boolean; coach_booking_pages?: boolean } = {}) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const answer = () => (errors[table as keyof typeof errors] ? { data: null, error: { message: "x" } } : { data: rows[table as keyof typeof rows] ?? null, error: null });
      Object.assign(b, {
        select: () => (calls.push({ table, op: "select" }), b),
        eq: () => b,
        maybeSingle: async () => answer(),
        upsert: async (payload: unknown, opts?: { onConflict?: string }) => (calls.push({ table, op: "upsert", payload, onConflict: opts?.onConflict }), { error: errors[table as keyof typeof errors] ? { message: "x" } : null }),
        update: (payload: unknown) => (calls.push({ table, op: "update", payload }), b),
        insert: (payload: unknown) => (calls.push({ table, op: "insert", payload }), b),
      });
      return b;
    },
  };
  return { client: client as never, calls };
}

describe("a coach saves their own handle", () => {
  it("a coach with no public page saves it on their own settings row (made the first time), and nothing else is made or switched on", async () => {
    const { client, calls } = db();
    expect(await saveInstagramHandle(client, "maria", "maria.lifts")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "coach_profiles", op: "upsert", onConflict: "coach_id" });
    expect(calls[0].payload).toMatchObject({ coach_id: "maria", instagram_handle: "maria.lifts" });
    expect(Object.keys(calls[0].payload as object).sort()).toEqual(["coach_id", "instagram_handle", "updated_at"]);
    expect(calls.some((c) => c.table === "coach_booking_pages" || c.table === "coach_sites")).toBe(false);
  });
  it("and clears it", async () => {
    const { client, calls } = db();
    expect(await saveInstagramHandle(client, "maria", null)).toBe(true);
    expect(calls[0].payload).toMatchObject({ coach_id: "maria", instagram_handle: null });
  });
  it("a failed save is said", async () => {
    expect(await saveInstagramHandle(db({}, { coach_profiles: true }).client, "maria", "x")).toBe(false);
  });
});

describe("one value everywhere", () => {
  it("Settings reads it from the coach's own row; none is empty, and a failed read hides the field", async () => {
    expect(await readInstagramHandle(db({ coach_profiles: { instagram_handle: "coach.ron" } }).client, "ron")).toEqual({ handle: "coach.ron" });
    expect(await readInstagramHandle(db({ coach_profiles: null }).client, "maria")).toEqual({ handle: null });
    expect(await readInstagramHandle(db({}, { coach_profiles: true }).client, "ron")).toBeNull();
  });
  it("the Booking page / Availability block shows the same handle, with the QR switch from the page row; no page: no block (the handle is in Settings)", async () => {
    expect(await readShareCardSettings(db({ coach_profiles: { instagram_handle: "coach.ron" }, coach_booking_pages: { share_card_qr: false } }).client, "ron")).toEqual({ handle: "coach.ron", qr: false });
    expect(await readShareCardSettings(db({ coach_profiles: null, coach_booking_pages: { share_card_qr: true } }).client, "ron")).toEqual({ handle: null, qr: true });
    expect(await readShareCardSettings(db({ coach_profiles: { instagram_handle: "maria.lifts" }, coach_booking_pages: null }).client, "maria")).toBeNull();
  });
  it("nothing reads or writes a handle on the public page row any more", () => {
    for (const f of ["lib/share-card-coach.ts", "lib/share-card-settings.ts", "components/coach/share-card-settings.tsx", "components/coach/instagram-handle-field.tsx", "lib/instagram-handle.ts"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/coach_booking_pages"\)\.select\("[^"]*instagram_handle/);
      expect(src, f).not.toMatch(/coach_booking_pages"\)[^;]*instagram_handle:/);
    }
  });
});

describe("where it is", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  it("in every coach's own Settings, in the profile area under their name (the same page is the computer's Account and the phone's Settings tab); never for someone they are viewing as", () => {
    const page = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(page).toContain("const igHandle = isCoach && !viewingOther ? await readInstagramHandle(supabase, user.id) : null;");
    expect(page).toContain('<InstagramHandleField coachId={user.id} initialHandle={igHandle.handle} id="settings-instagram-handle" />');
    // right after the name / photo block
    const nameAt = page.indexOf("<EditDisplayName");
    const fieldAt = page.indexOf("<InstagramHandleField");
    expect(fieldAt).toBeGreaterThan(nameAt);
    expect(page.slice(nameAt, fieldAt)).not.toContain("<SettingsGroup");
  });
  it("the same field (and its cleaning) in Settings and under Booking page / Availability", () => {
    expect(read("components/coach/share-card-settings.tsx")).toContain('import { InstagramHandleField } from "@/components/coach/instagram-handle-field";');
    const field = read("components/coach/instagram-handle-field.tsx");
    expect(field).toContain("saveInstagramHandle(createBrowserClient(), coachId, cleaned.handle)");
    expect(field).toContain("min-h-11");
  });
});
