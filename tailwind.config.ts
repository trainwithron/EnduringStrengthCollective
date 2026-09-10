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
        steel: "#8A8578",
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
    },
  },
  plugins: [],
} satisfies Config;
