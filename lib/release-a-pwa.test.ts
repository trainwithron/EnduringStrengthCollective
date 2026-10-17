import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SetLogSaver } from "@/lib/set-log-saver";
import { MemoryOutbox } from "@/lib/set-outbox";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("a logged set is kept on the phone until the database confirms it", () => {
  it("is written to the phone's copy before the first try, stays while saving fails, and goes once it is confirmed", async () => {
    const outbox = new MemoryOutbox();
    let ok = false;
    const saver = new SetLogSaver({ write: async () => ok, outbox, backoffMs: [] });
    saver.queue("s1", { weight: 100 });
    await tick();
    expect((await outbox.all()).map((e) => e.id)).toEqual(["s1"]);
    expect((await outbox.all())[0].payload).toEqual({ weight: 100 });
    ok = true;
    saver.retryAll();
    await tick();
    await tick();
    expect(await outbox.all()).toEqual([]);
  });
  it("keeps the merged change when a set is edited twice offline", async () => {
    const outbox = new MemoryOutbox();
    const saver = new SetLogSaver({ write: async () => false, outbox, backoffMs: [] });
    saver.queue("s1", { weight: 100 });
    saver.queue("s1", { reps: 5 });
    await tick();
    expect((await outbox.all())[0].payload).toEqual({ weight: 100, reps: 5 });
  });
  it("sends again what an earlier visit kept, newer edits made since winning", async () => {
    const outbox = new MemoryOutbox();
    const sent: Array<[string, Record<string, unknown>]> = [];
    const saver = new SetLogSaver({
      write: async (id, payload) => {
        sent.push([id, payload]);
        return true;
      },
      outbox,
      backoffMs: [],
    });
    saver.restore([
      { id: "a", payload: { weight: 80, reps: 8 }, savedAt: 1 },
      { id: "b", payload: { weight: 50 }, savedAt: 2 },
    ]);
    await saver.flush();
    expect(sent.map((s) => s[0]).sort()).toEqual(["a", "b"]);
    expect(saver.unsaved).toEqual([]);
    const failing = new SetLogSaver({ write: async () => false, outbox: new MemoryOutbox(), backoffMs: [] });
    failing.queue("a", { weight: 90 });
    failing.restore([{ id: "a", payload: { weight: 80, reps: 8 }, savedAt: 1 }]);
    await tick();
    expect(failing.unsaved).toEqual(["a"]);
  });
  it("forgets a set that was deleted so it can never block or reappear", async () => {
    const outbox = new MemoryOutbox();
    const saver = new SetLogSaver({ write: async () => false, outbox, backoffMs: [] });
    saver.queue("gone", { weight: 1 });
    await tick();
    saver.discard(["gone"]);
    await tick();
    expect(await outbox.all()).toEqual([]);
  });
});

describe("the app keeps working with a bad or no signal", () => {
  it("the workout screen sends kept sets on open, on reconnect and on coming back to the front, and asks the browser to keep the phone's copy", () => {
    const ctx = src("components/logging/set-save-context.tsx");
    expect(ctx).toContain("saver.restore(kept)");
    expect(ctx).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(ctx).toContain("requestPersistentStorage()");
    expect(ctx).toContain("Saved on this phone.");
  });
  it("opening the app anywhere replays what is kept, and registers the offline layer", () => {
    expect(src("app/layout.tsx")).toContain("<SetOutboxReplay />");
    const replay = src("components/set-outbox-replay.tsx");
    expect(replay).toContain('register("/sw.js")');
    expect(replay).toContain("saver.restore(kept)");
    // follow-ups from review: no storage prompt for a first-time visitor, kept pages purged on sign-in, kept sets tagged with their owner, a replaced icon is never stale
    expect(replay.indexOf("requestPersistentStorage();")).toBeGreaterThan(replay.indexOf("if (kept.length > 0)"));
    expect(replay).toContain('event !== "SIGNED_IN"');
    expect(replay).toContain("getItem(LAST_USER_KEY) !== session.user.id");
    expect(src("lib/set-outbox.ts")).toContain("r.userId === uid");
    expect(src("public/sw.js")).not.toContain("startsWith(\"/brand/\")");
  });
  it("the service worker keeps the app's files and an opened workout page, never data, and is cleared on sign out", () => {
    const sw = src("public/sw.js");
    expect(sw).toContain('url.pathname.startsWith("/sessions/")');
    expect(sw).toContain('"/offline.html"');
    expect(sw).not.toContain("/api/");
    expect(sw).not.toContain("supabase");
    expect(src("components/group/sign-out-button.tsx")).toContain("purgeOfflinePages()");
    expect(src("lib/supabase/middleware.ts")).toContain('pathname === "/offline.html"');
  });
  it("the rest timer shows the true time and takes the wake lock again when the app comes back to the front", () => {
    const t = src("components/session/rest-timer-bar.tsx");
    expect(t).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(t).toContain("void acquireWakeLock();");
  });
  it("an installed app in a wide window with a mouse is the desktop experience, not phone mode", () => {
    const pwa = src("lib/pwa.ts");
    expect(pwa).toContain("window.innerWidth >= 1024");
    expect(pwa).toContain('isStandaloneDisplay() && !isWideDesktopWindow() ? "1" : "0"');
  });
});
