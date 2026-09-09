"use client";

import { useState } from "react";

const GEMINI_PROMPT = `You are extracting a workout program from an image (a screenshot of a
workout tracking app, spreadsheet, or handwritten program) into a clean
CSV file.

Output ONLY a CSV — no commentary, no markdown code fences, no explanation
before or after. The first line must be exactly this header:

Week,Day,Exercise,Sets,Reps,Weight,RPE,Rest

Rules for filling it in:
- Week: a plain number (1, 2, 3...). If the image only shows one week,
  use 1 for every row.
- Day: a plain label (Day 1, Day 2, Day 3...) matching how the image
  groups exercises into sessions.
- Exercise: the exercise name exactly as written, spelled out in full
  (expand abbreviations you're confident about, e.g. "DB" -> "Dumbbell",
  "BB" -> "Barbell", "RDL" -> "Romanian Deadlift" — but if you're not
  sure what an abbreviation means, leave it as-is rather than guessing).
- Sets: the number of sets as a plain integer.
- Reps: the target rep count as a plain number. If it's a range (e.g.
  "8-10"), use the lower number. If it's a hold/timed exercise with no
  rep count, put 1.
- Weight: the target weight as a plain number only, no units (e.g. 135
  not "135 lbs"). Leave blank if bodyweight or not specified.
- RPE: the target RPE as a plain number if shown. Leave blank if not
  specified.
- Rest: the rest period if shown (e.g. "90 sec" or "2 min"). Leave blank
  if not specified.

One row per exercise per day (not one row per set) — if every set of an
exercise has the same reps/weight, that's one row with Sets as the count.
If sets genuinely differ from each other (e.g. a warm-up ramp: 135x5,
185x5, 225x3), put one row per distinct set instead and set Sets to 1 on
each.

Do not invent or guess values that aren't visible in the image — leave
the field blank rather than fabricating a number. Preserve special
characters (°, ', etc.) exactly as written, don't substitute them.

If the image is unclear or a value is illegible, put "?" in that cell
rather than guessing, so it's obvious which fields need a manual check.`;

export function GeminiImportGuide() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(GEMINI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the prompt is still
      // right there to select and copy by hand.
    }
  }

  return (
    <div className="border border-steel/20 bg-surface/40 mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <span className="font-display uppercase text-sm tracking-wide">
          Importing from a screenshot or PDF instead of a spreadsheet?
        </span>
        <span className="font-body text-xs text-rust shrink-0">{open ? "Hide" : "Show me how"}</span>
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-4">
          <ol className="space-y-3 font-body text-sm text-steel list-decimal list-inside">
            <li>
              Take a screenshot (or export a PDF) of the program from whatever app or spreadsheet
              it currently lives in — one week at a time is fine, or the whole program if it fits.
            </li>
            <li>
              Open Gemini, paste in the prompt below, and attach your screenshot(s) or PDF to the
              same message.
            </li>
            <li>
              Gemini replies with plain CSV text. Copy all of it — including the header row — into
              a new file and save it with a <code className="text-chalk">.csv</code> extension
              (any plain text editor works: Notepad, TextEdit, VS Code).
            </li>
            <li>
              Come back here and upload that <code className="text-chalk">.csv</code> file above —
              the program builds automatically, same as any other file.
            </li>
          </ol>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-body text-xs text-steel uppercase tracking-wide">
                Prompt for Gemini
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="font-body text-xs text-rust"
              >
                {copied ? "Copied!" : "Copy prompt"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-body text-xs text-chalk bg-graphite border border-steel/20 p-4 max-h-96 overflow-y-auto">
              {GEMINI_PROMPT}
            </pre>
          </div>

          <p className="font-body text-xs text-steel">
            A note on trust: this still runs through the same matching as any other upload — exact
            and close matches to your library are used automatically, anything with no match gets
            added as a new exercise, and any guessed (fuzzy) match gets flagged in the result so
            you know what to double-check. Vision extraction from an image is less reliable than a
            real spreadsheet export, so it&apos;s worth a glance at the finished program either way.
          </p>
        </div>
      )}
    </div>
  );
}
