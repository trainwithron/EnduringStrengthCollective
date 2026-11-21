"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { checked } from "@/lib/checked-write";
import { showSaveFailed } from "@/lib/save-failed";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { demoThumbPath } from "@/lib/exercise-demo";
import { cleanMachineName, machineScanPath, type MachineRow } from "@/lib/gym-machines";
import { ExercisePickOrAdd } from "./exercise-pick-or-add";
import { ScanQrCodeButton } from "./exercise-qr-code-button";
import type { LibraryExerciseRow } from "./exercise-library-list";
import { MachineCatalogSection, useMachineCatalog } from "./machine-catalog-section";
import { useSignedVideoUrls } from "./use-signed-video-urls";
import { MACHINE_DEMOS_BUCKET, catalogDemo, type CatalogItem } from "@/lib/machine-catalog";

// Machines in the exercise library (Ron, Nov 19: "on a machine I could put a QR code and it'll show you all of the exercise variations for that machine ... Viking press, unilateral Viking
// press, shrugs ... Z press"; "i need to obiously be able to add excercises by machine in the excercise library also"). Add a machine by name, open it, add exercises from the library (or a
// new one right there), remove one, rename or delete the machine, and print its QR code (/scan/machine/<id>: every exercise on it, each opening its own scan page). Phone and computer alike.
export function GymMachinesPanel({
  coachId,
  orgId = null,
  initialMachines,
  exercises,
  isAdmin = false,
}: {
  coachId: string;
  // The platform admin (Ron): their additions to the shared machine list go on it at once, and they review everyone else's.
  isAdmin?: boolean;
  // The workspace's organization: the gym shown on the machine's QR page (null in a coach's own space).
  orgId?: string | null;
  initialMachines: MachineRow[];
  exercises: LibraryExerciseRow[];
}) {
  const [machines, setMachines] = useState(initialMachines);
  const [library, setLibrary] = useState(exercises);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The shared machine list (migration 0453); null before that database step, and then only the coach's own machines show.
  const { catalog, reload } = useMachineCatalog();
  const catalogItems = new Map<string, CatalogItem>((catalog ?? []).flatMap((m) => m.items.map((i) => [i.id, i] as [string, CatalogItem])));

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = cleanMachineName(newName);
    if (!cleaned.ok) return setError(cleaned.error);
    setBusy(true);
    setError(null);
    const { data, error: insertError } = await createBrowserClient().from("gym_machines").insert({ created_by: coachId, organization_id: orgId, name: cleaned.name }).select("id, name").single();
    setBusy(false);
    if (insertError || !data) return setError("Couldn't add the machine. Try again.");
    const row = data as { id: string; name: string };
    setMachines((prev) => [...prev, { id: row.id, name: row.name, exerciseIds: [], nextPos: 0 }]);
    setNewName("");
    setOpenId(row.id);
  }

  return (
    <div className="space-y-6" data-gym-machines>
      <p className="font-body text-sm text-steel max-w-[65ch]">
        Put a QR code on a machine. Scanning it lists every exercise done on that machine, and each one opens its own demo and logging.
      </p>

      {catalog && (
        <MachineCatalogSection
          coachId={coachId}
          orgId={orgId}
          isAdmin={isAdmin}
          catalog={catalog}
          reload={reload}
          machines={machines}
          library={library}
          onAdded={(machine, rows) => {
            setLibrary((prev) => [...prev, ...rows]);
            setMachines((prev) => [...prev, machine]);
            setOpenId(machine.id);
          }}
        />
      )}

      <h2 className="font-display font-bold uppercase text-base">Your machines</h2>
      <form onSubmit={addMachine} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Machine name"
          type="text"
          value={newName}
          maxLength={120}
          onChange={(e) => {
            setNewName(e.target.value);
            setError(null);
          }}
          placeholder="Machine name, for example Viking press"
          className="flex-1 min-w-0 basis-56 h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <button type="submit" disabled={busy} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Adding…" : "Add a machine"}
        </button>
      </form>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}

      {machines.length === 0 ? (
        <p className="font-body text-sm text-steel">No machines yet.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border-y border-steel/15">
          {machines.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
                aria-expanded={openId === m.id}
                className="w-full min-h-12 py-2 flex items-center justify-between gap-3 text-left"
              >
                <span className="font-body text-[15px] font-medium text-chalk break-words min-w-0">{m.name}</span>
                <span className="font-body text-xs text-steel shrink-0">
                  {m.exerciseIds.length} {m.exerciseIds.length === 1 ? "exercise" : "exercises"}
                </span>
              </button>
              {openId === m.id && (
                <MachineEditor
                  key={m.id}
                  coachId={coachId}
                  machine={m}
                  library={library}
                  catalogItems={catalogItems}
                  onLibraryAdd={(row) => setLibrary((prev) => [...prev, row])}
                  onChange={(next) => setMachines((prev) => prev.map((x) => (x.id === next.id ? next : x)))}
                  onDeleted={() => {
                    setMachines((prev) => prev.filter((x) => x.id !== m.id));
                    setOpenId(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MachineEditor({
  coachId,
  machine,
  library,
  catalogItems,
  onLibraryAdd,
  onChange,
  onDeleted,
}: {
  coachId: string;
  machine: MachineRow;
  library: LibraryExerciseRow[];
  // The shared list's exercises by id: a machine added from the list shows their demos (read live), else the coach's own.
  catalogItems: Map<string, CatalogItem>;
  onLibraryAdd: (row: LibraryExerciseRow) => void;
  onChange: (next: MachineRow) => void;
  onDeleted: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(machine.name);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(library.map((e) => [e.id, e]));
  const rows = machine.exerciseIds.map((id) => byId.get(id)).filter((e): e is LibraryExerciseRow => !!e);
  const sharedDemo = (row: LibraryExerciseRow) => catalogDemo(catalogItems.get(machine.catalogItemByExercise?.[row.id] ?? ""));
  const videoUrls = useSignedVideoUrls(rows.filter((r) => !sharedDemo(r)).map((r) => r.videoPath).filter((p): p is string => !!p));
  const sharedVideoUrls = useSignedVideoUrls(
    rows.map((r) => sharedDemo(r)).flatMap((d) => (d?.kind === "video" ? [d.path] : [])),
    MACHINE_DEMOS_BUCKET,
  );

  async function rename() {
    const cleaned = cleanMachineName(name);
    if (!cleaned.ok) return setError(cleaned.error);
    setBusy(true);
    setError(null);
    const ok = await savedRows(createBrowserClient().from("gym_machines").update({ name: cleaned.name }).eq("id", machine.id).select("id"), "Couldn't rename the machine.");
    setBusy(false);
    if (!ok) return;
    onChange({ ...machine, name: cleaned.name });
    setRenaming(false);
  }

  async function remove() {
    if (!(await confirmDialog({ message: `Delete ${machine.name}? Its QR code stops working. The exercises stay in your library.`, confirmLabel: "Delete machine", destructive: true }))) return;
    setBusy(true);
    const ok = await savedRows(createBrowserClient().from("gym_machines").delete().eq("id", machine.id).select("id"), "Couldn't delete the machine.");
    setBusy(false);
    if (ok) onDeleted();
  }

  async function addExercise(row: LibraryExerciseRow) {
    if (machine.exerciseIds.includes(row.id)) return;
    setBusy(true);
    const ok = await saved(
      createBrowserClient().from("gym_machine_exercises").insert({ machine_id: machine.id, exercise_id: row.id, position: machine.nextPos }),
      "Couldn't add that exercise to the machine.",
    );
    setBusy(false);
    if (ok) onChange({ ...machine, exerciseIds: [...machine.exerciseIds, row.id], nextPos: machine.nextPos + 1 });
  }

  async function removeExercise(row: LibraryExerciseRow) {
    setBusy(true);
    const ok = await savedRows(createBrowserClient().from("gym_machine_exercises").delete().eq("machine_id", machine.id).eq("exercise_id", row.id).select("machine_id"), "Couldn't take that exercise off the machine.");
    setBusy(false);
    if (ok) onChange({ ...machine, exerciseIds: machine.exerciseIds.filter((id) => id !== row.id) });
  }

  return (
    <div className="pb-4 space-y-4" data-machine-editor>
      <div className="flex flex-wrap items-center gap-2">
        <ScanQrCodeButton path={machineScanPath(machine.id)} name={machine.name} what="machine" label="QR code" />
        {renaming ? (
          <>
            <input
              aria-label="New machine name"
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-0 basis-40 h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
            />
            <button type="button" onClick={() => void rename()} disabled={busy} className="min-h-11 px-3 bg-rust text-graphite font-body text-sm disabled:opacity-40">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setName(machine.name);
                setError(null);
              }}
              className="min-h-11 px-2 font-body text-sm text-steel"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setRenaming(true)} className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-sm">
              Rename
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-11 px-3 font-body text-sm text-rust-ink disabled:opacity-40">
              Delete machine
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
      {machine.catalogMachineId && (
        <p className="font-body text-xs text-steel" data-linked-machine>
          From the shared machine list: its demos come from the list, so a new or better video shows here on its own.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="font-body text-sm text-steel">No exercises on this machine yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 border border-steel/15 bg-surface/40 p-2">
              {(() => {
                const shared = sharedDemo(row);
                if (shared) return <DemoThumb videoUrl={shared.kind === "video" ? (sharedVideoUrls[shared.path] ?? null) : null} youtubeThumb={shared.kind === "youtube" ? demoThumbPath(shared.url) : null} />;
                return <DemoThumb videoUrl={row.videoPath ? (videoUrls[row.videoPath] ?? null) : null} youtubeThumb={demoThumbPath(row.youtubeUrl)} />;
              })()}
              <span className="flex-1 min-w-0 font-body text-sm text-chalk break-words">{row.name}</span>
              <button
                type="button"
                onClick={() => void removeExercise(row)}
                disabled={busy}
                aria-label={`Take ${row.name} off ${machine.name}`}
                className="w-11 h-11 shrink-0 flex items-center justify-center text-steel hover:text-rust-ink disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {adding ? (
        <div className="border border-rust/40 bg-surface p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-display font-bold uppercase text-sm">Add an exercise</p>
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 px-2 font-body text-sm text-steel">
              Done
            </button>
          </div>
          <ExercisePickOrAdd
            coachId={coachId}
            exercises={library}
            excludeIds={new Set(machine.exerciseIds)}
            onPick={(row) => void addExercise(row)}
            onExerciseAdded={onLibraryAdd}
            placeholder="Type an exercise to search or add"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full min-h-11 border border-steel/30 text-chalk font-body text-sm active:border-rust">
          + Add an exercise to this machine
        </button>
      )}
    </div>
  );
}

// A rename or delete that row security quietly turns into "0 rows changed" is not done: it must come back with the row (lib/checked-write.ts expectRows), else the shared bar says so.
async function savedRows(operation: PromiseLike<{ data?: unknown; error?: { message?: string } | null }>, message: string): Promise<boolean> {
  const result = await checked(operation, { expectRows: true, message });
  if (!result.ok) showSaveFailed(result.error ?? message);
  return result.ok;
}

// The exercise's demo as a small picture: an uploaded video's first frame, a YouTube video's thumbnail (through our own server), or a plain play tile.
function DemoThumb({ videoUrl, youtubeThumb }: { videoUrl: string | null; youtubeThumb: string | null }) {
  if (videoUrl) return <video src={`${videoUrl}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" className="w-16 h-11 object-cover bg-graphite shrink-0" />;
  // eslint-disable-next-line @next/next/no-img-element -- our own thumbnail route
  if (youtubeThumb) return <img src={youtubeThumb} alt="" className="w-16 h-11 object-cover bg-graphite shrink-0" />;
  return (
    <span aria-hidden="true" className="w-16 h-11 shrink-0 bg-graphite flex items-center justify-center text-steel">
      <Play className="w-4 h-4" />
    </span>
  );
}

