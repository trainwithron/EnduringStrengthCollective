"use client";

import { useEffect, useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useTerm } from "@/components/coach/terminology-provider";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { getCoachClients } from "@/lib/coach-clients";
import type { LibraryExercise, AliasEntry } from "@/lib/exercise-matching";

// ImportWizard statically pulls in the xlsx parsing library (large): the Spotlight hub is mounted on every coach page, so it is loaded only when the box is opened.
const ImportWizard = dynamic(() => import("@/components/coach/desktop/import-wizard").then((m) => m.ImportWizard), {
  loading: () => <p className="font-body text-sm text-steel">Loading…</p>,
});

interface ClientOption {
  id: string;
  fullName: string;
  // The client's own group (their one-on-one space when they have one): the program is made there.
  groupId: string;
}

// Spotlight > Program on a phone (Release 3; Ron: "it should just default to one. And however you use it, it uses"): ONE box, full screen, the same box as the computer's New program
// (ImportWizard): describe a program for the AI, paste one, or attach a file, photo or spreadsheet, and review it before anything is made. No AI/Parse switch and no compact steps.
// A client is optional: with none the program is the coach's own, made in the organization's group (like New program on /programs) to assign later; with one it is made for that
// client in their own group. The ?spotBuilder=<client> deep link opens it with that client chosen.
export function SpotBuilderPanel({
  groupId,
  initialAthleteId,
  initialAthleteName,
  onClose,
}: {
  // The organization's group (the hub's active group); a deep link passes the page's group.
  groupId: string;
  initialAthleteId?: string | null;
  initialAthleteName?: string | null;
  onClose: () => void;
}) {
  const term = useTerm();
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [athleteId, setAthleteId] = useState<string | null>(initialAthleteId ?? null);
  const [athleteName, setAthleteName] = useState<string | null>(initialAthleteName ?? null);
  const [athleteGroupId, setAthleteGroupId] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [aliases, setAliases] = useState<AliasEntry[] | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  // While the box is reading something or a review is open, closing asks first (nothing generated or edited is thrown away by accident).
  const [active, setActive] = useState(false);
  const dialogRef = useDialogA11y<HTMLDivElement>(true, () => onClose(), undefined, {
    guard: () => (active ? "ask" : "close"),
    askMessage: "Close the program box? Anything you have generated or edited here will be lost.",
  });

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setCoachId(user.id);
      // Every client of the organization once (one-on-one clients included), the same list as the Clients tile.
      const [list, { data: libraryRows }, { data: aliasRows }] = await Promise.all([
        getCoachClients(supabase, user.id, groupId),
        supabase.from("exercise_library").select("name").eq("created_by", user.id).order("name"),
        supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", user.id),
      ]);
      const options = list.map((c) => ({ id: c.id, fullName: c.fullName, groupId: c.groupId }));
      setClients(options);
      if (initialAthleteId) setAthleteGroupId(options.find((c) => c.id === initialAthleteId)?.groupId ?? groupId);
      setLibrary(libraryRows ?? []);
      setAliases((aliasRows ?? []).map((a) => ({ rawName: a.raw_name, exerciseName: a.exercise_name })));
    });
  }, [groupId, initialAthleteId]);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Build a program" className="fixed inset-0 z-50 bg-graphite overflow-y-auto" data-spot-program-box>
      <div className="sticky top-0 z-10 bg-graphite border-b border-steel/20 px-4 py-3 flex items-center justify-between gap-3">
        <p className="font-display font-bold text-lg uppercase leading-none">Build a program</p>
        <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center">
          <X className="w-5 h-5 text-steel" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">For</span>
          <select
            aria-label={term("client", "singular", { cap: true })}
            value={athleteId ?? ""}
            onChange={(e) => {
              const c = (clients ?? []).find((x) => x.id === e.target.value);
              setAthleteId(c?.id ?? null);
              setAthleteName(c?.fullName ?? null);
              setAthleteGroupId(c?.groupId ?? null);
            }}
            disabled={active}
            className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm disabled:opacity-60"
          >
            <option value="">No {term("client")} yet (assign it later)</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        {!library || !aliases || !coachId ? (
          <p className="font-body text-sm text-steel">Loading…</p>
        ) : (
          <ImportWizard
            // A new box when the client changes, so a program is never made for one client in another's group.
            key={athleteId ?? "none"}
            coachId={coachId}
            groupId={athleteId ? (athleteGroupId ?? groupId) : groupId}
            athleteId={athleteId ?? undefined}
            athleteName={athleteName ?? undefined}
            // With no client, the program is made in the organization's group like New program on /programs: the organization's own.
            orgProgram={!athleteId}
            initialLibrary={library}
            initialAliases={aliases}
            onActivity={setActive}
          />
        )}
      </div>
    </div>
  );
}
