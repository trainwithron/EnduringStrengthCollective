"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X, Sparkles } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { LibraryExercise, AliasEntry } from "@/lib/exercise-matching";

// ImportWizard statically pulls in the xlsx parsing library (large) —
// CoachMobileShell mounts this sheet on every coach mobile page, so a
// static import here would ship that weight to every page load instead
// of only the rare moment a coach actually reaches the full-screen
// builder. Same "lazy-load the heavy thing" discipline as the perf-fix
// pass just before this one, applied at the bundle level instead of the
// query-batching level.
const ImportWizard = dynamic(
  () => import("@/components/coach/desktop/import-wizard").then((m) => m.ImportWizard),
  { loading: () => <p className="font-body text-sm text-steel">Loading…</p> }
);

// the_spot_dropdown_widget_redesign_sept16.md — the bottom-anchored
// entry point. Ron's own resolution: "for the workout builder... make
// sure it's at the bottom and whenever you tap it it goes full
// screen... one continuous gesture" (compact quick-generate row -> more
// detail -> full screen day-by-day builder). Reuses the EXISTING,
// already-shipped multi-week AI program generator (/api/ai/generate-
// program) and the existing review/exercise-matching/DB-write pipeline
// (ImportWizard) rather than building a second generation engine — the
// "new architecture" this needed was a lightweight mobile entry point
// into what already exists, not a new generator.
//
// Simplification, stated plainly: the three named stages (compact ->
// expanded -> full screen) are tap-progressive here, not driven by a
// real swipe/drag gesture with velocity tracking — same three-stage
// structure Ron described, a lighter-weight implementation of the
// gesture itself.

const PROGRESSION_RULES = ["Let AI decide", "Linear", "Double Progression", "Undulating"] as const;

interface ClientOption {
  id: string;
  fullName: string;
}

