import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const W = Number(process.argv[2] || 375), H = Number(process.argv[3] || 812), OUT = process.argv[4] || "";
if (OUT) mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function touch(type, x, y) { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] }); }
async function swipe(x1, y1, x2, y2, ms = 260, steps = 14) {
  await touch("touchStart", x1, y1);
  for (let i = 1; i <= steps; i++) { await touch("touchMove", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await sleep(ms / steps); }
  await touch("touchEnd", x2, y2); await sleep(800);
}
const measure = () => page.evaluate(() => {
  const s = document.querySelector("[data-exercise-id]").parentElement;
  const idx = Math.round(s.scrollLeft / s.clientWidth);
  const slide = s.children[idx];
  const inner = slide.firstElementChild.getBoundingClientRect();
  const barBtn = [...document.querySelectorAll("button")].find((b) => /complete workout/i.test(b.textContent || ""));
  const bar = barBtn.closest("div.fixed") || barBtn.parentElement;
  const barTop = bar.getBoundingClientRect().top;
  const coach = document.querySelector("[data-testid=coach-mode-bar]").getBoundingClientRect();
  return {
    idx, title: slide.querySelector("h2")?.textContent?.slice(0, 40),
    coachBarH: Math.round(coach.height), cardTop: Math.round(inner.top), cardBottom: Math.round(inner.bottom), barTop: Math.round(barTop),
    cardH: Math.round(inner.height), cardPctOfViewport: Math.round((inner.height / innerHeight) * 100) + "%",
    fitsAboveBar: inner.bottom <= barTop + 0.5, innerScroll: slide.scrollHeight > slide.clientHeight + 1, vh: innerHeight, vw: innerWidth, pageScrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 1, docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, scrollerH: Math.round(slide.parentElement.getBoundingClientRect().height), slideH: Math.round(slide.getBoundingClientRect().height),
  };
});
await page.goto("http://localhost:3000/c/logger-harness", { waitUntil: "networkidle" });
await page.waitForSelector("[data-exercise-id]");
await sleep(1800);
const y = 0;
for (let i = 0; i < 6; i++) {
  console.log(JSON.stringify(await measure()));
  if (OUT) await page.screenshot({ path: `${OUT}/card${i + 1}.png` });
  if (i < 5) { const cy = await page.evaluate(() => { const s = document.querySelector("[data-exercise-id]").parentElement; const r = s.getBoundingClientRect(); return Math.round(r.top + 70); }); await swipe(Math.round(W * 0.85), cy, Math.round(W * 0.1), cy); }
}
await browser.close();
