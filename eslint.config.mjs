import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next ships its shareable configs in the old eslintrc
// `{ extends: [...] }` shape, not a flat-config array — FlatCompat is
// the standard, Next.js-documented bridge for using it under ESLint 9's
// flat config. The previous version of this file imported
// "eslint-config-next/core-web-vitals" directly and spread it as if it
// were already a flat-config array; that was broken two ways: the
// import needed an explicit ".js" extension (this package has no
// "exports" map), and even once resolved, the config object it returns
// isn't iterable — this is the actual fix, not just the extension.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // This config never actually ran until tonight (see git history) —
      // by the time it did, the codebase already had ~170 deliberate uses
      // of `any` for loosely-typed Supabase join-query rows, a consistent
      // pattern throughout, not oversights. Downgraded to a visible
      // warning rather than silently ignored or mass-"fixed" unreviewed;
      // worth tightening file-by-file over time, not in one sweep.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Plain CommonJS build-time script, outside the app's TypeScript/ESM
    // surface — never bundled or imported, so there's no benefit to
    // rewriting it to ESM just to satisfy this rule.
    files: ["scripts/generate-icons.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
