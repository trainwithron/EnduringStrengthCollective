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
        graphite: "#1C1B1A",
        surface: "#262422",
        rust: "#C4622D",
        chalk: "#EDE8E0",
        steel: "#8A8578",
        moss: "#6B8F71",
      },
      fontFamily: {
        display: ["Barlow Condensed", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
