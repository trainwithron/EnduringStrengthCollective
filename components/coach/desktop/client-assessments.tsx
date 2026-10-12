"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

export interface AssessmentRow {
  id: string;
  title: string;
  notes: string;
  measurements: string;
  filePath: string | null;
  fileName: string | null;
  createdAt: string;
}

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/|video\/)/;

// Assessments the coach attaches to a client's profile: a title, notes, optional numbers and one file (a PDF, photo or video). They are the coach's working records: only the coaches of this
// client's group can see them. Nothing here is shown to the client.
export function ClientAssessments({ groupId, athleteId, initial }: { groupId: string; athleteId: string; initial: AssessmentRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [measurements, setMeasurements] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!title.trim() || busy) return;
    if (file && (!ALLOWED.test(file.type) || file.size > MAX_FILE_BYTES)) {
      setError("Attach a PDF, a photo or a video up to 200 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    let path: string | null = null;
    if (file) {
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      path = `${groupId}/${athleteId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("client-assessments").upload(path, file, { contentType: file.type });
      if (uploadError) {
        setBusy(false);
        setError("The file didn't upload. Nothing was saved. Try again.");
        return;
      }
    }
    const { data, error: insertError } = await supabase
      .from("client_assessments")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        title: title.trim(),
        notes: notes.trim() || null,
        measurements: measurements.trim() || null,
        file_path: path,
        file_name: file ? file.name.slice(0, 200) : null,
        created_by: user.id,
      })
      .select("id, created_at")
      .single();
    if (insertError || !data) {
      if (path) await supabase.storage.from("client-assessments").remove([path]);
      setBusy(false);
      setError("That didn't save. Nothing was added. Try again.");
      return;
    }
    setRows((prev) => [{ id: data.id, title: title.trim(), notes: notes.trim(), measurements: measurements.trim(), filePath: path, fileName: file ? file.name : null, createdAt: data.created_at }, ...prev]);
    setTitle("");
    setNotes("");
    setMeasurements("");
    setFile(null);
    setBusy(false);
    router.refresh();
  }

  async function openFile(row: AssessmentRow) {
    if (!row.filePath) return;
    const { data } = await createBrowserClient().storage.from("client-assessments").createSignedUrl(row.filePath, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    else setError("Couldn't open that file. Try again.");
  }

  async function remove(row: AssessmentRow) {
    if (!(await confirmDialog({ message: `Delete "${row.title}"? The file is deleted too.`, confirmLabel: "Delete" }))) return;
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("client_assessments").delete().eq("id", row.id);
    if (deleteError) {
      setError("That didn't delete. Try again.");
      return;
    }
    if (row.filePath) await supabase.storage.from("client-assessments").remove([row.filePath]);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  return (
    <div>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">Assessments</h2>
      <p className="font-body text-xs text-steel mb-3">Your own assessments for this client: notes, numbers and a file. Only you and the other coaches of this group can see them; the client cannot.</p>

      {rows.length === 0 ? (
        <p className="font-body text-sm text-steel mb-4">None yet.</p>
      ) : (
        <ul className="divide-y divide-steel/15 mb-4">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-body text-sm font-medium">{r.title}</p>
                  <p className="font-body text-xs text-steel">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
                <button type="button" onClick={() => remove(r)} className="min-h-11 px-2 font-body text-xs text-steel active:text-rust">
                  Delete
                </button>
              </div>
              {r.notes && <p className="font-body text-sm text-chalk mt-1 whitespace-pre-wrap">{r.notes}</p>}
              {r.measurements && <p className="font-body text-xs text-steel mt-1 whitespace-pre-wrap">{r.measurements}</p>}
              {r.filePath && (
                <button type="button" onClick={() => openFile(r)} className="mt-1 min-h-11 font-body text-sm text-rust underline underline-offset-2">
                  Open {r.fileName ?? "file"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border border-steel/20 p-3 space-y-2 max-w-lg">
        <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Movement screen, October)" aria-label="Assessment title" className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm" />
        <textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" aria-label="Assessment notes" rows={3} className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm" />
        <input type="text" value={measurements} maxLength={1000} onChange={(e) => setMeasurements(e.target.value)} placeholder="Numbers (optional, e.g. Dorsiflexion 8 cm)" aria-label="Assessment numbers" className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm" />
        <label className="flex min-h-11 items-center gap-2 font-body text-sm text-steel cursor-pointer">
          <span className="border border-steel/30 px-3 py-2">{file ? file.name : "Attach a PDF, photo or video (optional)"}</span>
          <input type="file" accept="application/pdf,image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
        {error && (
          <p className="font-body text-xs text-rust" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={add} disabled={busy || !title.trim()} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40">
          {busy ? "Saving…" : "Add assessment"}
        </button>
      </div>
    </div>
  );
}
