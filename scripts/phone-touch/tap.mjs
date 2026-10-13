import { chromium } from "playwright-core";
const UA = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const touch = (t, x, y) => cdp.send("Input.dispatchTouchEvent", { type: t, touchPoints: t === "touchEnd" ? [] : [{ x, y, id: 1 }] });
await page.goto("http://localhost:3111/c/logger-harness", { waitUntil: "networkidle" }); await sleep(1500);
const cells = () => page.evaluate(() => [...document.querySelectorAll("input[placeholder]")].slice(0, 12).map((i) => { const r = i.getBoundingClientRect(); return { ph: i.placeholder, v: i.value, x: r.x + r.width / 2, y: r.y + r.height / 2, f: document.activeElement === i }; }));
let c = await cells(); console.log("before", JSON.stringify(c));
const t = c.find((k) => k.ph !== "—" && k.v === "");
await touch("touchStart", t.x, t.y); await sleep(50); await touch("touchEnd", t.x, t.y); await sleep(500);
c = await cells(); console.log("after tap1", JSON.stringify(c.slice(3,6)));
const p2 = c[3];
await touch("touchStart", p2.x, p2.y); await sleep(50); await touch("touchEnd", p2.x, p2.y); await sleep(500);
c = await cells(); console.log("after tap2", JSON.stringify(c.slice(3,6)));
// swipe starting on a set cell still moves the carousel
const before = await page.evaluate(() => document.querySelector("[data-exercise-id]").parentElement.scrollLeft);
const t2 = c.find((k) => k.v === "" && k.ph !== "—") || c[3];
await touch("touchStart", t2.x + 30, t2.y);
for (let i = 1; i <= 14; i++) { await touch("touchMove", t2.x + 30 - i * 20, t2.y); await sleep(18); }
await touch("touchEnd", t2.x - 250, t2.y); await sleep(900);
console.log("carousel", before, "->", await page.evaluate(() => document.querySelector("[data-exercise-id]").parentElement.scrollLeft));
await browser.close();
