# Phone touch check for the workout logger

CSS measured in a headless window is not a phone. These scripts drive Microsoft Edge in Android-phone emulation and send REAL touch events (Chrome DevTools Protocol `Input.dispatchTouchEvent`), so native scrolling, scroll-snap and scroll chaining behave as on a device. This is how the V5 swipe bugs were found (a slide's `overscroll-behavior: contain` blocking the drag, a timer pulling the card back under a paused finger, a set cell taking over the touch).

How to run (nothing here is part of the app build):
1. In a scratch folder: `npm init -y` then `npm i playwright-core` (it uses the Edge already on the machine, no browser download). Copy these scripts there.
2. Put `logger-harness.page.tsx.txt` at `app/c/logger-harness/page.tsx` in the app (a throwaway no-login page that renders the real SessionLogger with mock exercises; never commit it) and start the dev server.
3. `node measure.mjs 360 640 <shots-folder>` and `node measure.mjs 375 812 <shots-folder>`: real swipes through six exercises; prints card height, card bottom vs the Complete bar, inner scrolling, page scrolling.
   `node nested.mjs 360 640`: a 10-set card; a swipe on the set row scrolls the row, then hands off to the card. `node slow.mjs`: a slow drag with a pause. `node vert.mjs`: a tall card scrolls inside itself.
