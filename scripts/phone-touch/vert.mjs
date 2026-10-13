import { chromium } from "playwright-core";
const W = 360, H = 640;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function touch(type, x, y) { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] }); }
async function drag(x1, y1, x2, y2) { await touch("touchStart", x1, y1); for (let i = 1; i <= 12; i++) { await touch("touchMove", x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12); await sleep(20); } await touch("touchEnd", x2, y2); await sleep(700); }
await page.goto("http://localhost:3000/c/logger-harness", { waitUntil: "networkidle" });
await page.waitForSelector("[data-exercise-id]");
await sleep(1500);
const top = await page.evaluate(() => Math.round(document.querySelector("[data-exercise-id]").parentElement.getBoundingClientRect().top));
await drag(300, top + 80, 40, top + 80); await drag(300, top + 80, 40, top + 80); // to the long-name card (idx 2)
const info = () => page.evaluate(() => { const s = document.querySelector("[data-exercise-id]").parentElement; const slide = s.children[Math.round(s.scrollLeft / s.clientWidth)]; return { card: Math.round(s.scrollLeft / s.clientWidth), slideScrollTop: Math.round(slide.scrollTop), slideScrollable: slide.scrollHeight - slide.clientHeight, pageScrollY: Math.round(scrollY) }; });
console.log("on the long-name card:", JSON.stringify(await info()));
await drag(180, top + 300, 180, top + 120); // finger up = content down
console.log("after a vertical drag up inside the card:", JSON.stringify(await info()));
await drag(180, top + 120, 180, top + 300);
console.log("after a vertical drag back down:", JSON.stringify(await info()));
await browser.close();
