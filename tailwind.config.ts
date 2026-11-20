import type { Config } from "tailwindcss";
import containerQueries from "@tailwindcss/container-queries";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // rust/graphite/chalk reference CSS custom properties (defaulted
        // in globals.css's :root, storing space-separated "R G B" — not
        // a hex string) so the coach desktop shell can override them
        // locally per-coach for branding, without touching every
        // component that uses bg-rust/text-graphite/etc. The
        // rgb(var(--x) / <alpha-value>) form is required for opacity
        // modifiers (bg-graphite/95, text-rust/60, etc.) to work at
        // all — a plain var(--x) reference can't be combined with
        // Tailwind's alpha-value substitution.
        graphite: "rgb(var(--graphite) / <alpha-value>)",
        // Look Refresh (Ron, Nov 20): the card colors follow the organization's ground (lib/theme.ts surfaceTokensFor): surface for cards and panels, surface-2 for raised
        // items in them, line for a quiet divider.
        surface: { DEFAULT: "rgb(var(--surface) / <alpha-value>)", 2: "rgb(var(--surface-2) / <alpha-value>)" },
        line: "rgb(var(--line) / <alpha-value>)",
        // Meaning colors (Look Refresh): coral for "needs you" and money owed, blue for check-ins, green for wins. The accent (rust) stays the one action color.
        alert: "#EE8A6E",
        checkin: "#7FB2E5",
        win: "#7CC49A",
        rust: "rgb(var(--rust) / <alpha-value>)",
        chalk: "rgb(var(--chalk) / <alpha-value>)",
        // Secondary text: the organization's own text color, dimmed and held at 4.5:1 on surface-2 (lib/theme.ts surfaceTokensFor). Was a fixed #908B7E.
        steel: "rgb(var(--steel) / <alpha-value>)",
        moss: "#6B8F71",
        // Third accent for a 3-way category split (Upper/Lower/
        // Conditioning) where rust and moss are already spoken for —
        // colorblind-safety checked, see program-card-visuals.
        // A scale (not a flat value) so bg-blue-400, bg-blue-500/35 and border-blue-400 exist; DEFAULT keeps bg-blue / text-blue as before.
        blue: { DEFAULT: "#4A7A9E", 400: "#5E94BA", 500: "#4A7A9E" },
        // The "good / done / open" green (lighter than moss so text on it clears 4.5:1), used by the calendar's open hours, the booked banner and many badges. It was used in dozens of
        // places and never defined, so those rendered with no colour.
        positive: "#7DB586",
        // Warm caution/neutral-emphasis tone for non-primary highlights (unsaved,
        // low readiness) so rust stays reserved for the primary action.
        // Merges into the default amber scale, so amber-400 etc. still work.
        amber: { DEFAULT: "#D9A441" },
      },
      // Look Refresh: borders much quieter; cards separate by their color, not by lines. border-steel/NN (about 2,000 uses) draws the secondary text color at under
      // half its opacity, so the usual border-steel/30 lands near #2E2A26 on a card and the stronger ones keep their order. divide-steel follows borderColor.
      borderColor: {
        steel: "rgb(var(--steel) / calc(<alpha-value> * 0.45))",
      },
      fontFamily: {
        // Same var()-reference trick as the colors above — lets the
        // coach desktop shell swap fonts per-coach without editing
        // every component that uses font-display/font-body.
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      borderRadius: {
        // Widens the org's existing Button Shape setting (lib/theme.ts's
        // radiusScaleFor) from "one flat radius on filled CTA buttons"
        // into a scale any surface can opt into — cards, inputs, badges,
        // the logging screen's set cells. Named distinctly (not
        // rounded-sm/md/lg) so this never silently reinterprets
        // Tailwind's own built-in radius scale for anything that isn't
        // deliberately opting in.
        "token-sm": "var(--r-sm)",
        "token-md": "var(--r-md)",
        "token-lg": "var(--r-lg)",
        "token-pill": "var(--r-pill)",
        "token-circle": "var(--r-circle)",
        // Look Refresh: cards and panels, and the rows inside them (square for a Sharp organization).
        card: "var(--r-card)",
        row: "var(--r-row)",
      },
    },
  },
  // @container on the coach page area, so pages pick their columns from the width they have (the split panel can take half the window).
  plugins: [containerQueries],
} satisfies Config;
