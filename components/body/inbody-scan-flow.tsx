"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { resizePhoto, type ResizedPhoto } from "@/lib/image-resize";
import { EMPTY_SCAN, FIELD_LABELS, numberFromField, sanityChecks, valuesForSave, type Check, type ScanValues } from "@/lib/inbody-scan";

type Step = "pick" | "reading" | "review" | "saving";

const field = "h-11 w-full bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Photograph (or choose a photo of) an InBody result sheet: the app reads the printed numbers, and NOTHING is saved until the person has looked at every number beside the photo, fixed what is wrong
// and pressed Save. A number that could not be read is left blank. The photo is kept privately so the paper is not needed. If reading is not available the same screen opens blank to type into.
export function InbodyScanFlow({
  athleteId,
  groupId,
  viewerId,
  athleteName,
  onSaved,
  onClose,
}: {
  athleteId: string;
  groupId: string;
  viewerId: string;
  athleteName: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const coachAdding = viewerId !== athleteId;
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [photo, setPhoto] = useState<ResizedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [text, setText] = useState<Record<string, string>>({});
  const [segments, setSegments] = useState<ScanValues["segments"]>(null);
  const [useAsWeighIn, setUseAsWeighIn] = useState(!coachAdding);
  const [existingWeighIn, setExistingWeighIn] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  // Is there already a weigh-in for the chosen date? (Then the scan keeps its own weight and never replaces it.)
  useEffect(() => {
    if (!date) {
      setExistingWeighIn(null);
      return;
    }
    let cancelled = false;
    void createBrowserClient()
      .from("body_weight_logs")
      .select("weight")
      .eq("athlete_id", athleteId)
      .eq("logged_date", date)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setExistingWeighIn(data ? Number(data.weight) : null);
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, date]);

  const values: ScanValues = useMemo(() => {
    const v: ScanValues = { ...EMPTY_SCAN, scanDate: date || null, segments };
    for (const f of FIELD_LABELS) (v as any)[f.key] = numberFromField(text[f.key] ?? "");
    return v;
  }, [date, text, segments]);
  const checks: Check[] = useMemo(() => sanityChecks(values), [values]);

  function fill(from: ScanValues) {
    const next: Record<string, string> = {};
    for (const f of FIELD_LABELS) {
      const v = from[f.key];
      next[f.key] = v == null ? "" : String(v);
    }
    setText(next);
    setSegments(from.segments);
    setDate(from.scanDate ?? "");
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setStep("reading");
    let resized: ResizedPhoto;
    try {
      resized = await resizePhoto(file);
    } catch {
      setStep("pick");
      setError("Couldn't open that photo. Try another one.");
      return;
    }
    setPhoto(resized);
    setPhotoUrl(URL.createObjectURL(resized.blob));
    try {
      const res = await fetch("/api/ai/parse-inbody-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: resized.base64, mediaType: resized.mediaType }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.values) {
        fill(data.values as ScanValues);
      } else {
        fill(EMPTY_SCAN);
        setNotice((data.error as string | undefined) ?? "Couldn't read that sheet. You can type the numbers in and keep the photo.");
      }
    } catch {
      fill(EMPTY_SCAN);
      setNotice("Couldn't read that sheet. You can type the numbers in and keep the photo.");
    }
    setStep("review");
  }

  async function save() {
    if (!photo || step === "saving") return;
    if (!date) {
      setError("Pick the date printed on the sheet.");
      return;
    }
    if (date > todayKey()) {
      setError("The scan date can't be in the future.");
      return;
    }
    if (values.weightLb == null && FIELD_LABELS.every((f) => values[f.key] == null)) {
      setError("Type at least one number from the sheet, or go back.");
      return;
    }
    setError(null);
    setStep("saving");
    const supabase = createBrowserClient();
    const path = `${groupId}/${athleteId}/${crypto.randomUUID()}.jpg`;
    const upload = await supabase.storage.from("inbody-scans").upload(path, photo.blob, { contentType: "image/jpeg" });
    if (upload.error) {
      setStep("review");
      setError("Couldn't store the photo. Check your signal and try again.");
      return;
    }
    const { error: problem } = await supabase.rpc("save_body_scan", {
      p_group: groupId,
      p_athlete: athleteId,
      p_values: valuesForSave(values),
      p_photo_path: path,
      p_use_as_weigh_in: useAsWeighIn && existingWeighIn == null && values.weightLb != null,
    });
    if (problem) {
      await supabase.storage.from("inbody-scans").remove([path]);
      setStep("review");
      setError(/limit|check|range/i.test(problem.message) ? "One of the numbers is not possible. Check them against the photo." : "Couldn't save the scan. Try again.");
      return;
    }
    onSaved();
  }

  if (step === "pick") {
    return (
      <div className="border border-steel/20 p-4">
        <p className="font-body text-sm text-chalk">Take or choose a photo of the whole InBody sheet, held flat.</p>
        <p className="font-body text-xs text-steel mt-1">We read the numbers for you to check. Nothing is saved until you say so, and the photo is kept so you don&apos;t need the paper.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 items-center cursor-pointer bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4">
            Choose a photo
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" onClick={onClose} className="min-h-11 px-2 font-body text-sm text-steel underline underline-offset-2">
            Cancel
          </button>
        </div>
        {error && (
          <p className="font-body text-sm text-rust mt-2" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (step === "reading") {
    return (
      <div className="border border-steel/20 p-4" role="status">
        <p className="font-body text-sm text-chalk">Reading your sheet…</p>
      </div>
    );
  }

  return (
    <div className="border border-steel/20 p-4">
      <h3 className="font-display uppercase text-sm tracking-wide text-steel">Check the numbers before you save</h3>
      <p className="font-body text-xs text-steel mt-1">Imported from a photo, check the numbers. Leave a box blank if you can&apos;t read it.</p>
      {notice && (
        <p className="font-body text-sm text-rust mt-2" role="alert">
          {notice}
        </p>
      )}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={photoUrl} target="_blank" rel="noreferrer">
              <img src={photoUrl} alt="The InBody sheet you photographed" className="w-full max-h-[480px] object-contain border border-steel/20 bg-black/30" />
            </a>
          )}
          <p className="font-body text-xs text-steel mt-1">Tap the photo to open it full size.</p>
        </div>
        <div>
          <label className="block font-body text-xs text-steel">
            Date on the sheet
            <input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1`} />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            {FIELD_LABELS.map((f) => (
              <label key={f.key} className="block font-body text-xs text-steel">
                {f.label}
                {f.unit ? ` (${f.unit})` : ""}
                <input
                  inputMode="decimal"
                  value={text[f.key] ?? ""}
                  onChange={(e) => setText({ ...text, [f.key]: e.target.value })}
                  className={`${field} mt-1`}
                  aria-label={`${f.label}${f.unit ? ` in ${f.unit}` : ""}`}
                />
              </label>
            ))}
          </div>
          {segments && <p className="font-body text-xs text-steel mt-2">The limb-by-limb numbers were read from the sheet too ({Object.keys(segments).length} of 5 areas).</p>}
        </div>
      </div>

      {checks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {checks.map((c) => (
            <li key={c.key} className={`font-body text-xs ${c.ok ? "text-steel" : "text-rust"}`}>
              <span aria-hidden>{c.ok ? "✓ " : "! "}</span>
              {c.ok ? c.label : `${c.label}: ${c.detail}. Check this one against the photo.`}
            </li>
          ))}
        </ul>
      )}

      {values.weightLb != null && date && (
        <div className="mt-3 font-body text-sm">
          {existingWeighIn != null ? (
            <p className="text-steel text-xs">A weigh-in of {existingWeighIn} lb is already logged for this day. The scan keeps its own weight.</p>
          ) : (
            <label className="flex items-start gap-2 min-h-11 cursor-pointer">
              <input type="checkbox" checked={useAsWeighIn} onChange={(e) => setUseAsWeighIn(e.target.checked)} className="mt-1" />
              <span>{coachAdding ? `Use this as ${athleteName}'s weigh-in for ${date}` : `Use this as my weigh-in for ${date}`}</span>
            </label>
          )}
        </div>
      )}

      {error && (
        <p className="font-body text-sm text-rust mt-3" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={step === "saving"} onClick={() => void save()} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-5 disabled:opacity-40">
          {step === "saving" ? "Saving…" : "Save scan"}
        </button>
        <button type="button" disabled={step === "saving"} onClick={onClose} className="min-h-11 border border-steel/40 px-4 font-body text-sm text-chalk disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  );
}
