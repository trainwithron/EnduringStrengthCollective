// The shared machine list (Ron, Nov 19: "a master shared machine list, but I definitely want to be the one that has the final say"; "I was hoping that my video demos would populate
// for everyone. Especially on the specialty equipment"). Migration 0453: catalog_machines (brand + model), catalog_machine_exercises (its exercises in order, each with one demo),
// catalog_requests (what coaches send Ron). A coach's machine added from the list stays linked to it, so its demos are read from the list live. Pure, so it is tested.
import { extractYoutubeId } from "@/lib/youtube";

export const MACHINE_DEMOS_BUCKET = "machine-demos";
export const BRAND_MAX = 60;
export const MODEL_MAX = 80;
export const REQUEST_EXERCISES_MAX = 30;
const EXERCISE_NAME_MAX = 80;

export interface CatalogItem {
  // catalog_machine_exercises.id
  id: string;
  catalogExerciseId: string;
  name: string;
  category: string | null;
  position: number;
  videoPath: string | null;
  youtubeUrl: string | null;
}

export interface CatalogMachine {
  id: string;
  brand: string;
  model: string;
  items: CatalogItem[];
}

export type CatalogDemo = { kind: "video"; path: string } | { kind: "youtube"; url: string } | null;

export interface CatalogRequestRow {
  id: string;
  kind: "machine" | "demo";
  brand: string | null;
  model: string | null;
  exercises: { name: string; catalogId: string | null }[] | null;
  itemId: string | null;
  videoPath: string | null;
  youtubeUrl: string | null;
  status: "pending" | "approved" | "denied";
  reviewNote: string | null;
  createdAt: string;
}

// The columns read for the list (live schema, migration 0453).
export const CATALOG_SELECT = "id, brand, model, catalog_machine_exercises ( id, catalog_exercise_id, position, video_path, youtube_url, exercise_catalog ( name, category ) )";
export const REQUEST_SELECT = "id, kind, brand, model, exercises, item_id, video_path, youtube_url, status, review_note, created_at";

export function catalogMachineName(m: { brand: string; model: string }): string {
  return `${m.brand} ${m.model}`;
}

type CatalogRowIn = {
  id: string;
  brand: string;
  model: string;
  catalog_machine_exercises?: {
    id: string;
    catalog_exercise_id: string;
    position: number;
    video_path: string | null;
    youtube_url: string | null;
    exercise_catalog: { name: string; category: string | null } | { name: string; category: string | null }[] | null;
  }[] | null;
};