export function SpotNlBuilderSheet({
  groupId,
  initialAthleteId,
  initialAthleteName,
}: {
  groupId: string;
  // Fast entry path #1: pre-scoped from a specific client's own row/
  // profile. When omitted, the compact row's own inline picker is fast
  // entry path #2, from the coach's own dashboard directly.
  initialAthleteId?: string | null;
  initialAthleteName?: string | null;
}) {
  const [stage, setStage] = useState<"closed" | "compact" | "expanded" | "fullscreen">(
    initialAthleteId ? "expanded" : "closed"
  );
  const [athleteId, setAthleteId] = useState<string | null>(initialAthleteId ?? null);
  const [athleteName, setAthleteName] = useState<string | null>(initialAthleteName ?? null);
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [description, setDescription] = useState("");
  const [progressionRule, setProgressionRule] = useState<(typeof PROGRESSION_RULES)[number]>("Let AI decide");
  const [weeks, setWeeks] = useState("4");
  const [programType, setProgramType] = useState("");
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [aliases, setAliases] = useState<AliasEntry[] | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);

  useEffect(() => {
    if (stage === "expanded" && clients === null && !initialAthleteId) {
      const supabase = createBrowserClient();
      supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name )")
        .eq("group_id", groupId)
        .eq("role", "athlete")
        .then(({ data }) => {
          setClients(
            (data ?? []).map((r: any) => ({ id: r.profile_id, fullName: r.profiles?.full_name ?? "Client" }))
          );
        });
    }
  }, [stage, clients, groupId, initialAthleteId]);

  useEffect(() => {
    if (stage !== "fullscreen" || library !== null) return;
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setCoachId(user.id);
      const [{ data: libraryRows }, { data: aliasRows }] = await Promise.all([
        supabase.from("exercise_library").select("name").eq("created_by", user.id).order("name"),
        supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", user.id),
      ]);
      setLibrary(libraryRows ?? []);
      setAliases((aliasRows ?? []).map((a) => ({ rawName: a.raw_name, exerciseName: a.exercise_name })));
    });
  }, [stage, library]);

  function close() {
    setStage("closed");
    setDescription("");
    setProgressionRule("Let AI decide");
    setWeeks("4");
    setProgramType("");
    setLibrary(null);
    setAliases(null);
    if (!initialAthleteId) {
      setAthleteId(null);
      setAthleteName(null);
    }
  }

  function composePrompt(): string {
    const parts = [description.trim()];
    parts.push(`${weeks || "4"} weeks.`);
    if (progressionRule !== "Let AI decide") parts.push(`Use a ${progressionRule.toLowerCase()} progression scheme.`);
    if (programType.trim()) parts.push(`Methodology/style: ${programType.trim()}.`);
    if (athleteName) parts.push(`This program is for ${athleteName}.`);
    return parts.filter(Boolean).join(" ");
  }

  if (stage === "closed") {
    return (
      <button
        type="button"
        onClick={() => setStage("compact")}
        aria-label="AI Program Builder"
        className="fixed bottom-20 right-4 z-30 h-12 w-12 rounded-token-circle bg-rust text-graphite flex items-center justify-center shadow-lg active:opacity-80 transition-opacity"
      >
        <Sparkles className="w-5 h-5" strokeWidth={2.25} />
      </button>
    );
  }

  if (stage === "compact") {
    return (
      <div className="fixed bottom-16 inset-x-0 z-30 bg-graphite border-t border-steel/30 px-4 py-3 shadow-2xl">
        <button
          type="button"
          onClick={() => setStage("expanded")}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="font-body text-sm text-chalk flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rust shrink-0" strokeWidth={2.25} />
            AI Program Builder — tap to build a program
          </span>
          <X
            className="w-4 h-4 text-steel shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
          />
        </button>
      </div>
    );
  }

  if (stage === "expanded") {
    const canGenerate = description.trim().length > 0 && (!!athleteId || !!initialAthleteId);
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 bg-graphite border-t border-steel/30 px-4 pt-4 pb-6 shadow-2xl max-h-[75vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <p className="font-body text-sm font-medium text-chalk flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rust shrink-0" strokeWidth={2.25} />
            AI Program Builder
          </p>
          <button type="button" onClick={close} aria-label="Close">
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>

        {initialAthleteId ? (
          <p className="font-body text-xs text-steel mb-3">
            Building for <span className="text-chalk">{athleteName ?? "this client"}</span>
          </p>
        ) : (
          <div className="mb-3">
            <label className="font-body text-[11px] text-steel uppercase tracking-wide">Client</label>
            <select
              value={athleteId ?? ""}
              onChange={(e) => {
                const c = (clients ?? []).find((c) => c.id === e.target.value);
                setAthleteId(c?.id ?? null);
                setAthleteName(c?.fullName ?? null);
              }}
              className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
            >
              <option value="">Pick a client…</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>
        )}

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder='e.g. "8-week strength block, 4 days/week, squat/bench/deadlift focus"'
          className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
        />

        <div className="grid grid-cols-3 gap-2 mt-3">
          <div>
            <label className="font-body text-[11px] text-steel uppercase tracking-wide">Progression</label>
            <select
              value={progressionRule}
              onChange={(e) => setProgressionRule(e.target.value as (typeof PROGRESSION_RULES)[number])}
              className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-1 font-body text-xs"
            >
              {PROGRESSION_RULES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-body text-[11px] text-steel uppercase tracking-wide">Weeks</label>
            <input
              type="number"
              min={1}
              max={16}
              value={weeks}
              onChange={(e) => setWeeks(e.target.value)}
              className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            />
          </div>
          <div>
            <label className="font-body text-[11px] text-steel uppercase tracking-wide">Style</label>
            <input
              type="text"
              value={programType}
              onChange={(e) => setProgramType(e.target.value)}
              placeholder="Conjugate…"
              className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStage("fullscreen")}
          disabled={!canGenerate}
          className="mt-4 w-full h-10 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Generate program →
        </button>
      </div>
    );
  }

  // stage === "fullscreen" — a true modal takeover (per the spec's own
  // open question, resolved this way): keeps the sheet's already-entered
  // fields/client-selection state alive across the transition, which a
  // route navigation would have thrown away.
  return (
    <div className="fixed inset-0 z-50 bg-graphite overflow-y-auto">
      <div className="sticky top-0 z-10 bg-graphite border-b border-steel/20 px-4 py-3 flex items-center justify-between">
        <p className="font-display font-bold text-lg uppercase leading-none">AI Program Builder</p>
        <button type="button" onClick={close} aria-label="Close">
          <X className="w-5 h-5 text-steel" />
        </button>
      </div>
      <div className="p-4">
        {!library || !aliases || !coachId ? (
          <p className="font-body text-sm text-steel">Loading…</p>
        ) : (
          <ImportWizard
            coachId={coachId}
            groupId={groupId}
            athleteId={athleteId ?? undefined}
            athleteName={athleteName ?? undefined}
            initialLibrary={library}
            initialAliases={aliases}
            initialAiPrompt={composePrompt()}
            autoGenerate
          />
        )}
      </div>
    </div>
  );
}
