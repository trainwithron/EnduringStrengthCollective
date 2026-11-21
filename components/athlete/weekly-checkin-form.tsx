"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { uploadCheckinPhoto } from "@/lib/checkin-photo-upload";
import {
  AUTO_FILL_LINE,
  CHECKIN_PHOTOS_MAX,
  CHECKIN_TEXT_MAX,
  EATING_QUESTION,
  ENERGY_QUESTION,
  HARD_LABEL,
  WIN_LABEL,
  coachLabel,
  sendLabel,
  workoutsValue,
  type CheckinSnapshot,
} from "@/lib/weekly-checkin";

interface Photo {
  id: string;
  url: string;
}

// The client's weekly check-in (Ron, Nov 20: R2; the approved phone board). The card is filled in from their logs; two 1 to 5 rows, two short boxes, optional photos, one button.
// Sending again the same week changes what was sent, until the coach reviews it; after that it is shown as sent.
export function WeeklyCheckinForm({
  groupId,
  athleteId,
  coachName,
  snapshot,
  initial,
  reviewed,
}: {
  groupId: string;
  athleteId: string;
  coachName: string | null;
  snapshot: CheckinSnapshot;
  initial: { energy: number; eating: number; win: string; hard: string; photos: Photo[] } | null;
  reviewed: boolean;
}) {
  const [energy, setEnergy] = useState<number | null>(initial?.energy ?? null);
  const [eating, setEating] = useState<number | null>(initial?.eating ?? null);
  const [win, setWin] = useState(initial?.win ?? "");
  const [hard, setHard] = useState(initial?.hard ?? "");
  const [photos, setPhotos] = useState<Photo[]>(initial?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const coach = coachLabel(coachName);
  const locked = reviewed;

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, CHECKIN_PHOTOS_MAX - photos.length);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    for (const file of files) {
      const r = await uploadCheckinPhoto(supabase, { athleteId, groupId, file });
      if (!r.ok) {
        setError(r.error);
        break;
      }
      setPhotos((prev) => [...prev, { id: r.id, url: r.previewUrl }]);
    }
    setUploading(false);
  }

  async function send() {
    if (energy == null || eating == null) {
      setError("Pick a number for both questions.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/checkins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, energy, eating, win, hard, photoIds: photos.map((p) => p.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Couldn't send your check-in. Try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't send your check-in. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="tint-win rounded-card p-5" role="status" data-checkin-sent>
        <p className="font-display font-semibold text-xl text-chalk">Sent to {coach === "your coach" ? "your coach" : coach}</p>
        <p className="font-body text-sm text-steel mt-1">You can change it until {coach} reviews it. Open this page again to make a change.</p>
        <Link href={`/groups/${groupId}`} className="inline-flex items-center min-h-11 mt-2 font-body text-sm text-rust-ink font-medium">
          Back to Home
        </Link>
      </div>
    );
  }

  const rows: { label: string; value: string }[] = [{ label: "Workouts", value: workoutsValue(snapshot) }];
  if (snapshot.avg_weight != null) rows.push({ label: "Avg weight", value: `${snapshot.avg_weight.toFixed(1)} ${snapshot.weight_unit}` });
  rows.push({ label: "Days logged food", value: `${snapshot.food_days} of 7` });

  return (
    <div className="space-y-5" data-weekly-checkin>
      <div className="bg-surface rounded-card p-4">
        <dl className="divide-y divide-steel/15">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
              <dt className="font-body text-sm text-steel">{r.label}</dt>
              <dd className="font-body text-[15px] font-semibold text-chalk">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="font-body text-xs text-steel mt-3">{AUTO_FILL_LINE}</p>
      </div>

      {locked && (
        <p className="tint-checkin rounded-card px-4 py-3 font-body text-sm text-chalk" role="status">
          {coach === "your coach" ? "Your coach" : coach} reviewed this check-in.
        </p>
      )}

      <ScoreRow label={ENERGY_QUESTION} value={energy} onChange={setEnergy} disabled={locked} />
      <ScoreRow label={EATING_QUESTION} value={eating} onChange={setEating} disabled={locked} />

      <label className="block">
        <span className="block font-body text-[15px] text-chalk mb-1.5">{WIN_LABEL}</span>
        <textarea
          value={win}
          onChange={(e) => setWin(e.target.value)}
          maxLength={CHECKIN_TEXT_MAX}
          rows={3}
          disabled={locked}
          className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-base focus:outline-none focus:border-rust disabled:opacity-70"
        />
      </label>
      <label className="block">
        <span className="block font-body text-[15px] text-chalk mb-1.5">
          {HARD_LABEL} <span className="text-steel">(optional)</span>
        </span>
        <textarea
          value={hard}
          onChange={(e) => setHard(e.target.value)}
          maxLength={CHECKIN_TEXT_MAX}
          rows={3}
          disabled={locked}
          className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-base focus:outline-none focus:border-rust disabled:opacity-70"
        />
      </label>

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label="Progress photos with this check-in">
          {photos.map((p) => (
            <li key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed link or a local preview of the client's own photo */}
              <img src={p.url} alt="" className="w-full aspect-square object-cover rounded-row" />
              {!locked && (
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label="Leave this photo out"
                  className="absolute top-1 right-1 w-8 h-8 rounded-full bg-graphite/80 text-chalk flex items-center justify-center"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && photos.length < CHECKIN_PHOTOS_MAX && (
        <label className="flex items-center justify-center min-h-12 rounded-card border border-dashed border-steel/50 font-body text-sm text-steel cursor-pointer active:border-rust">
          {uploading ? "Adding…" : "+ Add progress photos (optional)"}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={addPhotos} disabled={uploading} className="sr-only" />
        </label>
      )}
      {!locked && photos.length > 0 && <p className="font-body text-xs text-steel -mt-3">Photos you send are shared with {coach}. They stay in your progress photos.</p>}

      {error && (
        <p className="font-body text-sm text-rust-ink" role="alert">
          {error}
        </p>
      )}

      {!locked && (
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || uploading}
          className="w-full min-h-[52px] rounded-token-pill bg-rust text-graphite font-display font-semibold text-lg disabled:opacity-50"
        >
          {sending ? "Sending…" : sendLabel(coachName)}
        </button>
      )}
    </div>
  );
}

function ScoreRow({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="font-body text-[15px] text-chalk mb-2">{label}</legend>
      <div className="flex items-center justify-between gap-2" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(n)}
              className={`w-11 h-11 rounded-token-circle font-body text-base font-semibold ${on ? "bg-rust text-graphite" : "bg-surface-2 text-chalk"} disabled:opacity-70`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
