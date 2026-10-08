# The default logo (Spotlight): one place to change it

The default mark is a halo at the top with a cone of light falling onto a barbell. It is only the DEFAULT: a coach's or gym's own uploaded logo or app icon always wins (lib/brand.ts, tested in lib/brand.test.ts).

- Source files: `public/brand/spotlight-mark-dark.svg` (for dark backgrounds), `spotlight-mark-light.svg` (for light ones), `spotlight-app-icon.svg` (512, rounded square), `spotlight-favicon.svg` (64).
- Where it is named in code: `lib/brand.ts` only. The component is `components/brand/spotlight-mark.tsx` (SpotlightMark, SpotlightLockup with real "SPOTLIGHT" / "COACHING" text); the share-card picture draws it with `lib/brand-canvas.ts`.
- To swap the logo for an artist's redraw: replace the four SVGs (keep the file names and viewBoxes: 200 / 200 / 512 / 64), run `npm run brand:icons`, commit. The PNG sizes (browser tab, apple-touch icon, home-screen icons including the maskable ones with a safe margin, the push badge, the social image) are rebuilt from the SVGs by `scripts/generate-brand-icons.mjs`. If the colours change, update `BRAND.palette` in lib/brand.ts (a test checks it against the SVGs).
- An installed home-screen app (PWA) keeps the old icon until it is removed and added again; the browser tab, shared links and notifications pick up the new one at once.
- What is NOT customised by an organisation's own logo or icon: the push notification icon and badge (public/sw.js uses the Spotlight defaults for everyone), and the social image. The tab icon, the home-screen icons (web app manifest) and the logo shown in the app do follow the organisation. The layout emits an organisation's icon as the ONLY icon links (the Spotlight default is emitted only when there is none), so the browser cannot pick the default over it.
- The icon files live in public/ (favicon.ico, apple-icon.png, icon-*.png), not in app/: files in app/ are emitted for every viewer.
- sharp (a dev dependency) draws the PNGs. The social image uses Barlow Condensed from the system font list; regenerate it only on a machine that has that font, or the lettering changes (the PNG is committed).
