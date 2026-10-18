"use client";

import { useMemo, useState } from "react";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { describeCell, readBox } from "@/lib/team-sheet/cell-parser";
import type { Review } from "@/lib/team-sheet/review";

// Upload a filled team sheet (Excel or CSV), check what was read, and save it. Every box can be corrected here; the server reads the boxes again from the text left in them, so what is saved is exactly what this
// screen shows after the reading. Boxes the reader is not sure of are highlighted and, if left, save nothing.
type SaveResult = { saved: number; kept: number; replaced: number; records: number; batch: string | null; skipped?: { athlete_id: string; day: string; why: string }[]; droppedUnsure?: number };

const WEEKDAY = (label: string) => label.split(" ")[0];
// (the sheet code goes back with the save as printed: the server decodes and checks it, so nothing in the browser can change what a box means)

export function TeamSheetUpload({ groupId }: { groupId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [source, setSource] = useState<"xlsx" | "csv">("xlsx");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [undone, setUndone] = useState(false);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setReview(null);
    setResult(null);
    setUndone(false);
    try {
      const form = new FormData();
      form.set("groupId", groupId);
      form.set("file", file);
      const res = await fetch("/api/team-sheet/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That file could not be read. Try again.");
      } else {
        const r = data.review as Review;
        const t: Record<string, string> = {};
        r.sheets.forEach((s, si) => s.rows.forEach((row, ri) => row.days.forEach((cells, di) => cells.forEach((c, ei) => (t[`${si}:${ri}:${di}:${ei}`] = c.text)))));
        setTexts(t);
        setSkip({});
        setReview(r);
        setSource(data.source === "csv" ? "csv" : "xlsx");
      }
    } catch {
      setError("That file could not be sent. Check your connection and try again.");
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
    if (replace && !(await confirmDialog({ message: "Replace the athletes' own sessions with the sheet? Their own sessions will be deleted and this cannot be undone.", confirmLabel: "Replace", destructive: true }))) return;
    setSaving(true);
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
          {undone ? "That upload was undone." : `Saved ${result.saved} workout${result.saved === 1 ? "" : "s"}.`}
        </p>
        {!undone && (
          <ul className="font-body text-sm text-steel list-disc pl-5 space-y-1">
            {result.kept > 0 && <li>{result.kept} already had a session and were left as they were.</li>}
            {result.replaced > 0 && <li>{result.replaced} of the athletes&apos; own sessions were replaced with the sheet.</li>}
            {result.records > 0 && <li>{result.records} new record{result.records === 1 ? "" : "s"}, set quietly on the day they were lifted. No one is notified except you.</li>}
            {(result.droppedUnsure ?? 0) > 0 && <li>{result.droppedUnsure} box{result.droppedUnsure === 1 ? "" : "es"} the reader was not sure of were left blank.</li>}
            {(result.skipped ?? []).length > 0 && <li>{result.skipped!.length} row{result.skipped!.length === 1 ? "" : "s"} could not be saved: {Array.from(new Set(result.skipped!.map((s) => s.why))).join("; ")}.</li>}
          </ul>
        )}
        {error && (
          <p className="font-body text-sm text-rust" role="alert">
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
          <input id="team-sheet-file" type="file" accept=".xlsx,.csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="block w-full font-body text-sm text-chalk file:mr-3 file:h-11 file:px-4 file:border file:border-steel/40 file:bg-graphite file:text-chalk" />
        </label>
        <p className="font-body text-xs text-steel">Use the Excel file from the Team sheet page, filled in. Nothing is saved until you check it here and press Save.</p>
        {busy && (
          <p className="font-body text-sm" role="status">
            Reading the sheet...
          </p>
        )}
        {error && (
          <p className="font-body text-sm text-rust" role="alert">
            {error}
          </p>
        )}
      </div>

      {review && read && (
        <>
          <div className="border border-steel/25 p-4 max-w-3xl space-y-3">
            <p className="font-body text-sm">
              <b>{totals.workouts}</b> workout{totals.workouts === 1 ? "" : "s"} for <b>{totals.athletes}</b> athlete{totals.athletes === 1 ? "" : "s"} are ready to save.
              {totals.unsure > 0 && <span className="text-rust"> {totals.unsure} box{totals.unsure === 1 ? " is" : "es are"} highlighted because the reader was not sure; fix them or they will be left blank.</span>}
            </p>
            {review.summary.existing > 0 && (
              <fieldset className="space-y-1">
                <legend className="font-body text-xs text-steel uppercase tracking-wide mb-1">{review.summary.existing} already have a session for these workouts</legend>
                <label className="flex items-center gap-2 font-body text-sm">
                  <input id="team-sheet-keep" type="radio" name="existing" checked={!replace} onChange={() => setReplace(false)} className="accent-rust" /> Keep what is there (recommended)
                </label>
                <label className="flex items-center gap-2 font-body text-sm">
                  <input id="team-sheet-replace" type="radio" name="existing" checked={replace} onChange={() => setReplace(true)} className="accent-rust" /> Replace it with the sheet (their own session is deleted and cannot be brought back)
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
              <div className="overflow-x-auto border border-steel/20">
                <table className="border-collapse font-body text-sm min-w-full">
                  <thead>
                    <tr className="bg-surface/60">
                      <th rowSpan={2} className="text-left p-2 border border-steel/20 align-bottom">
                        Athlete
                      </th>
                      {s.days.map((d, di) => (
                        <th key={d.date} colSpan={Math.max(1, d.exercises.length)} className="text-left p-2 border border-steel/20">
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
                            <th key={ex.id} className="p-2 border border-steel/20 text-left align-top min-w-[8rem]">
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
                                {row.gone && <span className="block text-xs text-rust font-normal">not in this group any more</span>}
                                {row.nameChanged && <span className="block text-xs text-rust font-normal">printed as {row.printedName}: check it is the right person</span>}
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
                                    {kind === "unsure" && <span className="block text-xs text-rust mt-0.5">not sure: left blank</span>}
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
