"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTerm } from "@/components/coach/terminology-provider";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { parseRoster, splitPastedRoster, ROSTER_MAX_ROWS, type RosterParse } from "@/lib/roster-import";

type Step = "enter" | "preview" | "adding" | "done" | "uncertain";
interface Result {
  rowNumber: number;
  name: string;
  ok: boolean;
  profileId?: string;
  reason?: string;
}

const inputClass = "w-full mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust";

// Adds a whole roster to a group from a pasted list or a spreadsheet. The coach sees exactly who will be added (and every line that was not used, with why) before anything is created; nobody is
// emailed or texted. Right afterwards the whole import can be taken back.
export function RosterImportPanel({ groupId, groupName, onAdded, onClose }: { groupId: string; groupName: string; onAdded?: () => void; onClose: () => void }) {
  const t = useTerm();
  const router = useRouter();
  const [step, setStep] = useState<Step>("enter");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<RosterParse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [undone, setUndone] = useState<{ removed: number; left: string[] } | null>(null);
  const [undoing, setUndoing] = useState(false);

  function preview(cells: string[][]) {
    const result = parseRoster(cells);
    if (result.rows.length === 0) {
      setError(result.skipped.length > 0 ? "None of those lines could be used. See why below." : "Nothing to add yet. Paste a name on each line.");
      setParsed(result.skipped.length > 0 ? result : null);
      return;
    }
    setError(null);
    setParsed(result);
    setStep("preview");
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      // The spreadsheet reader is loaded only when a file is chosen (it is large, and most visits never import anything).
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", codepage: 65001 });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      preview(rows.map((r) => r.map((c) => String(c ?? ""))));
    } catch {
      setError("That file couldn't be read. Use a .csv or .xlsx file, or paste the names instead.");
    }
  }

  async function addAll() {
    if (!parsed || step === "adding") return;
    setStep("adding");
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/clients/import-roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, people: parsed.rows.map((r) => ({ name: r.name, email: r.email })) }),
      });
    } catch {
      // The request may have reached the server and created people even though no answer came back: never offer a blind retry (it could add everyone twice).
      setStep("uncertain");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.ok && data && Array.isArray(data.results)) {
      setResults(data.results);
      setStep("done");
      router.refresh();
      onAdded?.();
      return;
    }
    if (res.status >= 400 && res.status < 500 && data?.error) {
      // Refused before anything was made (not signed in, too many tries, a bad list): safe to fix and try again.
      setError(data.error);
      setStep("preview");
      return;
    }
    setStep("uncertain");
    router.refresh();
  }

  const addedIds = results.filter((r) => r.ok && r.profileId).map((r) => r.profileId as string);

  async function undo() {
    if (undoing || addedIds.length === 0) return;
    if (!(await confirmDialog({ message: `Undo this import? The ${addedIds.length} ${addedIds.length === 1 ? "person" : "people"} just added will be removed, as long as none of them has signed in.`, confirmLabel: "Undo import", destructive: true }))) return;
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/import-roster/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, profileIds: addedIds }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't undo the import. Try again.");
      setUndone({ removed: (data.removed ?? []).length, left: (data.left ?? []).map((l: { reason: string }) => l.reason) });
      router.refresh();
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't undo the import. Try again.");
    } finally {
      setUndoing(false);
    }
  }

  const skippedList = parsed && parsed.skipped.length > 0 && (
    <div className="mb-3">
      <p className="font-body text-xs text-rust mb-1">
        {parsed.skipped.length} line{parsed.skipped.length === 1 ? " was" : "s were"} not used. Fix {parsed.skipped.length === 1 ? "it" : "them"} and add {parsed.skipped.length === 1 ? "it" : "them"} again if you want {parsed.skipped.length === 1 ? "it" : "them"}.
      </p>
      <div className="max-h-36 overflow-y-auto border border-steel/20">
        {parsed.skipped.slice(0, 50).map((s) => (
          <p key={s.rowNumber} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
            Line {s.rowNumber}: {s.detail}
          </p>
        ))}
      </div>
    </div>
  );

  if (step === "uncertain") {
    return (
      <div>
        <p className="font-body text-sm text-chalk">We could not confirm whether these {t("client", "plural")} were added.</p>
        <p className="font-body text-xs text-steel mt-1.5">Check your {t("client", "plural")} list for the names before adding them again, so no one is added twice.</p>
        <button type="button" onClick={onClose} className="mt-3 h-11 px-4 bg-rust text-graphite font-body text-sm font-medium">
          Close
        </button>
      </div>
    );
  }

  if (step === "done") {
    const failed = results.filter((r) => !r.ok);
    return (
      <div>
        {undone ? (
          <p className="font-body text-sm text-chalk">
            Import undone: {undone.removed} removed.
            {undone.left.length > 0 ? ` ${undone.left.length} stayed: ${Array.from(new Set(undone.left)).join(" ")}` : ""}
          </p>
        ) : (
          <p className="font-body text-sm text-positive">
            {addedIds.length} added to {groupName}. Nothing was sent to them.
          </p>
        )}
        {failed.length > 0 && (
          <div className="mt-2">
            <p className="font-body text-xs text-rust mb-1">{failed.length} not added:</p>
            <div className="max-h-36 overflow-y-auto border border-steel/20">
              {failed.map((f, i) => (
                <p key={i} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
                  {f.name ? `${f.name}: ` : ""}
                  {f.reason}
                </p>
              ))}
            </div>
          </div>
        )}
        {!undone && <p className="font-body text-xs text-steel mt-2">Build their programs and schedules now. When you&apos;re ready, send each sign-in link from their profile.</p>}
        {/* Anyone who also signs up with this group&apos;s invite link would become a second person, so each person gets their own sign-in link (not the group link). */}
        {!undone && addedIds.length > 0 && <p className="font-body text-xs text-steel mt-2">These people now have accounts. Send each one their own sign-in link from their profile. If they use the group&apos;s invite link instead, they will be added a second time.</p>}
        {error && (
          <p className="font-body text-xs text-rust mt-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-4 mt-3">
          <button type="button" onClick={onClose} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium">
            Done
          </button>
          {!undone && addedIds.length > 0 && (
            <button type="button" onClick={undo} disabled={undoing} className="font-body text-xs text-rust disabled:opacity-40">
              {undoing ? "Undoing…" : "Undo this import"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if ((step === "preview" || step === "adding") && parsed) {
    return (
      <div>
        <p className="font-body text-sm text-chalk mb-2">
          Add {parsed.rows.length} {parsed.rows.length === 1 ? "person" : "people"} to {groupName}? Nothing is sent to them.
        </p>
        {parsed.repeatedNames.length > 0 && <p className="font-body text-xs text-steel mb-2">The same name appears more than once ({parsed.repeatedNames.slice(0, 5).join(", ")}). That is fine if they are different people.</p>}
        {skippedList}
        <div className="max-h-48 overflow-y-auto border border-steel/20 mb-3">
          {parsed.rows.slice(0, 50).map((r) => (
            <p key={r.rowNumber} className="font-body text-xs text-steel px-2 py-1 border-b border-steel/10 last:border-b-0">
              {r.name}
              {r.email ? ` — ${r.email}` : " — no email yet"}
            </p>
          ))}
          {parsed.rows.length > 50 && <p className="font-body text-xs text-steel px-2 py-1">…and {parsed.rows.length - 50} more</p>}
        </div>
        {error && (
          <p className="font-body text-xs text-rust mb-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={addAll} disabled={step === "adding"} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {step === "adding" ? "Adding…" : `Add ${parsed.rows.length}`}
          </button>
          <button type="button" onClick={() => setStep("enter")} disabled={step === "adding"} className="font-body text-xs text-steel disabled:opacity-40">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="roster-text" className="font-body text-xs text-steel">
        Paste names, one per line. Put an email after a comma if you have it. Up to {ROSTER_MAX_ROWS} at a time.
      </label>
      <textarea id="roster-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Jane Smith, jane@example.com\nMo Ali"} className={inputClass} />
      <div className="flex items-center gap-3 mt-3">
        <button type="button" onClick={() => preview(splitPastedRoster(text))} disabled={!text.trim()} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          Preview
        </button>
        <label className="font-body text-xs text-steel underline cursor-pointer">
          or choose a .csv / .xlsx file
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
        </label>
        <button type="button" onClick={onClose} className="font-body text-xs text-steel">
          Cancel
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
      {skippedList}
    </div>
  );
}
