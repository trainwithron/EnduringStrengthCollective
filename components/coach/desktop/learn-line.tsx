"use client";

import { useEffect, useRef, useState } from "react";
import { MicButton } from "@/components/shared/mic-button";
import { ALL_KEYS } from "@/lib/clauses";
import { WHY_CHIPS, WHY_PROMPT } from "@/lib/learning-rule";

interface Proposal {
  summary: string;
  whenKeys: string[];
  scope: "all" | "clauses" | "client";
}
interface Proposed {
  proposal: Proposal;
  intro: string | null;
  askWhy: boolean;
}

const SITTING_KEY = "esc-learn-asked";
const button = "min-h-11 px-4 font-body text-sm";

// After a correction: ONE plain line, "I'll remember: no barbell squats for clients with back limits." with Yes / Change who this applies to / Not now. When no reason can be read it first asks why, once.
// At most one question per sitting. It never blocks anything: the correction has already been applied to the run.
export function LearnLine({ correction, programId, groupId, athleteId }: { correction: string; programId: string; groupId: string; athleteId: string | null }) {
  const [state, setState] = useState<"loading" | "why" | "confirm" | "change" | "saved" | "gone">("loading");
  const [data, setData] = useState<Proposed | null>(null);
  const [whyChips, setWhyChips] = useState<string[]>([]);
  const [whyText, setWhyText] = useState("");
  const [scope, setScope] = useState<"all" | "clauses" | "client">("all");
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedLine, setSavedLine] = useState<string | null>(null);
  const started = useRef(false);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/learning/rule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correction, groupId, athleteId, programId, ...payload }),
    });
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, any> };
  }

  async function propose(extra: Record<string, unknown> = {}) {
    const { ok, json } = await post({ action: "propose", ...extra });
    if (!ok || json.skip || !json.proposal) {
      setState("gone");
      return;
    }
    const p = json as Proposed;
    setData(p);
    setScope(p.proposal.scope);
    setKeys(p.proposal.whenKeys);
    setState(p.askWhy && !extra.whyText && !extra.whyChips ? "why" : "confirm");
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try {
      // One question per sitting.
      if (window.sessionStorage.getItem(SITTING_KEY)) {
        setState("gone");
        return;
      }
    } catch {
      // storage blocked: ask anyway
    }
    void propose().then(() => {
      try {
        window.sessionStorage.setItem(SITTING_KEY, "1");
      } catch {
        // fine
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(chosen: { scope: "all" | "clauses" | "client"; whenKeys: string[] }) {
    setError(null);
    const { ok, json } = await post({ action: "save", scope: chosen.scope, whenKeys: chosen.whenKeys, whyText: whyText || null, whyChips });
    if (!ok) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setSavedLine(String(json.summary ?? "").replace(/^I'll remember/, "Remembered"));
    setState("saved");
  }

  if (state === "loading" || state === "gone" || !data) return null;

  if (state === "saved") {
    return (
      <p className="font-body text-xs text-steel mt-2" role="status">
        {savedLine}
      </p>
    );
  }

  return (
    <div className="mt-2 border border-steel/30 bg-surface/40 p-3 space-y-2" role="group" aria-label="Remember this">
      {data.intro && <p className="font-body text-xs text-steel">{data.intro}</p>}

      {state === "why" && (
        <>
          <p className="font-body text-sm text-chalk">{WHY_PROMPT}</p>
          <div className="flex flex-wrap gap-2">
            {WHY_CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setWhyChips((prev) => (prev.includes(c.key) ? prev.filter((x) => x !== c.key) : [...prev, c.key]))}
                aria-pressed={whyChips.includes(c.key)}
                className={`${button} border ${whyChips.includes(c.key) ? "border-rust text-rust" : "border-steel/30 text-chalk"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={whyText}
              onChange={(e) => setWhyText(e.target.value)}
              maxLength={300}
              placeholder="Or tell me in your own words"
              aria-label="Why, in your own words"
              className="flex-1 min-w-0 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
            />
            <MicButton onText={(t) => setWhyText((x) => (x.trim() ? `${x.trim()} ${t}` : t))} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void propose({ whyText: whyText || undefined, whyChips })} className={`${button} bg-rust text-graphite`}>
              Save
            </button>
            <button type="button" onClick={() => void propose({ whyChips: [], whyText: "" }).then(() => setState("confirm"))} className={`${button} text-steel`}>
              Skip
            </button>
          </div>
        </>
      )}

      {state === "confirm" && (
        <>
          <p className="font-body text-sm text-chalk">{data.proposal.summary}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save({ scope: data.proposal.scope, whenKeys: data.proposal.whenKeys })} className={`${button} bg-rust text-graphite`}>
              Yes
            </button>
            <button type="button" onClick={() => setState("change")} className={`${button} border border-steel/30 text-chalk`}>
              Change who this applies to
            </button>
            <button type="button" onClick={() => setState("gone")} className={`${button} text-steel`}>
              Not now
            </button>
          </div>
        </>
      )}

      {state === "change" && (
        <>
          <p className="font-body text-sm text-chalk">Who does this apply to?</p>
          <div className="space-y-1">
            {athleteId && (
              <label className="flex items-center gap-2 min-h-11 font-body text-sm text-chalk cursor-pointer">
                <input type="radio" name="learn-scope" checked={scope === "client"} onChange={() => setScope("client")} />
                This client only
              </label>
            )}
            <label className="flex items-center gap-2 min-h-11 font-body text-sm text-chalk cursor-pointer">
              <input type="radio" name="learn-scope" checked={scope === "all"} onChange={() => setScope("all")} />
              All my clients
            </label>
            <label className="flex items-center gap-2 min-h-11 font-body text-sm text-chalk cursor-pointer">
              <input type="radio" name="learn-scope" checked={scope === "clauses"} onChange={() => setScope("clauses")} />
              Pick the reasons
            </label>
          </div>
          {scope === "clauses" && (
            <div className="flex flex-wrap gap-2">
              {ALL_KEYS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKeys((prev) => (prev.includes(k.key) ? prev.filter((x) => x !== k.key) : [...prev, k.key]))}
                  aria-pressed={keys.includes(k.key)}
                  className={`${button} border ${keys.includes(k.key) ? "border-rust text-rust" : "border-steel/30 text-chalk"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={scope === "clauses" && keys.length === 0} onClick={() => void save({ scope, whenKeys: scope === "clauses" ? keys : [] })} className={`${button} bg-rust text-graphite disabled:opacity-40`}>
              Save
            </button>
            <button type="button" onClick={() => setState("confirm")} className={`${button} text-steel`}>
              Back
            </button>
          </div>
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
