import { chromium } from "playwright-core";
const W = 360, H = 640;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function touch(type, x, y) { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] }); }
const sl = () => page.evaluate(() => Math.round(document.querySelector("[data-exercise-id]").parentElement.scrollLeft));
await page.goto("http://localhost:3000/c/logger-harness", { waitUntil: "networkidle" });
await page.waitForSelector("[data-exercise-id]");
await sleep(1500);
const y = await page.evaluate(() => Math.round(document.querySelector("[data-exercise-id]").parentElement.getBoundingClientRect().top + 80));
// slow drag left 120px, HOLD with the finger down for 600ms, then drag on to 260px and release
await touch("touchStart", 300, y);
for (let i = 1; i <= 12; i++) { await touch("touchMove", 300 - i * 10, y); await sleep(40); }
const mid1 = await sl();
await sleep(600);
const mid2 = await sl();
for (let i = 1; i <= 14; i++) { await touch("touchMove", 180 - i * 10, y); await sleep(40); }
const beforeRelease = await sl();
await touch("touchEnd", 40, y);
await sleep(1000);
console.log(JSON.stringify({ afterDrag120: mid1, afterHold600ms: mid2, beforeRelease, afterRelease: await sl(), expectedNextCardAt: W }));
await browser.close();
