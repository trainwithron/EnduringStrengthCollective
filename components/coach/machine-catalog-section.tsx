"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, Video, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { checked } from "@/lib/checked-write";
import { bestEffort } from "@/lib/saved";
import { showSaveFailed } from "@/lib/save-failed";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { demoThumbPath } from "@/lib/exercise-demo";
import { demoContentType, demoExtension, uploadDemo } from "@/lib/exercise-demo-upload";
import { prepareDemo } from "@/lib/demo-convert";
import { MACHINE_NAME_MAX, type MachineRow } from "@/lib/gym-machines";
import {
  CATALOG_SELECT,
  MACHINE_DEMOS_BUCKET,
  REQUEST_SELECT,
  catalogDemo,
  catalogFromRows,
  catalogMachineName,
  catalogYoutubeLink,
  cleanMachineRequest,
  planAddToGym,
  requestFromRow,
  requestStatusLabel,
  requestSummary,
  searchCatalog,
  type CatalogItem,
  type CatalogMachine,
  type CatalogRequestRow,
} from "@/lib/machine-catalog";
import { useSignedVideoUrls } from "./use-signed-video-urls";
import type { LibraryExerciseRow } from "./exercise-library-list";

// The shared machine list in the Machines tab (Ron, Nov 19: "a master shared machine list, but I definitely want to be the one that has the final say... someone wants to add it to the
// public... send a request and I could approve or deny it depending on the video quality"). Search it, add a machine to your gym (linked, so its demos come from the list live), send a
// new machine or a demo for Ron to review, and see what came of each request. The platform admin's own additions go on the list at once; everyone else's wait for review.

// The shared list, read once when the tab opens. null: not available (before the database step, or a failed read): the section is not shown and the coach's own machines work as before.
export function useMachineCatalog(): { catalog: CatalogMachine[] | null; reload: () => Promise<void> } {
  const [catalog, setCatalog] = useState<CatalogMachine[] | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await createBrowserClient().from("catalog_machines").select(CATALOG_SELECT).order("brand").order("model").limit(1000);
    if (error) return;
    setCatalog(catalogFromRows((data ?? []) as never));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { catalog, reload };
}

