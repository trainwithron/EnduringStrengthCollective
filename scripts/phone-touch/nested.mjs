import { chromium } from "playwright-core";
const W = Number(process.argv[2] || 375), H = Number(process.argv[3] || 812);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function touch(type, x, y) { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] }); }
async function swipe(x1, y1, x2, y2, ms = 260, steps = 14) {
  await touch("touchStart", x1, y1);
  for (let i = 1; i <= steps; i++) { await touch("touchMove", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await sleep(ms / steps); }
  await touch("touchEnd", x2, y2); await sleep(900);
}
const st = () => page.evaluate(() => {
  const s = document.querySelector("[data-exercise-id]").parentElement;
  const idx = Math.round(s.scrollLeft / s.clientWidth);
  const card = s.children[idx];
  const inner = [...card.querySelectorAll("div")].find((d) => getComputedStyle(d).overflowX === "auto" && d.scrollWidth > d.clientWidth);
  return { carouselIdx: idx, rowScrollable: !!inner, rowScrollLeft: inner ? Math.round(inner.scrollLeft) : null, rowMax: inner ? inner.scrollWidth - inner.clientWidth : null, vh: innerHeight };
});
await page.goto("http://localhost:3000/c/logger-harness", { waitUntil: "networkidle" });
await page.waitForSelector("[data-exercise-id]");
await sleep(1500);
// go to the 10-set card (index 3) with real swipes
const mid = Math.round(H * 0.4);
for (let i = 0; i < 3; i++) await swipe(Math.round(W * 0.85), mid - 60, Math.round(W * 0.1), mid - 60);
console.log("at 10-set card:", JSON.stringify(await st()));
const cellRow = await page.evaluate(() => { const s = document.querySelector("[data-exercise-id]").parentElement; const card = s.children[Math.round(s.scrollLeft / s.clientWidth)]; const ins = [...card.querySelectorAll("input[type=number]")].map((i) => i.getBoundingClientRect()).filter((r) => r.left > 0 && r.right < innerWidth); const r = ins[ins.length - 1]; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
await swipe(cellRow.x, cellRow.y, Math.max(5, cellRow.x - 220), cellRow.y);
console.log("swipe left ON the set row (should scroll the row, not the card):", JSON.stringify(await st()));
for (let i = 0; i < 4; i++) { await swipe(cellRow.x, cellRow.y, Math.max(5, cellRow.x - 250), cellRow.y); }
console.log("after more swipes on the row (row at its end):", JSON.stringify(await st()));
await swipe(cellRow.x, cellRow.y, Math.max(5, cellRow.x - 280), cellRow.y);
console.log("one more on the row at its end (hands off to the card):", JSON.stringify(await st()));
// a swipe on the card header always moves the card
await page.evaluate(() => {});
await swipe(Math.round(W * 0.85), mid - 60, Math.round(W * 0.1), mid - 60);
console.log("swipe on the header area:", JSON.stringify(await st()));
await browser.close();
