"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X, Sparkles, ChevronDown } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { LibraryExercise, AliasEntry } from "@/lib/exercise-matching";
import { PROGRESSION_RULES, parseQuickBuildInput, type ProgressionRule } from "@/lib/spot-quick-build";

// ImportWizard statically pulls in the xlsx parsing library (large) — the
// Spot panel is mounted globally, so a static import here would ship
// that weight to every coach mobile page load instead of only the rare
// moment a coach actually reaches the full-screen builder.
const ImportWizard = dynamic(() => import("@/components/coach/desktop/import-wizard").then((m) => m.ImportWizard), {
  loading: () => <p className="font-body text-sm text-steel">Loading…</p>,
});

// the_spot_dropdown_widget_redesign_sept16.md "REVISED 2026-09-19" —
// swipe-right panel. Reuses the already-shipped multi-week AI generator
// pipeline (ImportWizard, /api/ai/generate-program) and the already-
// resolved progressive compact -> expanded -> full-screen mechanic
// verbatim (Ron: "must not be lost in the rework") — the only change
// from the 9/16 shipped version is that arriving at this panel via
// swipe already counts as "open", so there's no separate closed/FAB
// stage, and the compact stage's one text line now does double duty:
// a direct "Generate" button for a fast one-line build, and — via
// "Refine details" — the same text run through parseQuickBuildInput
// (lib/spot-quick-build.ts) to prefill the structured fields before
// generating, rather than requiring the coach to type the description
// AND separately re-pick progression/weeks/style. One input, two paths,
// per Ron's own "not two separate entry points" instruction.
const PROGRESSION_RULE_LIST = PROGRESSION_RULES;

interface ClientOption {
  id: string;
  fullName: string;
}

export function SpotBuilderPanel({
  groupId,
  initialAthleteId,
  initialAthleteName,
}: {
  groupId: string;
  initialAthleteId?: string | null;
  initialAthleteName?: string | null;
}) {
  const [stage, setStage] = useState<"compact" | "expanded" | "fullscreen">(initialAthleteId ? "expanded" : "compact");
  const [athleteId, setAthleteId] = useState<string | null>(initialAthleteId ?? null);
  const [athleteName, setAthleteName] = useState<string | null>(initialAthleteName ?? null);
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [description, setDescription] = useState("");
  const [progressionRule, setProgressionRule] = useState<ProgressionRule>("Let AI decide");
  const [weeks, setWeeks] = useState("4");
  const [programType, setProgramType] = useState("");
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [aliases, setAliases] = useState<AliasEntry[] | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);

  useEffect(() => {
    if (clients !== null || initialAthleteId) return;
    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .select("profile_id, profiles ( full_name )")
      .eq("group_id", groupId)
      .eq("role", "athlete")
      .then(({ data }) => {
        setClients((data ?? []).map((r: any) => ({ id: r.profile_id, fullName: r.profiles?.full_name ?? "Client" })));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

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

  function composePrompt(): string {
    const parts = [description.trim()];
    parts.push(`${weeks || "4"} weeks.`);
    if (progressionRule !== "Let AI decide") parts.push(`Use a ${progressionRule.toLowerCase()} progression scheme.`);
    if (programType.trim()) parts.push(`Methodology/style: ${programType.trim()}.`);
    if (athleteName) parts.push(`This program is for ${athleteName}.`);
    return parts.filter(Boolean).join(" ");
  }

  // Applies the compact line's own parsed guess to the structured fields
  // — run right before advancing to either "expanded" (so the fields
  // are pre-filled for review) or straight to "fullscreen" (so a direct
  // one-line generate still carries whatever the coach actually typed,
  // e.g. "10 weeks, conjugate" isn't silently dropped just because they
  // skipped the review step).
  function applyParsedGuessAndAdvance(nextStage: "expanded" | "fullscreen") {
    const guess = parseQuickBuildInput(description);
    if (guess.weeks != null) setWeeks(String(guess.weeks));
    if (guess.progressionRule != null) setProgressionRule(guess.progressionRule);
    if (guess.style != null) setProgramType(guess.style);
    setStage(nextStage);
  }

  function close() {
    setStage("compact");
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

  const canGenerate = description.trim().length > 0 && (!!athleteId || !!initialAthleteId);

  if (stage === "compact") {
    return (
      <div className="space-y-3">
        <p className="font-body text-sm font-medium text-chalk flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-rust shrink-0" strokeWidth={2.25} />
          AI Program Builder
        </p>

        {!initialAthleteId && (
          <select
            value={athleteId ?? ""}
            onChange={(e) => {
              const c = (clients ?? []).find((c) => c.id === e.target.value);
              setAthleteId(c?.id ?? null);
              setAthleteName(c?.fullName ?? null);
            }}
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          >
            <option value="">Pick a client…</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "8-week strength block, 4 days/week, conjugate"'
            className="flex-1 h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <button
            type="button"
            onClick={() => applyParsedGuessAndAdvance("fullscreen")}
            disabled={!canGenerate}
            className="h-10 px-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40 shrink-0"
          >
            Generate →
          </button>
        </div>

        <button
          type="button"
          onClick={() => applyParsedGuessAndAdvance("expanded")}
          className="w-full flex items-center justify-center gap-1 font-body text-[11px] text-steel uppercase tracking-wide active:text-rust"
        >
          Refine details
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (stage === "expanded") {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-body text-sm font-medium text-chalk flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rust shrink-0" strokeWidth={2.25} />
            AI Program Builder
          </p>
          <button type="button" onClick={close} aria-label="Back to compact">
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
              onChange={(e) => setProgressionRule(e.target.value as ProgressionRule)}
              className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-1 font-body text-xs"
            >
              {PROGRESSION_RULE_LIST.map((r) => (
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

  // stage === "fullscreen" — true modal takeover, escaping the panel's
  // own scroll container via fixed positioning (unaffected by which
  // swipe panel is currently in view underneath).
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
