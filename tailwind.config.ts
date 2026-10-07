import type { Config } from "tailwindcss";

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
        surface: "#262422",
        rust: "rgb(var(--rust) / <alpha-value>)",
        chalk: "rgb(var(--chalk) / <alpha-value>)",
        // Nudged from #8A8578 — the original failed WCAG AA contrast
        // (4.2:1) against the surface card background; this clears 4.5:1
        // there while reading as visually identical at a glance.
        steel: "#908B7E",
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
      },
    },
  },
  plugins: [],
} satisfies Config;
