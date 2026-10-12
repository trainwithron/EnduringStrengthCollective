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

// One plain section on a client's profile: a list, and an Add button that attaches a file, a note, or both. Visible to the coaches of the group and the organization's owner; never the client.
export function ClientAssessments({ groupId, athleteId, initial }: { groupId: string; athleteId: string; initial: AssessmentRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const note = notes.trim();
    if ((!note && !file) || busy) return;
    if (file && (!ALLOWED.test(file.type) || file.size > MAX_FILE_BYTES)) {
      setError("Use a PDF, photo or video under 200 MB.");
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
        setError("The file didn't upload. Try again.");
        return;
      }
    }
    // The title is the first words of the note, else the file name.
    const title = (note ? note.split("\n")[0] : (file?.name ?? "Assessment")).slice(0, 80) || "Assessment";
    const { data, error: insertError } = await supabase
      .from("client_assessments")
      .insert({ athlete_id: athleteId, group_id: groupId, title, notes: note || null, file_path: path, file_name: file ? file.name.slice(0, 200) : null, created_by: user.id })
      .select("id, created_at")
      .single();
    if (insertError || !data) {
      if (path) await supabase.storage.from("client-assessments").remove([path]);
      setBusy(false);
      setError("That didn't save. Try again.");
      return;
    }
    setRows((prev) => [{ id: data.id, title, notes: note, measurements: "", filePath: path, fileName: file ? file.name : null, createdAt: data.created_at }, ...prev]);
    setNotes("");
    setFile(null);
    setAdding(false);
    setBusy(false);
    router.refresh();
  }

  async function openFile(row: AssessmentRow) {
    if (!row.filePath) return;
    const { data } = await createBrowserClient().storage.from("client-assessments").createSignedUrl(row.filePath, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    else setError("Couldn't open that file.");
  }

  async function remove(row: AssessmentRow) {
    if (!(await confirmDialog({ message: "Delete this assessment?", confirmLabel: "Delete" }))) return;
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
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Assessments</h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 px-3 font-body text-sm text-rust underline underline-offset-2">
            Add
          </button>
        )}
      </div>

      {adding && (
        <div className="border border-steel/20 p-3 space-y-2 max-w-lg mb-3">
          <textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Note" aria-label="Assessment note" rows={3} className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm" />
          <label className="flex min-h-11 items-center font-body text-sm text-steel cursor-pointer">
            <span className="border border-steel/30 px-3 py-2">{file ? file.name : "Attach a file"}</span>
            <input type="file" accept="application/pdf,image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
          </label>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy || (!notes.trim() && !file)} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 disabled:opacity-40">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => { setAdding(false); setError(null); }} className="min-h-11 px-3 font-body text-sm text-steel">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!adding && error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        !adding && <p className="font-body text-sm text-steel">None yet.</p>
      ) : (
        <ul className="divide-y divide-steel/15">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-body text-xs text-steel">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                <button type="button" onClick={() => remove(r)} className="min-h-11 px-2 font-body text-xs text-steel active:text-rust">
                  Delete
                </button>
              </div>
              {r.notes && <p className="font-body text-sm text-chalk whitespace-pre-wrap">{r.notes}</p>}
              {r.filePath && (
                <button type="button" onClick={() => openFile(r)} className="min-h-11 font-body text-sm text-rust underline underline-offset-2">
                  {r.fileName ?? "Open file"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
