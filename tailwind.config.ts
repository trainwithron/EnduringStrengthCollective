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
        // rust/graphite reference CSS custom properties (defaulted in
        // globals.css's :root) so the coach desktop shell can override
        // them locally per-coach for branding, without touching every
        // component that uses bg-rust/text-graphite/etc.
        graphite: "var(--graphite)",
        surface: "#262422",
        rust: "var(--rust)",
        chalk: "var(--chalk)",
        // Nudged from #8A8578 — the original failed WCAG AA contrast
        // (4.2:1) against the surface card background; this clears 4.5:1
        // there while reading as visually identical at a glance.
        steel: "#908B7E",
        moss: "#6B8F71",
        // Third accent for a 3-way category split (Upper/Lower/
        // Conditioning) where rust and moss are already spoken for —
        // colorblind-safety checked, see program-card-visuals.
        blue: "#4A7A9E",
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
