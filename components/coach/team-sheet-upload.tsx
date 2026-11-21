"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { describeCell, readBox } from "@/lib/team-sheet/cell-parser";
import type { Review } from "@/lib/team-sheet/review";
import { resizePhoto } from "@/lib/image-resize";
import { readSheetCodeFromPhoto } from "@/lib/team-sheet/photo-code";
import { MAX_PHOTOS, UNCLEAR_CELL } from "@/lib/team-sheet/photo-read";

// Photos of the printed sheet (Nov 20): the sheet code is read from each photo here, in the browser, before anything is sent; a photo whose code cannot be read is taken again, never guessed at.
export const PHOTO_DISCLOSURE = "The photo is read by an outside AI service (Anthropic's Claude) to pull out the numbers. The photo is not kept.";
export const NO_CODE_IN_PHOTO = "The sheet code (the square in the bottom right corner of the page) couldn't be read. Take the photo again with the whole page flat, in good light and in view, code included.";

// Upload a filled team sheet (Excel or CSV), check what was read, and save it. Every box can be corrected here; the server reads the boxes again from the text left in them, so what is saved is exactly what this
// screen shows after the reading. Boxes the reader is not sure of are highlighted and, if left, save nothing.
type SaveResult = { saved: number; kept: number; replaced: number; records: number; batch: string | null; skipped?: { athlete_id: string; day: string; why: string }[]; droppedUnsure?: number; partial?: boolean; notSaved?: number };

const WEEKDAY = (label: string) => label.split(" ")[0];
// (the sheet code goes back with the save as printed: the server decodes and checks it, so nothing in the browser can change what a box means)

