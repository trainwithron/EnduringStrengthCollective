"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { localDateKey } from "@/lib/date-key";
import { IMPORTED_FOOD_SOURCE } from "@/lib/imported-food";
import { chunkByDay, parseNutritionHistory, previewLine, sampleLine, type NutritionHistoryParse } from "@/lib/nutrition-history-import";

type Parsed = Extract<NutritionHistoryParse, { ok: true }>;

// The most a file may be before it is read at all (two years of a heavy Cronometer log is a few megabytes).
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// Rows per request: well under the route's limit, and whole days only.
const SEND_ROWS = 1500;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// "Upload nutrition history" on the coach's view of a client's Nutrition tab (Ron, Nov 9). The coach picks the CSV a client exported from Cronometer, MyFitnessPal or MacroFactor;
// it is read right here in the browser (the file itself is never sent anywhere), the coach sees what was found, and only on Save are the rows sent to our own route. What is
// brought in shows as history only: it never counts as days the client logged. Mirrors "Upload exercise history" (components/coach/exercise-history-uploader.tsx).
export function NutritionHistoryUploader({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const router = useRouter();
  const first = clientName.trim().split(/\s+/)[0] || "this client";
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "reviewing" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeNote, setRemoveNote] = useState<string | null>(null);
  const todayKey = localDateKey(new Date());

  async function refreshImportedCount() {
    const { count, error: countError } = await createBrowserClient()
      .from("food_log_entries")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .eq("food_source", IMPORTED_FOOD_SOURCE);
    setImportedCount(countError ? null : (count ?? 0));
  }

  useEffect(() => {
    if (open) void refreshImportedCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, athleteId, groupId]);

  function reset() {
    setStatus("idle");
    setError(null);
    setParsed(null);
    setProgress(null);
    setResult(null);
  }

  async function handleFile(file: File) {
    reset();
    setRemoveNote(null);
    if (file.size > MAX_FILE_BYTES) {
      setStatus("error");
      setError("That file is too big to read here. Export a shorter date range (up to 2 years) and try again. Nothing was saved.");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setStatus("error");
      setError("That file couldn't be opened. Nothing was saved.");
      return;
    }
    const p = parseNutritionHistory(text, { todayKey, fileName: file.name });
    if (!p.ok) {
      setStatus("error");
      setError(p.error);
      return;
    }
    setParsed(p);
    setStatus("reviewing");
  }

  async function handleSave() {
    if (!parsed || status === "saving") return;
    setStatus("saving");
    setError(null);
    const pieces = chunkByDay(parsed.rows, SEND_ROWS);
    let saved = 0;
    let already = 0;
    let leftOut = 0;
    for (let i = 0; i < pieces.length; i++) {
      if (pieces.length > 1) setProgress(`Saving part ${i + 1} of ${pieces.length}…`);
      let body: { error?: string; savedDays?: number; alreadyImportedDays?: number; leftOutDays?: number } = {};
      let ok = false;
      try {
        const res = await fetch("/api/clients/nutrition-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, athleteId, rows: pieces[i] }),
        });
        body = await res.json().catch(() => ({}));
        ok = res.ok;
      } catch {
        body = { error: "The connection dropped." };
      }
      saved += body.savedDays ?? 0;
      if (!ok) {
        setProgress(null);
        setStatus("reviewing");
        const why = body.error ?? "That didn't save.";
        setError(
          saved > 0
            ? `Saved ${plural(saved, "day", "days")}; the rest didn't save. ${why} Press Save again to try the rest: days already saved aren't repeated.`
            : why.includes("Nothing was saved") ? why : `${why} Nothing was saved. Press Save to try again.`
        );
        if (saved > 0) router.refresh();
        void refreshImportedCount();
        return;
      }
      already += body.alreadyImportedDays ?? 0;
      leftOut += body.leftOutDays ?? 0;
    }
    setProgress(null);
    const parts = [`Saved ${plural(saved, "day", "days")}.`];
    if (already > 0) parts.push(`${plural(already, "day was", "days were")} already imported, so ${already === 1 ? "it was" : "they were"} left as ${already === 1 ? "it was" : "they were"}.`);
    if (leftOut > 0) parts.push(`${plural(leftOut, "day", "days")} from today on ${leftOut === 1 ? "was" : "were"} left out.`);
    setResult(parts.join(" "));
    setParsed(null);
    setStatus("done");
    router.refresh();
    void refreshImportedCount();
  }

  async function handleRemove() {
    if (removing || !importedCount) return;
    const ok = await confirmDialog({
      message: `Remove all ${plural(importedCount, "imported food", "imported foods")} from ${first}'s history? Anything ${first} logged in the app is not touched.`,
      confirmLabel: "Remove imported history",
      destructive: true,
    });
    if (!ok) return;
    setRemoving(true);
    setRemoveNote(null);
    try {
      const res = await fetch("/api/clients/nutrition-history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, athleteId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; removed?: number };
      setRemoveNote(res.ok ? `Removed ${plural(body.removed ?? 0, "imported food", "imported foods")}.` : (body.error ?? "That didn't work. Try again."));
      if (res.ok) router.refresh();
    } catch {
      setRemoveNote("The connection dropped. Try again.");
    }
    setRemoving(false);
    void refreshImportedCount();
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 inline-flex items-center font-body text-xs text-rust border border-rust px-3" data-nutrition-history-upload>
          Upload nutrition history
        </button>
      </div>
    );
  }

  const filePicker = (label: string) => (
    <label className="min-h-11 inline-flex items-center px-4 bg-rust text-graphite font-body text-sm font-medium cursor-pointer">
      {label}
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
    </label>
  );

  return (
    <div className="mb-6 max-w-2xl border border-steel/20 bg-surface/40 p-6" data-nutrition-history-panel>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-display uppercase text-sm tracking-wide">Upload nutrition history</h3>
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="min-h-11 -mt-3 -mr-2 px-2 font-body text-xs text-steel">
          Close
        </button>
      </div>
      <p className="font-body text-xs text-steel mb-4">
        Bring in {first}&apos;s food diary from Cronometer (the Servings export), MyFitnessPal (the Nutrition export) or MacroFactor, as a .csv file. It shows in {first}&apos;s history and charts only: it
        never counts as days logged in the app. Nothing is saved until you press Save.
      </p>

      {status === "idle" && filePicker("Choose a CSV file")}

      {status === "error" && error && (
        <div>
          <p className="font-body text-sm text-rust mb-3" role="alert">
            {error}
          </p>
          {filePicker("Choose another file")}
        </div>
      )}

      {(status === "reviewing" || status === "saving") && parsed && (
        <div>
          <p className="font-body text-sm text-chalk mb-1">From {parsed.sourceLabel}.</p>
          <p className="font-body text-sm text-chalk mb-2" data-nutrition-history-preview>
            {previewLine(parsed, todayKey)}
          </p>
          {parsed.leftOutFromToday > 0 && (
            <p className="font-body text-xs text-steel mb-2">
              {plural(parsed.leftOutFromToday, "row is", "rows are")} dated today or later and {parsed.leftOutFromToday === 1 ? "was" : "were"} left out: today is logged in the app.
            </p>
          )}
          {parsed.skipped.length > 0 && (
            <div className="mb-3">
              <p className="font-body text-xs text-steel mb-1">
                {plural(parsed.skipped.length, "row was", "rows were")} not read (blank, a day&apos;s total, or a number that couldn&apos;t be read):
              </p>
              <div className="max-h-32 overflow-y-auto border border-steel/20">
                {parsed.skipped.slice(0, 30).map((s) => (
                  <p key={s.rowNumber} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
                    Row {s.rowNumber}: {s.reason}
                  </p>
                ))}
                {parsed.skipped.length > 30 && <p className="font-body text-xs text-steel px-2 py-1">…and {parsed.skipped.length - 30} more</p>}
              </div>
            </div>
          )}
          <p className="font-body text-xs text-steel mb-1">A few of the rows:</p>
          <div className="border border-steel/20 mb-3">
            {parsed.rows.slice(0, 5).map((row, i) => (
              <p key={i} className="font-body text-xs text-chalk px-2 py-1 border-b border-steel/10 last:border-b-0">
                {sampleLine(row)}
              </p>
            ))}
          </div>
          {error && (
            <p className="font-body text-sm text-rust mb-2" role="alert">
              {error}
            </p>
          )}
          {progress && <p className="font-body text-xs text-steel mb-2">{progress}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleSave} disabled={status === "saving"} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {status === "saving" ? "Saving…" : `Save ${plural(parsed.dayCount, "day", "days")}`}
            </button>
            <button type="button" onClick={reset} disabled={status === "saving"} className="min-h-11 px-3 font-body text-sm text-steel disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "done" && result && (
        <div>
          <p className="font-body text-sm text-chalk mb-3" role="status">
            {result}
          </p>
          {filePicker("Upload another file")}
        </div>
      )}

      {importedCount != null && importedCount > 0 && status !== "saving" && (
        <div className="mt-5 pt-4 border-t border-steel/15 flex flex-wrap items-center justify-between gap-2">
          <p className="font-body text-xs text-steel">{plural(importedCount, "imported food", "imported foods")} on file for {first}.</p>
          <button type="button" onClick={handleRemove} disabled={removing} className="min-h-11 px-2 font-body text-xs text-rust disabled:opacity-40">
            {removing ? "Removing…" : "Remove imported history"}
          </button>
        </div>
      )}
      {removeNote && (
        <p className="font-body text-xs text-steel mt-2" role="status">
          {removeNote}
        </p>
      )}
    </div>
  );
}
