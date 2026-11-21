"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { uploadProgressPhoto } from "@/lib/progress-photo-upload";
import { compareStats, defaultPair, photoDays, signedChange, type ComparePhoto, type WeighIn } from "@/lib/photo-compare";
import { lbToKg, type WeightUnit } from "@/lib/units";
import { tapeUnitFor } from "@/lib/body-measurements";

// Two of the client's own progress photos side by side (wave 2, P5; the approved Compare mockup): pick a day for each side, see each photo with its date, and
// under them how far apart they are and what the scale and the tape said. The photos are private: only the client sees them, and the coach sees a photo only
// when the client shares it from the journal. We keep no pose (front, side, back) for a photo, so a day with several photos offers Photo 1 / 2 / 3 instead.

export interface CompareInputPhoto extends ComparePhoto {
  url: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(key: string): string {
  const m = MONTHS[Number(key.slice(5, 7)) - 1] ?? "";
  const d = Number(key.slice(8, 10));
  const thisYear = String(new Date().getFullYear());
  return key.startsWith(thisYear) ? `${m} ${d}` : `${m} ${d}, ${key.slice(0, 4)}`;
}

function Side({
  label,
  days,
  date,
  onDate,
  index,
  onIndex,
  accent,
}: {
  label: string;
  days: { date: string; photos: CompareInputPhoto[] }[];
  date: string;
  onDate: (d: string) => void;
  index: number;
  onIndex: (i: number) => void;
  accent: boolean;
}) {
  const day = days.find((d) => d.date === date);
  const photos = day?.photos ?? [];
  const photo = photos[Math.min(index, photos.length - 1)];
  return (
    <div className="min-w-0 flex flex-col gap-2">
      <label className="block">
        <span className="sr-only">{label}</span>
        <select
          value={date}
          onChange={(e) => {
            onDate(e.target.value);
            onIndex(0);
          }}
          className={`w-full h-11 rounded-row px-3 font-body text-sm border ${accent ? "bg-rust/10 border-rust/30 text-rust-ink font-semibold" : "bg-surface border-steel/30 text-chalk"}`}
        >
          {days.map((d) => (
            <option key={d.date} value={d.date}>
              {dayLabel(d.date)}
            </option>
          ))}
        </select>
      </label>
      <div className="relative h-[300px] rounded-card overflow-hidden bg-surface">
        {photo?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={`Progress photo, ${dayLabel(date)}`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center p-3 text-center font-body text-xs text-steel">This photo could not be loaded.</div>
        )}
        <span className="absolute left-2 bottom-2 rounded-full bg-graphite/80 px-2.5 py-1 font-body text-xs text-chalk">{dayLabel(date)}</span>
      </div>
      {photos.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Photos from ${dayLabel(date)}`}>
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onIndex(i)}
              aria-pressed={i === index}
              className={`min-h-11 px-3 rounded-token-pill font-body text-xs ${i === index ? "bg-rust/15 text-rust-ink font-semibold" : "bg-surface-2 text-steel"}`}
            >
              Photo {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The empty compare page's "Add a photo" (audit C5): the picker opens right here, the photo goes into the journal (private), and the page stays.
function AddPhotoHere({ owner }: { owner: { athleteId: string; groupId: string } }) {
  const router = useRouter();
  const pickRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [addNote, setAddNote] = useState<{ text: string; error: boolean } | null>(null);

  async function addPhoto(file: File | null) {
    if (!file || adding) return;
    setAdding(true);
    setAddNote(null);
    const r = await uploadProgressPhoto(createBrowserClient(), { athleteId: owner.athleteId, groupId: owner.groupId, file, sharedWithCoach: false });
    setAdding(false);
    if (!r.ok) {
      setAddNote({ text: r.error, error: true });
      return;
    }
    setAddNote({ text: "Added to your photos.", error: false });
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => pickRef.current?.click()} disabled={adding} className="self-start min-h-11 px-5 inline-flex items-center bg-rust text-graphite font-body text-sm font-semibold disabled:opacity-50" data-compare-add>
        {adding ? "Adding…" : "Add a photo"}
      </button>
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          void addPhoto(f);
        }}
      />
      {addNote && (
        <p className={`font-body text-sm ${addNote.error ? "text-rust-ink" : "text-chalk"}`} role={addNote.error ? "alert" : "status"}>
          {addNote.text}
        </p>
      )}
    </>
  );
}

export function PhotoCompare({
  photos,
  weighIns,
  waists,
  weightUnit,
  addHref,
  owner,
}: {
  // The client's own compare page: "Add a photo" opens the picker right here and the photo is added to the journal (private), staying on this page (audit C5, Nov 21).
  owner?: { athleteId: string; groupId: string };
  photos: CompareInputPhoto[];
  weighIns: WeighIn[];
  // waist readings in inches, shaped like weigh-ins (date, value)
  waists: WeighIn[];
  weightUnit: WeightUnit;
  addHref: string;
}) {
  const days = useMemo(() => photoDays(photos) as { date: string; photos: CompareInputPhoto[] }[], [photos]);
  const first = defaultPair(days);
  const [before, setBefore] = useState(first?.before ?? "");
  const [after, setAfter] = useState(first?.after ?? "");
  const [beforeIndex, setBeforeIndex] = useState(0);
  const [afterIndex, setAfterIndex] = useState(0);
  if (!first) {
    return (
      <div className="bg-surface rounded-card p-5 flex flex-col gap-3" data-photo-compare-empty>
        <p className="font-body text-[15px] font-semibold text-chalk">Two days of photos make a comparison.</p>
        <p className="font-body text-sm text-steel">
          {days.length === 1 ? "You have photos from one day so far. Add one on another day and they show up here side by side." : "Add a progress photo today, and another in a few weeks, and they show up here side by side."}
        </p>
        {owner ? (
          <AddPhotoHere owner={owner} />
        ) : (
          <Link href={addHref} className="self-start min-h-11 px-5 inline-flex items-center bg-rust text-graphite font-body text-sm font-semibold">
            Add a photo
          </Link>
        )}
        <p className="font-body text-xs text-steel">Only you see your photos. Your coach sees one only if you share it.</p>
      </div>
    );
  }

  // The earlier day always on the left, whichever picker changed.
  const [left, right] = before <= after ? [before, after] : [after, before];
  const stats = left === right ? null : compareStats(left, right, weighIns, waists);
  const tape = tapeUnitFor(weightUnit);
  const weightShown = stats?.weightChange != null ? signedChange(weightUnit === "kg" ? lbToKg(stats.weightChange) : stats.weightChange, weightUnit) : null;
  const waistShown = stats?.waistChange != null ? signedChange(tape === "cm" ? stats.waistChange * 2.54 : stats.waistChange, tape) : null;

  return (
    <div className="flex flex-col gap-3.5" data-photo-compare>
      <div className="grid grid-cols-2 gap-2">
        <Side label="The earlier photo's day" days={days} date={before} onDate={setBefore} index={beforeIndex} onIndex={setBeforeIndex} accent={false} />
        <Side label="The later photo's day" days={days} date={after} onDate={setAfter} index={afterIndex} onIndex={setAfterIndex} accent />
      </div>

      {stats ? (
        <section className="bg-surface rounded-card px-4 py-3.5 grid grid-cols-3 gap-2 text-center" aria-label="Between the two photos">
          <div className="min-w-0">
            <p className="font-body text-xs text-steel">Apart</p>
            <p className="font-display text-lg leading-tight text-chalk">{stats.gap.replace(/ apart$/, "")}</p>
          </div>
          <div className="min-w-0">
            <p className="font-body text-xs text-steel">Body weight</p>
            <p className="font-display text-lg leading-tight text-chalk tabular-nums">{weightShown ?? "–"}</p>
          </div>
          <div className="min-w-0">
            <p className="font-body text-xs text-steel">Waist</p>
            <p className="font-display text-lg leading-tight text-chalk tabular-nums">{waistShown ?? "–"}</p>
          </div>
        </section>
      ) : (
        <p className="font-body text-sm text-steel text-center">Pick two different days to compare.</p>
      )}
      {stats && (weightShown == null || waistShown == null) && (
        <p className="font-body text-xs text-steel text-center">A change shows when there is a reading within a week of both photos.</p>
      )}
      <p className="font-body text-xs text-steel text-center">Only you see these. Your coach sees a photo only if you share it.</p>
    </div>
  );
}