export function TeamSheetUpload({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Reading the sheet...");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [source, setSource] = useState<"xlsx" | "csv" | "photo">("xlsx");
  const [unclear, setUnclear] = useState(0);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);

  // a new file or photo starts clean: nothing from the last one carries over (nor a choice made for it)
  function startReading(label: string) {
    setBusy(true);
    setBusyLabel(label);
    setError(null);
    setReview(null);
    setResult(null);
    setUndone(false);
    setReplace(false);
    setIgnored([]);
    setUnclear(0);
  }

  function showReview(data: { review: Review; source?: unknown; ignoredSheets?: unknown; unclear?: unknown }) {
    const r = data.review;
    const t: Record<string, string> = {};
    r.sheets.forEach((s, si) => s.rows.forEach((row, ri) => row.days.forEach((cells, di) => cells.forEach((c, ei) => (t[`${si}:${ri}:${di}:${ei}`] = c.text)))));
    setTexts(t);
    // a row whose name is not the seat's, or a rack whose columns moved, starts left out: the coach ticks it in once they have checked
    const sk: Record<string, boolean> = {};
    r.sheets.forEach((s, si) => s.rows.forEach((row, ri) => { if (!row.gone && (row.nameChanged || s.columnsChanged)) sk[`${si}:${ri}`] = true; }));
    setSkip(sk);
    setIgnored(Array.isArray(data.ignoredSheets) ? data.ignoredSheets : []);
    setUnclear(typeof data.unclear === "number" ? data.unclear : 0);
    setReview(r);
    setSource(data.source === "csv" ? "csv" : data.source === "photo" ? "photo" : "xlsx");
  }

  async function onFile(file: File | null) {
    if (!file) return;
    startReading("Reading the sheet...");
    try {
      const form = new FormData();
      form.set("groupId", groupId);
      form.set("file", file);
      const res = await fetch("/api/team-sheet/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "That file could not be read. Try again.");
      else showReview(data);
    } catch {
      setError("That file could not be sent. Check your connection and try again.");
    }
    setBusy(false);
  }

  async function onPhotos(files: File[]) {
    if (files.length === 0) return;
    if (files.length > MAX_PHOTOS) {
      setError(`Up to ${MAX_PHOTOS} photos at a time. Read the rest after these are saved.`);
      return;
    }
    startReading(files.length === 1 ? "Reading the photo... this can take up to a minute." : `Reading ${files.length} photos... this can take a minute or two.`);
    try {
      const photos: { imageBase64: string; mediaType: string; codeText: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const which = files.length > 1 ? `Photo ${i + 1}: ` : "";
        // the code is read from the photo as taken (its small squares are lost once a photo is shrunk), then the photo is shrunk to send
        const codeText = await readSheetCodeFromPhoto(files[i]).catch(() => null);
        if (!codeText) {
          setError(`${which}${NO_CODE_IN_PHOTO}`);
          setBusy(false);
          return;
        }
        const resized = await resizePhoto(files[i]);
        photos.push({ imageBase64: resized.base64, mediaType: resized.mediaType, codeText });
      }
      const res = await fetch("/api/team-sheet/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, photos }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "The photo could not be read. Try again.");
      else showReview(data);
    } catch {
      setError("The photo could not be sent. Check your connection and try again.");
    }
    setBusy(false);
  }

  // what each box says right now (after any correction)
  const read = useMemo(() => {
    if (!review) return null;
    return review.sheets.map((s, si) =>
      s.rows.map((row, ri) =>
        row.days.map((cells, di) =>
          cells.map((c, ei) => {
            const ex = s.days[di].exercises[ei];
            const text = texts[`${si}:${ri}:${di}:${ei}`] ?? c.text;
            if (ex.missing) return { text, result: { kind: "missing" as const }, described: "" };
            const result = readBox(ex.kind, text, { unit: review.unit, sets: ex.sets, reps: ex.reps });
            return { text, result, described: result.kind === "unread" ? text : describeCell(result, review.unit) };
          })
        )
      )
    );
  }, [review, texts]);

  const totals = useMemo(() => {
    if (!review || !read) return { workouts: 0, unsure: 0, athletes: 0 };
    let workouts = 0;
    let unsure = 0;
    const athletes = new Set<string>();
    review.sheets.forEach((s, si) =>
      s.rows.forEach((row, ri) => {
        if (row.gone || skip[`${si}:${ri}`]) return;
        read[si][ri].forEach((cells, di) => {
          const w = new Set<string>();
          cells.forEach((c, ei) => {
            if (c.result.kind === "unsure") unsure++;
            if (c.result.kind === "sets") {
              w.add(s.days[di].exercises[ei].workoutId ?? "");
              athletes.add(row.athleteId);
            }
          });
          workouts += w.size;
        });
      })
    );
    return { workouts, unsure, athletes: athletes.size };
  }, [review, read, skip]);

  async function save() {
    if (!review || saving || totals.workouts === 0) return;
    // held before the question is asked, so a second press while the question is open does nothing
    setSaving(true);
    if (replace && !(await confirmDialog({ message: "Replace the sessions an earlier sheet or import saved with this sheet? They will be deleted and this cannot be undone. Sessions the athletes logged themselves are kept.", confirmLabel: "Replace", destructive: true }))) {
      setSaving(false);
      return;
    }
    setError(null);
    try {
      const body = {
        groupId,
        source,
        replace,
        sheets: review.sheets.map((s, si) => ({
          code: s.codeText,
          rows: s.rows.map((row, ri) => ({ athleteId: row.athleteId, skip: row.gone || !!skip[`${si}:${ri}`], cells: row.days.map((cells, di) => cells.map((_, ei) => texts[`${si}:${ri}:${di}:${ei}`] ?? "")) })),
        })),
      };
      const res = await fetch("/api/team-sheet/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Couldn't save the team sheet. Nothing was saved.");
      else setResult(data as SaveResult);
    } catch {
      setError("Couldn't save the team sheet. Nothing was saved. Check your connection and try again.");
    }
    setSaving(false);
  }

  async function undo() {
    if (!result?.batch) return;
    if (!(await confirmDialog({ message: "Undo this upload? The workouts it saved are deleted, and any records it set go back to what they were.", confirmLabel: "Undo upload", destructive: true }))) return;
    const res = await fetch("/api/team-sheet/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, batchId: result.batch }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't undo that upload.");
    else setUndone(true);
  }

  const button = "inline-flex items-center justify-center h-11 px-5 font-body text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust";

  if (result) {
    return (
      <div className="space-y-4 max-w-xl">
        <p className="font-body text-sm" role="status">
          {undone ? "That upload was undone." : result.partial ? `Saved ${result.saved} workout${result.saved === 1 ? "" : "s"}, but ${result.notSaved ?? "the rest"} could not be saved.` : `Saved ${result.saved} workout${result.saved === 1 ? "" : "s"}.`}
        </p>
        {!undone && result.partial && <p className="font-body text-sm text-rust-ink" role="alert">Something went wrong part-way. What was saved stays saved and can be undone below; uploading the same file again keeps those and saves the rest.</p>}
        {!undone && (
          <ul className="font-body text-sm text-steel list-disc pl-5 space-y-1">
            {result.kept > 0 && <li>{result.kept} already had a session and were left as they were.</li>}
            {result.replaced > 0 && <li>{result.replaced} earlier session{result.replaced === 1 ? " was" : "s were"} replaced with the sheet.</li>}
            {result.records > 0 && <li>{result.records} new record{result.records === 1 ? "" : "s"}, set quietly on the day they were lifted. No one is notified except you.</li>}
            {(result.droppedUnsure ?? 0) > 0 && <li>{result.droppedUnsure} box{result.droppedUnsure === 1 ? "" : "es"} the reader was not sure of were left blank.</li>}
            {(result.skipped ?? []).length > 0 && <li>{result.skipped!.length} row{result.skipped!.length === 1 ? "" : "s"} could not be saved: {Array.from(new Set(result.skipped!.map((s) => s.why))).join("; ")}.</li>}
          </ul>
        )}
        {error && (
          <p className="font-body text-sm text-rust-ink" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {!undone && result.batch && (
            <button type="button" onClick={undo} className={`${button} border border-steel/40 text-chalk hover:border-rust`}>
              Undo this upload
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setReview(null);
              setResult(null);
              setUndone(false);
              setReplace(false);
            }}
            className={`${button} bg-rust text-graphite hover:opacity-90`}
          >
            Upload more sheets
          </button>
        </div>
        {result.replaced > 0 && !undone && <p className="font-body text-xs text-steel">Undoing this upload removes the sheet&apos;s workouts but does not bring back the sessions it replaced.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="max-w-xl space-y-3">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide block mb-1">Filled team sheet (Excel or CSV)</span>
          <input id="team-sheet-file" type="file" accept=".xlsx,.csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void onFile(f); }} className="block w-full font-body text-sm text-chalk file:mr-3 file:h-11 file:px-4 file:border file:border-steel/40 file:bg-graphite file:text-chalk" />
        </label>
        <p className="font-body text-xs text-steel">Use the Excel file from the Team sheet page, filled in. Nothing is saved until you check it here and press Save.</p>
        <div className="border-t border-steel/20 pt-3 space-y-2">
          <span className="font-body text-xs text-steel uppercase tracking-wide block">Or a photo of the printed sheet</span>
          {/* the file box itself is hidden behind the button-shaped label; focus on it shows on the label */}
          <label className={`${button} border border-steel/40 text-chalk hover:border-rust cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-rust ${busy ? "opacity-40 pointer-events-none" : ""}`}>
            Take a photo
            <input id="team-sheet-photo" type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void onPhotos(fs); }} className="sr-only" data-team-sheet-photo />
          </label>
          <p className="font-body text-xs text-steel">One photo per printed page, up to {MAX_PHOTOS}, flat and in good light with the square sheet code in the bottom right corner in view. {PHOTO_DISCLOSURE}</p>
        </div>
        {busy && (
          <p className="font-body text-sm" role="status">
            {busyLabel}
          </p>
        )}
        {error && (
          <p className="font-body text-sm text-rust-ink" role="alert">
            {error}
          </p>
        )}
        {review && ignored.length > 0 && <p className="font-body text-xs text-steel">Not read (not a rack sheet): {ignored.join(", ")}.</p>}
        {review && source === "photo" && (
          <p className="font-body text-sm" data-team-sheet-photo-note>
            Read from a photo: check every box against the paper before you save.
            {unclear > 0 ? ` A box showing ${UNCLEAR_CELL} is one the reader couldn't read with certainty (${unclear} of them); type what the paper says, or it is left blank.` : ""}
          </p>
        )}
      </div>

      {review && read && (
        <>
          <div className="border border-steel/25 p-4 max-w-3xl space-y-3">
            <p className="font-body text-sm">
              This sheet is in <b>{review.unit}</b>.{review.unit === "kg" ? " Weights are kept in pounds, so 100 kg is saved as 220.46 lb and shows as 100 kg to anyone who uses kilograms." : ""}
            </p>
            <p className="font-body text-sm">
              <b>{totals.workouts}</b> workout{totals.workouts === 1 ? "" : "s"} for <b>{totals.athletes}</b> athlete{totals.athletes === 1 ? "" : "s"} are ready to save.
              {totals.unsure > 0 && <span className="text-rust-ink"> {totals.unsure} box{totals.unsure === 1 ? " is" : "es are"} highlighted because the reader was not sure; fix them or they will be left blank.</span>}
            </p>
            {review.summary.existing > 0 && (
              <fieldset className="space-y-1">
                <legend className="font-body text-xs text-steel uppercase tracking-wide mb-1">{review.summary.existing} already have a session for these workouts</legend>
                <label className="flex items-center gap-2 font-body text-sm">
                  <input id="team-sheet-keep" type="radio" name="existing" checked={!replace} onChange={() => setReplace(false)} className="accent-rust" /> Keep what is there (recommended)
                </label>
                <label className="flex items-center gap-2 font-body text-sm">
                  <input id="team-sheet-replace" type="radio" name="existing" checked={replace} onChange={() => setReplace(true)} className="accent-rust" /> Replace it with the sheet (only a finished session an earlier sheet or an import saved is replaced and cannot be brought back; a session the athlete logged, one in progress or a booked one is always kept)
                </label>
              </fieldset>
            )}
            <button type="button" onClick={save} disabled={saving || totals.workouts === 0} className={`${button} bg-rust text-graphite hover:opacity-90 disabled:opacity-40`}>
              {saving ? "Saving..." : `Save ${totals.workouts} workout${totals.workouts === 1 ? "" : "s"}`}
            </button>
          </div>

          {review.sheets.map((s, si) => (
            <section key={s.rack} aria-label={`Rack ${s.rack}`} className="space-y-2">
              <h2 className="font-display uppercase text-xl">Rack {s.rack}</h2>
              {s.columnsChanged && <p className="font-body text-sm text-rust-ink" role="alert">The exercise names across the top are not the ones this sheet was printed with. A column may have been added, removed or moved, so a box may be under the wrong exercise. Every row here starts left out; tick a row in once you have checked it, or download a fresh sheet.</p>}
              <div className="overflow-x-auto border border-steel/20">
                <table className="border-collapse font-body text-sm min-w-full">
                  <caption className="sr-only">Rack {s.rack}: what was read from each box, by athlete and exercise</caption>
                  <thead>
                    <tr className="bg-surface/60">
                      <th scope="col" rowSpan={2} className="text-left p-2 border border-steel/20 align-bottom">
                        Athlete
                      </th>
                      {s.days.map((d, di) => (
                        <th key={d.date} scope="colgroup" colSpan={Math.max(1, d.exercises.length)} className="text-left p-2 border border-steel/20">
                          {d.label}
                          {d.title ? ` - ${d.title}` : ""}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-surface/40">
                      {s.days.map((d) =>
                        d.exercises.length === 0 ? (
                          <th key={d.date} className="p-2 border border-steel/20 text-steel font-normal">
                            (none)
                          </th>
                        ) : (
                          d.exercises.map((ex) => (
                            <th key={ex.id} scope="col" className="p-2 border border-steel/20 text-left align-top min-w-[8rem]">
                              <span className="block">{ex.name}</span>
                              <span className="block text-xs text-steel font-normal">{ex.missing ? "removed" : ex.kind === "unread" ? "notes only" : ex.prescription}</span>
                            </th>
                          ))
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((row, ri) => {
                      const off = row.gone || !!skip[`${si}:${ri}`];
                      return (
                        <tr key={row.athleteId} className={off ? "opacity-50" : ""}>
                          <th scope="row" className="text-left p-2 border border-steel/20 align-top min-w-[10rem]">
                            <label className="flex items-start gap-2">
                              <input id={`team-sheet-include-${si}-${ri}`} type="checkbox" checked={!off} disabled={row.gone} onChange={() => setSkip((cur) => ({ ...cur, [`${si}:${ri}`]: !cur[`${si}:${ri}`] }))} className="mt-1 accent-rust" aria-label={`Include ${row.name}`} />
                              <span>
                                {row.name}
                                {row.gone && <span className="block text-xs text-rust-ink font-normal">not in this group any more</span>}
                                {row.nameChanged && <span className="block text-xs text-rust-ink font-normal">printed as {row.printedName}: check it is the right person, then tick it in</span>}
                                {row.existing.some(Boolean) && <span className="block text-xs text-steel font-normal">already has: {row.existing.map((e, di) => (e ? WEEKDAY(s.days[di].label) : null)).filter(Boolean).join(", ")}</span>}
                              </span>
                            </label>
                          </th>
                          {s.days.map((d, di) =>
                            d.exercises.length === 0 ? (
                              <td key={d.date} className="border border-steel/20" />
                            ) : (
                              d.exercises.map((ex, ei) => {
                                const cell = read[si][ri][di][ei];
                                const kind = cell.result.kind;
                                const tone = kind === "unsure" ? "bg-amber-500/20 outline outline-2 -outline-offset-2 outline-amber-500" : kind === "sets" ? "bg-moss/10" : kind === "skipped" ? "bg-steel/10" : "";
                                return (
                                  <td key={ex.id} className={`border border-steel/20 p-1 align-top ${tone}`}>
                                    <input
                                      id={`team-sheet-cell-${si}-${ri}-${di}-${ei}`}
                                      type="text"
                                      value={cell.text}
                                      maxLength={120}
                                      disabled={ex.missing || off}
                                      onChange={(e) => setTexts((cur) => ({ ...cur, [`${si}:${ri}:${di}:${ei}`]: e.target.value }))}
                                      aria-label={`${row.name}, ${ex.name}, ${d.label}`}
                                      className="w-full h-9 bg-transparent border border-steel/30 px-1.5 font-mono text-sm focus:outline-none focus:border-rust"
                                    />
                                    {kind === "unsure" && <span className="block text-xs text-rust-ink mt-0.5">not sure: left blank</span>}
                                    {kind === "sets" && cell.described !== cell.text && <span className="block text-xs text-steel mt-0.5">{cell.described}</span>}
                                    {kind === "skipped" && <span className="block text-xs text-steel mt-0.5">skipped</span>}
                                  </td>
                                );
                              })
                            )
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
