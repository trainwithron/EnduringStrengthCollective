"use client";

import { useState } from "react";
import Link from "next/link";
import { TerminologyProvider, useTerminology } from "@/components/coach/terminology-provider";
import { TERM_DEFAULTS, TERM_PRESETS } from "@/lib/terminology";
import { capFirst } from "@/lib/term-text";

// "What do you call your people?" (Ron, Oct 6): the word is chosen once, here (the first-run card on Home and the coach's Settings), and then it reads as plain
// text everywhere. One tap on a button applies it coach-wide; "Something else" takes your own word.
function Chooser({ moreHref }: { moreHref?: string }) {
  const { overrides, setOverride } = useTerminology();
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const current = overrides.client;
  const options = [
    { id: "default", label: capFirst(TERM_DEFAULTS.client.plural), selected: !current },
    ...TERM_PRESETS.client.map((p) => ({ id: p.value, label: capFirst(p.plural), selected: current?.kind === "preset" && current.value === p.value })),
  ];
  const customSelected = current?.kind === "custom";

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What do you call your people?">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.selected}
            onClick={() => {
              setCustom(false);
              if (o.id === "default") setOverride("client", null);
              else setOverride("client", { kind: "preset", value: o.id });
            }}
            className={`h-11 px-4 border font-body text-sm ${o.selected ? "border-rust text-rust" : "border-steel/30 text-chalk"}`}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={customSelected}
          onClick={() => setCustom((v) => !v)}
          className={`h-11 px-4 border font-body text-sm ${customSelected ? "border-rust text-rust" : "border-steel/30 text-chalk"}`}
        >
          {customSelected ? capFirst(current.value) : "Something else"}
        </button>
      </div>
      {custom && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = customText.trim();
            if (!text) return;
            setOverride("client", { kind: "custom", value: text });
            setCustom(false);
            setCustomText("");
          }}
        >
          <input
            autoFocus
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="For example: swimmers"
            aria-label="Your word, plural"
            className="h-11 flex-1 max-w-xs bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
          />
          <button type="submit" className="h-11 px-4 border border-rust text-rust font-body text-sm">
            Use this word
          </button>
        </form>
      )}
      <p className="font-body text-xs text-steel mt-2">
        It changes everywhere in your coach screens at once, and you can change it again here any time.
        {moreHref && (
          <>
            {" "}
            <Link href={moreHref} className="underline text-chalk">
              More words (groups, coaches, sessions, programs)
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

// It uses the page's own vocabulary when the page has one (so the whole screen updates at once), and brings its own otherwise (Settings on a phone).
export function TerminologyChooser({ groupId, moreHref }: { groupId?: string; moreHref?: string }) {
  const { mounted } = useTerminology();
  if (mounted) return <Chooser moreHref={moreHref} />;
  return (
    <TerminologyProvider groupId={groupId}>
      <Chooser moreHref={moreHref} />
    </TerminologyProvider>
  );
}