export function MachineCatalogSection({
  coachId,
  orgId,
  isAdmin,
  catalog,
  reload,
  machines,
  library,
  onAdded,
}: {
  coachId: string;
  orgId: string | null;
  isAdmin: boolean;
  catalog: CatalogMachine[];
  reload: () => Promise<void>;
  machines: MachineRow[];
  library: LibraryExerciseRow[];
  onAdded: (machine: MachineRow, newLibraryRows: LibraryExerciseRow[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState<{ brand: string; model: string } | null>(null);
  const [requests, setRequests] = useState<CatalogRequestRow[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    const supabase = createBrowserClient();
    if (isAdmin) {
      const { count } = await supabase.from("catalog_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      setPendingCount(count ?? 0);
      return;
    }
    const { data, error } = await supabase.from("catalog_requests").select(REQUEST_SELECT).eq("submitted_by", coachId).order("created_at", { ascending: false }).limit(50);
    if (!error) setRequests(((data ?? []) as Parameters<typeof requestFromRow>[0][]).map(requestFromRow));
  }, [coachId, isAdmin]);
  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const results = searchCatalog(catalog, query);
  const inGym = new Set(machines.map((m) => m.catalogMachineId).filter((id): id is string => !!id));
  const itemLabel = (itemId: string) => {
    for (const m of catalog) {
      const item = m.items.find((i) => i.id === itemId);
      if (item) return `${item.name} on ${catalogMachineName(m)}`;
    }
    return null;
  };

  async function addToGym(m: CatalogMachine) {
    setBusyId(m.id);
    setMessage(null);
    const result = await addCatalogMachineToGym({ coachId, orgId, machine: m });
    setBusyId(null);
    if (!result.ok) return showSaveFailed(result.error);
    onAdded(result.machine, result.newLibraryRows);
    setMessage(`${catalogMachineName(m)} is in your machines below, with its QR code.`);
  }

  async function sent(text: string) {
    setMessage(text);
    await Promise.all([reload(), loadRequests()]);
  }

  return (
    <section className="border border-steel/20 p-3 sm:p-4 space-y-4" data-machine-catalog>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display font-bold uppercase text-base">Shared machine list</h2>
          <p className="font-body text-sm text-steel mt-1 max-w-[60ch]">Machines from gyms on Spotlight, each with its exercises and demos. Add one to your gym in one tap.</p>
        </div>
        {isAdmin && (
          <Link href="/admin/machine-catalog" className="min-h-11 px-3 inline-flex items-center border border-rust/60 text-chalk font-body text-sm shrink-0" data-review-requests>
            Review requests{pendingCount ? ` (${pendingCount})` : ""}
          </Link>
        )}
      </div>

      <input
        aria-label="Search the shared machine list"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setMessage(null);
        }}
        placeholder="Search, for example Viking press or Hammer Strength"
        className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
      />

      {query.trim() !== "" &&
        (results.length === 0 ? (
          <div className="space-y-2">
            <p className="font-body text-sm text-steel">Not on the shared list yet.</p>
            <button type="button" onClick={() => setSuggesting({ brand: "", model: query.trim() })} className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-sm">
              {isAdmin ? "Add it to the shared list" : "Send it for the shared list"}
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-steel/15 border-y border-steel/15" data-catalog-results>
            {results.map((m) => (
              <li key={m.id} className="py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
                    aria-expanded={openId === m.id}
                    className="flex-1 min-w-0 min-h-11 text-left"
                  >
                    <span className="block font-body text-[15px] font-medium text-chalk break-words">{catalogMachineName(m)}</span>
                    <span className="block font-body text-xs text-steel">
                      {m.items.length} {m.items.length === 1 ? "exercise" : "exercises"}
                    </span>
                  </button>
                  {inGym.has(m.id) ? (
                    <span className="font-body text-xs text-positive shrink-0 px-2">In your gym</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void addToGym(m)}
                      disabled={busyId !== null || m.items.length === 0}
                      className="min-h-11 px-3 bg-rust text-graphite font-body text-sm font-medium shrink-0 disabled:opacity-40"
                    >
                      {busyId === m.id ? "Adding…" : "Add to my gym"}
                    </button>
                  )}
                </div>
                {openId === m.id && (
                  <CatalogMachineDetail
                    machine={m}
                    coachId={coachId}
                    isAdmin={isAdmin}
                    library={library}
                    onSent={sent}
                    onSuggestMore={() => setSuggesting({ brand: m.brand, model: m.model })}
                    onChanged={reload}
                  />
                )}
              </li>
            ))}
          </ul>
        ))}

      {message && (
        <p className="font-body text-sm text-positive" role="status">
          {message}
        </p>
      )}

      {suggesting ? (
        <MachineRequestForm
          key={`${suggesting.brand}|${suggesting.model}`}
          isAdmin={isAdmin}
          initialBrand={suggesting.brand}
          initialModel={suggesting.model}
          onCancel={() => setSuggesting(null)}
          onSent={async (text) => {
            setSuggesting(null);
            await sent(text);
          }}
        />
      ) : (
        <button type="button" onClick={() => setSuggesting({ brand: "", model: "" })} className="w-full min-h-11 border border-steel/30 text-chalk font-body text-sm active:border-rust">
          {isAdmin ? "+ Add a machine to the shared list" : "+ Send a machine for the shared list"}
        </button>
      )}

      {!isAdmin && requests.length > 0 && (
        <div data-my-catalog-requests>
          <h3 className="font-display font-bold uppercase text-sm">Your requests</h3>
          <ul className="mt-2 space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="border border-steel/15 p-2">
                <p className="font-body text-sm text-chalk break-words">{requestSummary(r, itemLabel)}</p>
                <p className={`font-body text-xs ${r.status === "approved" ? "text-positive" : r.status === "denied" ? "text-rust" : "text-steel"}`}>{requestStatusLabel(r.status)}</p>
                {r.reviewNote && <p className="font-body text-xs text-steel mt-1 break-words">Note from Spotlight: {r.reviewNote}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// One shared machine opened: its exercises with their demos, "Send a demo" on each (the admin's goes on the list at once), "Send more exercises", and for the admin, Remove.
function CatalogMachineDetail({
  machine,
  coachId,
  isAdmin,
  library,
  onSent,
  onSuggestMore,
  onChanged,
}: {
  machine: CatalogMachine;
  coachId: string;
  isAdmin: boolean;
  library: LibraryExerciseRow[];
  onSent: (text: string) => Promise<void>;
  onSuggestMore: () => void;
  onChanged: () => Promise<void>;
}) {
  const [demoFor, setDemoFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videos = useSignedVideoUrls(machine.items.map((i) => i.videoPath).filter((p): p is string => !!p), MACHINE_DEMOS_BUCKET);

  async function removeItem(item: CatalogItem) {
    if (!(await confirmDialog({ message: `Take ${item.name} off ${catalogMachineName(machine)} on the shared list? Gyms that added the machine keep the exercise as their own.`, confirmLabel: "Take it off", destructive: true }))) return;
    setBusy(true);
    const r = await checked(createBrowserClient().from("catalog_machine_exercises").delete().eq("id", item.id).select("id"), { expectRows: true, message: "Couldn't take that exercise off the shared list." });
    setBusy(false);
    if (!r.ok) return showSaveFailed(r.error ?? "Couldn't take that exercise off the shared list.");
    await onChanged();
  }

  async function removeMachine() {
    if (!(await confirmDialog({ message: `Take ${catalogMachineName(machine)} off the shared list? Gyms that added it keep it as their own machine.`, confirmLabel: "Take it off", destructive: true }))) return;
    setBusy(true);
    const r = await checked(createBrowserClient().from("catalog_machines").delete().eq("id", machine.id).select("id"), { expectRows: true, message: "Couldn't take that machine off the shared list." });
    setBusy(false);
    if (!r.ok) return showSaveFailed(r.error ?? "Couldn't take that machine off the shared list.");
    await onChanged();
  }

  return (
    <div className="mt-2 space-y-2" data-catalog-machine>
      <ol className="space-y-2">
        {machine.items.map((item) => {
          const demo = catalogDemo(item);
          return (
            <li key={item.id} className="border border-steel/15 bg-surface/40 p-2">
              <div className="flex items-center gap-3">
                <CatalogThumb videoUrl={demo?.kind === "video" ? (videos[demo.path] ?? null) : null} youtubeThumb={demo?.kind === "youtube" ? demoThumbPath(demo.url) : null} />
                <span className="flex-1 min-w-0 font-body text-sm text-chalk break-words">
                  {item.name}
                  {!demo && <span className="block font-body text-xs text-steel">No demo yet</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setDemoFor((id) => (id === item.id ? null : item.id))}
                  aria-expanded={demoFor === item.id}
                  className="min-h-11 px-2 font-body text-xs text-rust shrink-0"
                >
                  {isAdmin ? (demo ? "Change demo" : "Add demo") : "Send a demo"}
                </button>
                {isAdmin && (
                  <button type="button" onClick={() => void removeItem(item)} disabled={busy} aria-label={`Take ${item.name} off the shared list`} className="w-11 h-11 shrink-0 flex items-center justify-center text-steel hover:text-rust disabled:opacity-40">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {demoFor === item.id && (
                <DemoRequestForm
                  coachId={coachId}
                  isAdmin={isAdmin}
                  item={item}
                  machineName={catalogMachineName(machine)}
                  library={library}
                  onCancel={() => setDemoFor(null)}
                  onSent={async (text) => {
                    setDemoFor(null);
                    await onSent(text);
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onSuggestMore} className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-sm">
          {isAdmin ? "Add exercises" : "Send more exercises"}
        </button>
        {isAdmin && (
          <button type="button" onClick={() => void removeMachine()} disabled={busy} className="min-h-11 px-3 font-body text-sm text-rust disabled:opacity-40">
            Take off the shared list
          </button>
        )}
      </div>
    </div>
  );
}

function CatalogThumb({ videoUrl, youtubeThumb }: { videoUrl: string | null; youtubeThumb: string | null }) {
  if (videoUrl) return <video src={`${videoUrl}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" className="w-16 h-11 object-cover bg-graphite shrink-0" />;
  // eslint-disable-next-line @next/next/no-img-element -- our own thumbnail route
  if (youtubeThumb) return <img src={youtubeThumb} alt="" className="w-16 h-11 object-cover bg-graphite shrink-0" />;
  return (
    <span aria-hidden="true" className="w-16 h-11 shrink-0 bg-graphite flex items-center justify-center text-steel">
      <Play className="w-4 h-4" />
    </span>
  );
}

// A request goes in; the platform admin's is approved at once (the same server-checked review, so it is on the list straight away).
async function sendRequest(row: Record<string, unknown>, isAdmin: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase.from("catalog_requests").insert(row).select("id").single();
  if (error || !data) {
    return { ok: false, error: /50 requests waiting/.test(error?.message ?? "") ? "You have 50 requests waiting for review. Wait for those, then send more." : "Couldn't send that. Try again." };
  }
  if (!isAdmin) return { ok: true };
  const { error: reviewError } = await supabase.rpc("review_catalog_request", { p_request_id: (data as { id: string }).id, p_approve: true, p_note: null });
  if (reviewError) return { ok: false, error: "It was saved as a request but not put on the list. Approve it from Review requests." };
  return { ok: true };
}

const RIGHTS_LABEL = "I filmed this video and have the right to share it";
// Ron, Nov 20 (S4): the person on camera, not only the filmer, agreed (a client, possibly a minor, could be in a video every gym sees). Required for a filmed video, with its own
// column (catalog_requests.subject_consent, step 211). A YouTube link plays from its owner's channel, so it gets its own wording instead of "I filmed this".
const CONSENT_LABEL = "Everyone shown agreed to be filmed and shared; anyone under 18 has a parent's OK";
const LINK_RIGHTS_LABEL = "This is my video, or I have the right to share it";

// A demo for one exercise on a shared machine: a video recorded or chosen on the phone (into the coach's own folder of the private machine-demos bucket), or a YouTube link. The tick
// is required: only the coach's own filming, never a manufacturer's or someone else's video. The admin can also use one of their own existing demos instead of uploading it again.
function DemoRequestForm({
  coachId,
  isAdmin,
  item,
  machineName,
  library,
  onCancel,
  onSent,
}: {
  coachId: string;
  isAdmin: boolean;
  item: CatalogItem;
  machineName: string;
  library: LibraryExerciseRow[];
  onCancel: () => void;
  onSent: (text: string) => Promise<void>;
}) {
  const [rights, setRights] = useState(false);
  const [consent, setConsent] = useState(false);
  const [linkRights, setLinkRights] = useState(false);
  const [link, setLink] = useState("");
  const [mine, setMine] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<"convert" | "upload" | "send">("upload");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const myDemos = isAdmin ? library.filter((e) => e.videoPath || (e.youtubeUrl && e.youtubeUrl.trim())) : [];
  const working = progress != null;
  const done = isAdmin ? `The demo for ${item.name} is on the shared list.` : `Sent. Spotlight reviews the demo for ${item.name}; you'll see the answer under Your requests.`;

  // A filmed video: both ticks. A YouTube link: its own one.
  function needRights(): boolean {
    if (!rights) {
      setError(`Tick "${RIGHTS_LABEL}" first.`);
      return false;
    }
    if (!consent) {
      setError(`Tick "${CONSENT_LABEL}" first.`);
      return false;
    }
    return true;
  }
  function needLinkRights(): boolean {
    if (linkRights) return true;
    setError(`Tick "${LINK_RIGHTS_LABEL}" first.`);
    return false;
  }

  async function sendVideoPath(path: string) {
    setStage("send");
    const r = await sendRequest({ submitted_by: coachId, kind: "demo", item_id: item.id, video_path: path, rights_confirmed: true, subject_consent: true }, isAdmin);
    setProgress(null);
    if (!r.ok) return setError(r.error);
    await onSent(done);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked || !needRights()) return;
    setError(null);
    setStage("convert");
    setProgress(0);
    const prepared = await prepareDemo(picked, { mute: false, onProgress: setProgress });
    if (!prepared.ok) {
      setProgress(null);
      return setError(prepared.error);
    }
    const contentType = demoContentType(prepared.file)!;
    const supabase = createBrowserClient();
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setProgress(null);
      return setError("You're signed out. Sign in again, then try.");
    }
    setStage("upload");
    setProgress(0);
    const up = await uploadDemo({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      accessToken: token,
      path: `${coachId}/${crypto.randomUUID()}.${demoExtension(contentType)}`,
      file: prepared.file,
      contentType,
      onProgress: setProgress,
      bucket: MACHINE_DEMOS_BUCKET,
    });
    if (!up.ok) {
      setProgress(null);
      return setError(up.error);
    }
    await sendVideoPath(up.path);
  }

  async function sendLink() {
    if (!needLinkRights()) return;
    const url = catalogYoutubeLink(link);
    if (!url) return setError("Paste a YouTube video link, for example https://youtu.be/…");
    setError(null);
    setStage("send");
    setProgress(0);
    const r = await sendRequest({ submitted_by: coachId, kind: "demo", item_id: item.id, youtube_url: url, rights_confirmed: true }, isAdmin);
    setProgress(null);
    if (!r.ok) return setError(r.error);
    await onSent(done);
  }

  // The admin's own demo: a YouTube link is used as it is; an uploaded video is copied inside storage into the shared list's bucket (no upload from the phone again), so changing the
  // exercise's own demo later never takes it off the list.
  async function sendMine() {
    const row = myDemos.find((e) => e.id === mine);
    if (!row || !(row.videoPath ? needRights() : needLinkRights())) return;
    setError(null);
    setStage("send");
    setProgress(0);
    if (row.videoPath) {
      const ext = row.videoPath.split(".").pop()?.toLowerCase() || "mp4";
      const to = `${coachId}/${crypto.randomUUID()}.${ext}`;
      const { error: copyError } = await createBrowserClient().storage.from("exercise-media").copy(row.videoPath, to, { destinationBucket: MACHINE_DEMOS_BUCKET });
      if (copyError) {
        setProgress(null);
        return setError("Couldn't use that video. Try again, or record it.");
      }
      return sendVideoPath(to);
    }
    const url = catalogYoutubeLink(row.youtubeUrl ?? "");
    if (!url) {
      setProgress(null);
      return setError("That demo's link isn't a YouTube video link.");
    }
    const r = await sendRequest({ submitted_by: coachId, kind: "demo", item_id: item.id, youtube_url: url, rights_confirmed: true }, isAdmin);
    setProgress(null);
    if (!r.ok) return setError(r.error);
    await onSent(done);
  }

  return (
    <div className="mt-2 border border-rust/40 bg-surface p-3 space-y-3" data-demo-request>
      <div className="flex items-center justify-between gap-2">
        <p className="font-body text-sm text-chalk min-w-0 break-words">
          Demo for {item.name} on {machineName}
        </p>
        <button type="button" onClick={onCancel} disabled={working} className="min-h-11 px-2 font-body text-sm text-steel shrink-0 disabled:opacity-40">
          Cancel
        </button>
      </div>
      <label className="flex items-start gap-3 min-h-11 font-body text-sm text-chalk">
        <input
          type="checkbox"
          checked={rights}
          onChange={(e) => {
            setRights(e.target.checked);
            setError(null);
          }}
          className="w-5 h-5 mt-0.5 accent-rust shrink-0"
          data-rights-tick
        />
        <span>
          {RIGHTS_LABEL}
          <span className="block font-body text-xs text-steel">Your own filming only: no manufacturer videos or anyone else&apos;s.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 min-h-11 font-body text-sm text-chalk">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            setError(null);
          }}
          className="w-5 h-5 mt-0.5 accent-rust shrink-0"
          data-consent-tick
        />
        <span>
          {CONSENT_LABEL}
          <span className="block font-body text-xs text-steel">Every gym with this machine will see the video.</span>
        </span>
      </label>

      {working ? (
        <div role="status" aria-live="polite">
          <div className="h-2 bg-graphite overflow-hidden">
            <div className="h-full bg-rust transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <p className="font-body text-xs text-steel mt-1">
            {stage === "convert" ? "Making it 1080p" : stage === "upload" ? "Uploading" : "Sending"}… {stage === "send" ? "" : `${Math.round((progress ?? 0) * 100)}%. `}Keep this page open.
          </p>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => needRights() && fileRef.current?.click()} className="w-full h-12 bg-rust text-graphite font-body text-sm font-medium flex items-center justify-center gap-2">
            <Video className="w-4 h-4" aria-hidden />
            Record or choose video
          </button>
          <input ref={fileRef} type="file" accept="video/*" onChange={(e) => void handleFile(e)} className="sr-only" aria-label="Demo video" tabIndex={-1} />
          <p className="font-body text-xs text-steel">Up to 30 seconds.</p>
          <label className="flex items-start gap-3 min-h-11 font-body text-sm text-chalk pt-2 border-t border-steel/20">
            <input
              type="checkbox"
              checked={linkRights}
              onChange={(e) => {
                setLinkRights(e.target.checked);
                setError(null);
              }}
              className="w-5 h-5 mt-0.5 accent-rust shrink-0"
              data-link-rights-tick
            />
            <span>
              For a YouTube link: {LINK_RIGHTS_LABEL.charAt(0).toLowerCase() + LINK_RIGHTS_LABEL.slice(1)}
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="YouTube link"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Or paste a YouTube link"
              className="flex-1 min-w-0 basis-48 h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
            />
            <button type="button" onClick={() => void sendLink()} disabled={!link.trim()} className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              {isAdmin ? "Use link" : "Send link"}
            </button>
          </div>
          {myDemos.length > 0 && (
            <div className="flex flex-wrap gap-2" data-use-my-demo>
              <select
                aria-label="One of my demos"
                value={mine}
                onChange={(e) => setMine(e.target.value)}
                className="flex-1 min-w-0 basis-48 min-h-11 bg-graphite border border-steel/30 px-2 text-chalk font-body text-sm"
              >
                <option value="">Or use one of my demos</option>
                {myDemos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void sendMine()} disabled={!mine} className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
                Use it
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// A new machine (or more exercises for one already on the list): brand, model, and the exercises done on it, each one from the exercise catalog or a new name.
function MachineRequestForm({
  isAdmin,
  initialBrand,
  initialModel,
  onCancel,
  onSent,
}: {
  isAdmin: boolean;
  initialBrand: string;
  initialModel: string;
  onCancel: () => void;
  onSent: (text: string) => Promise<void>;
}) {
  const [brand, setBrand] = useState(initialBrand);
  const [model, setModel] = useState(initialModel);
  const [exercises, setExercises] = useState<{ name: string; catalogId: string | null }[]>([]);
  const [typed, setTyped] = useState("");
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void createBrowserClient()
      .from("exercise_catalog")
      .select("id, name")
      .order("name")
      .limit(2000)
      .then(({ data }) => setNames((data ?? []) as { id: string; name: string }[]));
  }, []);

  const q = typed.trim().toLowerCase();
  const taken = new Set(exercises.map((e) => e.name.toLowerCase()));
  const suggestions = q ? names.filter((n) => n.name.toLowerCase().includes(q) && !taken.has(n.name.toLowerCase())).slice(0, 6) : [];

  function add(name: string, catalogId: string | null) {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean || taken.has(clean.toLowerCase())) return setTyped("");
    const exact = catalogId ?? names.find((n) => n.name.toLowerCase() === clean.toLowerCase())?.id ?? null;
    setExercises((prev) => [...prev, { name: clean, catalogId: exact }]);
    setTyped("");
    setError(null);
  }

  async function send() {
    const cleaned = cleanMachineRequest({ brand, model, exercises });
    if (!cleaned.ok) return setError(cleaned.error);
    setBusy(true);
    setError(null);
    const r = await sendRequest({ kind: "machine", brand: cleaned.brand, model: cleaned.model, exercises: cleaned.exercises }, isAdmin);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const label = `${cleaned.brand} ${cleaned.model}`;
    await onSent(isAdmin ? `${label} is on the shared list.` : `Sent. Spotlight reviews ${label}; you'll see the answer under Your requests.`);
  }

  return (
    <div className="border border-rust/40 bg-surface p-3 space-y-3" data-machine-request>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-bold uppercase text-sm">{isAdmin ? "Add to the shared list" : "Send for the shared list"}</p>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 px-2 font-body text-sm text-steel disabled:opacity-40">
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="font-body text-xs text-steel">Brand</span>
          <input type="text" value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} placeholder="Bolt" className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust" />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel">Machine</span>
          <input type="text" value={model} maxLength={80} onChange={(e) => setModel(e.target.value)} placeholder="Viking Press" className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust" />
        </label>
      </div>
      <div>
        <p className="font-body text-xs text-steel">Exercises done on it, in order</p>
        {exercises.length > 0 && (
          <ol className="mt-1 space-y-1">
            {exercises.map((e, i) => (
              <li key={e.name} className="flex items-center gap-2 border border-steel/15 pl-2">
                <span className="flex-1 min-w-0 font-body text-sm text-chalk break-words">
                  {i + 1}. {e.name}
                </span>
                <button type="button" onClick={() => setExercises((prev) => prev.filter((x) => x.name !== e.name))} aria-label={`Remove ${e.name}`} className="w-11 h-11 shrink-0 flex items-center justify-center text-steel hover:text-rust">
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-2 flex gap-2">
          <input
            aria-label="Add an exercise"
            type="text"
            value={typed}
            maxLength={80}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(typed, null);
              }
            }}
            placeholder="Type an exercise, for example Viking Press"
            className="flex-1 min-w-0 h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
          />
          <button type="button" onClick={() => add(typed, null)} disabled={!typed.trim()} className="min-h-11 px-3 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
            Add
          </button>
        </div>
        {suggestions.length > 0 && (
          <ul className="mt-1 border border-steel/20 divide-y divide-steel/15">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => add(s.name, s.id)} className="w-full min-h-11 px-3 text-left font-body text-sm text-chalk">
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" onClick={() => void send()} disabled={busy} className="w-full min-h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
        {busy ? "Sending…" : isAdmin ? "Put it on the shared list" : "Send for review"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// "Add to my gym": the coach's own machine, LINKED to the shared one (not a copy of its demos), with each exercise in the coach's library (their row with that catalog exercise, else
// one with the same name, else a new one). If any step fails, the half-made machine is removed again.
async function addCatalogMachineToGym({
  coachId,
  orgId,
  machine,
}: {
  coachId: string;
  orgId: string | null;
  machine: CatalogMachine;
}): Promise<{ ok: true; machine: MachineRow; newLibraryRows: LibraryExerciseRow[] } | { ok: false; error: string }> {
  const fail = "Couldn't add that machine to your gym. Try again.";
  const supabase = createBrowserClient();
  const { data: libRows, error: libError } = await supabase.from("exercise_library").select("id, name, catalog_id").eq("created_by", coachId).limit(5000);
  if (libError) return { ok: false, error: fail };
  const plan = planAddToGym(
    machine.items,
    ((libRows ?? []) as { id: string; name: string; catalog_id: string | null }[]).map((r) => ({ id: r.id, name: r.name, catalogId: r.catalog_id })),
  );
  const toCreate = plan.filter((p) => !p.reuseId);
  let created: LibraryExerciseRow[] = [];
  const createdIdByItem = new Map<string, string>();
  if (toCreate.length > 0) {
    const { data, error } = await supabase
      .from("exercise_library")
      .insert(toCreate.map((p) => ({ created_by: coachId, name: p.item.name, catalog_id: p.item.catalogExerciseId, category: p.item.category })))
      .select("id, name, catalog_id, video_path, youtube_url, category, equipment_type, description");
    if (error || !data || data.length !== toCreate.length) return { ok: false, error: fail };
    const rows = data as { id: string; name: string; catalog_id: string | null; video_path: string | null; youtube_url: string | null; category: string | null; equipment_type: string | null; description: string | null }[];
    for (const p of toCreate) {
      const row = rows.find((r) => r.catalog_id === p.item.catalogExerciseId && r.name === p.item.name);
      if (row) createdIdByItem.set(p.item.id, row.id);
    }
    created = rows.map((r) => ({ id: r.id, name: r.name, videoPath: r.video_path, youtubeUrl: r.youtube_url, tier: null, category: r.category, equipmentType: r.equipment_type as LibraryExerciseRow["equipmentType"], description: r.description }));
  }

  const { data: gym, error: gymError } = await supabase
    .from("gym_machines")
    .insert({ created_by: coachId, organization_id: orgId, name: catalogMachineName(machine).slice(0, MACHINE_NAME_MAX).trim(), catalog_machine_id: machine.id })
    .select("id, name")
    .single();
  if (gymError || !gym) return { ok: false, error: fail };
  const gymRow = gym as { id: string; name: string };

  const seen = new Set<string>();
  const links: { machine_id: string; exercise_id: string; position: number; catalog_item_id: string }[] = [];
  for (const p of plan) {
    const exerciseId = p.reuseId ?? createdIdByItem.get(p.item.id);
    if (!exerciseId || seen.has(exerciseId)) continue;
    seen.add(exerciseId);
    links.push({ machine_id: gymRow.id, exercise_id: exerciseId, position: links.length, catalog_item_id: p.item.id });
  }
  if (links.length > 0) {
    const r = await checked(supabase.from("gym_machine_exercises").insert(links).select("machine_id"), { expectRows: true, message: fail });
    if (!r.ok) {
      await bestEffort(supabase.from("gym_machines").delete().eq("id", gymRow.id));
      return { ok: false, error: fail };
    }
  }
  return {
    ok: true,
    newLibraryRows: created,
    machine: {
      id: gymRow.id,
      name: gymRow.name,
      exerciseIds: links.map((l) => l.exercise_id),
      nextPos: links.length,
      catalogMachineId: machine.id,
      catalogItemByExercise: Object.fromEntries(links.map((l) => [l.exercise_id, l.catalog_item_id])),
    },
  };
}