// The list from its rows: machines by brand then model, each machine's exercises in their saved order.
export function catalogFromRows(rows: CatalogRowIn[]): CatalogMachine[] {
  return rows
    .map((r) => ({
      id: r.id,
      brand: r.brand,
      model: r.model,
      items: (r.catalog_machine_exercises ?? [])
        .map((e) => {
          const cat = Array.isArray(e.exercise_catalog) ? e.exercise_catalog[0] : e.exercise_catalog;
          return { id: e.id, catalogExerciseId: e.catalog_exercise_id, name: cat?.name ?? "Exercise", category: cat?.category ?? null, position: e.position, videoPath: e.video_path, youtubeUrl: e.youtube_url };
        })
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

function words(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

// "viking press" and "hammer strength" both find their machines: every word typed is in the brand and model (any order, any case, dashes and spaces alike).
export function searchCatalog(machines: CatalogMachine[], query: string): CatalogMachine[] {
  const terms = words(query).trim().split(" ").filter(Boolean);
  if (terms.length === 0) return [];
  return machines.filter((m) => {
    const hay = words(`${m.brand} ${m.model}`).replace(/ /g, "");
    return terms.every((t) => hay.includes(t));
  });
}

// The demo shown for an exercise on the list: the filmed video when there is one, else the YouTube link (Commander, Nov 19).
export function catalogDemo(item: { videoPath: string | null; youtubeUrl: string | null } | null | undefined): CatalogDemo {
  if (!item) return null;
  if (item.videoPath) return { kind: "video", path: item.videoPath };
  if (item.youtubeUrl && item.youtubeUrl.trim()) return { kind: "youtube", url: item.youtubeUrl.trim() };
  return null;
}

// A YouTube link as it is sent for the list: the plain watch link (the database takes only youtube.com and youtu.be links), or null when it is not a YouTube video.
export function catalogYoutubeLink(raw: string): string | null {
  const id = extractYoutubeId(raw.trim());
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

function tidy(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

// A new machine as it is sent: a brand, a model and 1 to 30 exercises (the same rules the database checks). An exercise is one from the exercise catalog, or a new name.
export function cleanMachineRequest(input: {
  brand: string;
  model: string;
  exercises: { name: string; catalogId: string | null }[];
}): { ok: true; brand: string; model: string; exercises: { name: string; catalogId: string | null }[] } | { ok: false; error: string } {
  const brand = tidy(input.brand);
  const model = tidy(input.model);
  if (!brand) return { ok: false, error: "Enter the brand, for example Bolt or Hammer Strength." };
  if (brand.length > BRAND_MAX) return { ok: false, error: `Keep the brand to ${BRAND_MAX} characters.` };
  if (!model) return { ok: false, error: "Enter the machine's name, for example Viking Press." };
  if (model.length > MODEL_MAX) return { ok: false, error: `Keep the machine's name to ${MODEL_MAX} characters.` };
  const seen = new Set<string>();
  const exercises: { name: string; catalogId: string | null }[] = [];
  for (const e of input.exercises) {
    const name = tidy(e.name);
    if (!name) continue;
    if (name.length > EXERCISE_NAME_MAX) return { ok: false, error: `Keep each exercise to ${EXERCISE_NAME_MAX} characters.` };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    exercises.push({ name, catalogId: e.catalogId });
  }
  if (exercises.length === 0) return { ok: false, error: "Add at least one exercise done on this machine." };
  if (exercises.length > REQUEST_EXERCISES_MAX) return { ok: false, error: `Up to ${REQUEST_EXERCISES_MAX} exercises a machine.` };
  return { ok: true, brand, model, exercises };
}

export interface LibraryLite {
  id: string;
  name: string;
  catalogId: string | null;
}

// "Add to my gym": for each exercise on the shared machine, the coach's own library row to use (one with that catalog exercise, else one with the same name), or a new one to add.
export function planAddToGym(items: CatalogItem[], library: LibraryLite[]): { item: CatalogItem; reuseId: string | null }[] {
  const byCatalog = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of library) {
    if (row.catalogId && !byCatalog.has(row.catalogId)) byCatalog.set(row.catalogId, row.id);
    const key = row.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, row.id);
  }
  return items.map((item) => ({ item, reuseId: byCatalog.get(item.catalogExerciseId) ?? byName.get(item.name.trim().toLowerCase()) ?? null }));
}

export function requestFromRow(r: {
  id: string;
  kind: string;
  brand: string | null;
  model: string | null;
  exercises: unknown;
  item_id: string | null;
  video_path: string | null;
  youtube_url: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
}): CatalogRequestRow {
  const list = Array.isArray(r.exercises)
    ? (r.exercises as { name?: unknown; catalogId?: unknown }[]).map((e) => ({ name: typeof e?.name === "string" ? e.name : "", catalogId: typeof e?.catalogId === "string" ? e.catalogId : null }))
    : null;
  return {
    id: r.id,
    kind: r.kind === "demo" ? "demo" : "machine",
    brand: r.brand,
    model: r.model,
    exercises: list,
    itemId: r.item_id,
    videoPath: r.video_path,
    youtubeUrl: r.youtube_url,
    status: r.status === "approved" ? "approved" : r.status === "denied" ? "denied" : "pending",
    reviewNote: r.review_note,
    createdAt: r.created_at,
  };
}

export function requestStatusLabel(status: CatalogRequestRow["status"]): string {
  return status === "approved" ? "Approved" : status === "denied" ? "Not approved" : "Waiting for review";
}

// What a request is, in a line: "Bolt Viking Press (3 exercises)" or "Demo for Viking Press on Bolt Viking Press".
export function requestSummary(r: CatalogRequestRow, itemLabel: (itemId: string) => string | null): string {
  if (r.kind === "machine") {
    const n = r.exercises?.length ?? 0;
    return `${r.brand ?? ""} ${r.model ?? ""}`.trim() + ` (${n} ${n === 1 ? "exercise" : "exercises"})`;
  }
  const label = r.itemId ? itemLabel(r.itemId) : null;
  return `${r.videoPath ? "Video" : "YouTube link"} for ${label ?? "an exercise that is no longer on the list"}`;
}
