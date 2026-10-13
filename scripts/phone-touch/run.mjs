import { chromium } from "playwright-core";
const W = Number(process.argv[2] || 375), H = Number(process.argv[3] || 812), SHOTS = process.argv[4] || "";
const UA = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function touch(type, x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
}
// A real finger drag: down, a series of moves over `ms`, up. Native scrolling and snapping handle it as on a phone.
async function swipe(x1, y1, x2, y2, ms = 260, steps = 14) {
  await touch("touchStart", x1, y1);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
    await sleep(ms / steps);
  }
  await touch("touchEnd", x2, y2);
  await sleep(700);
}
const state = () =>
  page.evaluate(() => {
    const s = document.querySelector("[data-exercise-id]").parentElement;
    const w = s.clientWidth;
    const idx = Math.round(s.scrollLeft / w);
    const card = s.children[idx];
    const r = card.getBoundingClientRect();
    const inner = card.firstElementChild.getBoundingClientRect();
    const bar = [...document.querySelectorAll("button")].find((b) => /complete workout/i.test(b.textContent || ""));
    const br = bar ? bar.closest("div").getBoundingClientRect() : null;
    return {
      idx,
      scrollLeft: Math.round(s.scrollLeft),
      aligned: Math.abs(s.scrollLeft - idx * w) < 2,
      cardTop: Math.round(inner.top),
      cardBottom: Math.round(inner.bottom),
      barTop: br ? Math.round(br.top) : null,
      vh: innerHeight,
      docScrollH: document.documentElement.scrollHeight,
      title: card.querySelector("h2")?.textContent,
    };
  });
await page.goto("http://localhost:3000/c/logger-harness", { waitUntil: "networkidle" });
await page.waitForSelector("[data-exercise-id]");
await sleep(1500);
const log = [];
log.push({ step: "start", ...(await state()) });
const y = Math.round(H * 0.45);
// swipe left (next) from the middle of the card, then from a set cell, then right (previous)
await swipe(Math.round(W * 0.8), y, Math.round(W * 0.2), y);
log.push({ step: "swipe left from card body", ...(await state()) });
await swipe(Math.round(W * 0.8), y, Math.round(W * 0.2), y);
log.push({ step: "swipe left again", ...(await state()) });
await swipe(Math.round(W * 0.2), y, Math.round(W * 0.8), y);
log.push({ step: "swipe right (back)", ...(await state()) });
// swipe starting on a number cell
const cell = await page.evaluate(() => { const s = document.querySelector("[data-exercise-id]").parentElement; const card = s.children[Math.round(s.scrollLeft / s.clientWidth)]; const ins = [...card.querySelectorAll("input[type=number]")].map((i) => i.getBoundingClientRect()).filter((r) => r.left > 0 && r.right < innerWidth); const r = ins[ins.length - 1]; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
await swipe(cell.x, cell.y, Math.max(5, cell.x - 280), cell.y);
log.push({ step: "swipe left starting ON a set cell", cell, ...(await state()) });
for (const l of log) console.log(JSON.stringify(l));
if (SHOTS) { await page.screenshot({ path: SHOTS }); }
await browser.close();
