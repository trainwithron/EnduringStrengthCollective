import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { miniRestLabel, nextRestView, restProgress, swipeDirection, SWIPE_THRESHOLD_PX } from "@/lib/rest-sheet-view";

// Ron, Nov 21 (a live workout on his phone): "The timer needs to be able to be swiped down." The rest sheet covered the set rows and its handle did nothing.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const bar = read("components/session/rest-timer-bar.tsx");

describe("minimize and restore", () => {
  it("a swipe down on the handle, or a tap on it, minimizes the sheet", () => {
    expect(nextRestView("sheet", "drag-down")).toBe("mini");
    expect(nextRestView("sheet", "tap-handle")).toBe("mini");
  });
  it("a tap on the slim bar, or a swipe up, brings the sheet back", () => {
    expect(nextRestView("mini", "tap-mini")).toBe("sheet");
    expect(nextRestView("mini", "drag-up")).toBe("sheet");
  });
  it("anything else leaves it as it is", () => {
    expect(nextRestView("sheet", "drag-up")).toBe("sheet");
    expect(nextRestView("sheet", "tap-mini")).toBe("sheet");
    expect(nextRestView("mini", "drag-down")).toBe("mini");
    expect(nextRestView("mini", "tap-handle")).toBe("mini");
  });
  it("a swipe is 40px or more; less is a tap or a wobble", () => {
    expect(SWIPE_THRESHOLD_PX).toBe(40);
    expect(swipeDirection(100, 140)).toBe("down");
    expect(swipeDirection(100, 139)).toBeNull();
    expect(swipeDirection(300, 250)).toBe("up");
    expect(swipeDirection(300, 280)).toBeNull();
  });
  it("a press that was a swipe is not also a tap", () => {
    expect(bar).toContain("swipeTookTap.current = true;\n        onSwipe(direction);");
    expect(bar).toContain("if (swipeTookTap.current) {\n      swipeTookTap.current = false;\n      return;\n    }");
  });
  it("the handle and the slim bar are buttons that work with a plain tap, and only they take a drag (the page and the sheet still scroll)", () => {
    expect(bar).toContain('onClick={() => tap("tap-handle")}');
    expect(bar).toContain('aria-label="Minimize rest timer"');
    expect(bar).toContain('onClick={() => tap("tap-mini")}');
    expect(bar).toContain('aria-label="Show rest timer"');
    expect(bar.match(/touch-none select-none/g)?.length).toBe(2);
    expect(bar).not.toMatch(/data-rest-sheet[\s\S]{0,400}onPointerDown/);
  });
  it("the sheet follows the finger and has no animation for reduced motion", () => {
    expect(bar).toContain("style={dragDy > 0 ? { transform: `translateY(${dragDy}px)` } : undefined}");
    expect(bar).toContain('${dragDy > 0 ? "" : "motion-safe:transition-transform"}');
  });
});

describe("the slim bar", () => {
  it('says "Rest 0:40" with a progress line, and "Rest done" when it ends', () => {
    expect(miniRestLabel("0:40", false)).toBe("Rest 0:40");
    expect(miniRestLabel("", true)).toBe("Rest done");
    expect(restProgress(40, 60)).toBeCloseTo(1 / 3);
    expect(restProgress(0, 60)).toBe(1);
    expect(restProgress(60, 60)).toBe(0);
    expect(bar).toContain("{miniRestLabel(formatMMSS(remaining), false)}");
    expect(bar).toContain('{justFinished && !running && !showPrompt && view === "mini" && (');
  });
  it("Skip works from the slim bar (the same skip as the sheet's)", () => {
    expect(bar).toContain('<button type="button" onClick={skip} className="h-11 px-4 shrink-0 rounded-token-pill bg-rust text-graphite font-body text-sm font-semibold" data-rest-mini-skip>');
  });
  it("sits just above the logger's bottom bar, which keeps room under the last set for it", () => {
    expect(bar).toContain('const miniBottom = raised ? "bottom-[calc(10.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(5.75rem+env(safe-area-inset-bottom))]";');
    const logger = read("components/logging/session-logger.tsx");
    expect(logger).toContain("onMinimizedChange={setRestMinimized}");
    expect(logger).toContain('{!isCompleted && restMinimized && <div aria-hidden="true" className="h-20" data-rest-mini-space />}');
    // the timer going away (the workout finished while minimized) gives the room back
    expect(bar).toContain("() => () => onMinimizedChange?.(false),");
  });
});

describe("the countdown is the same one either way", () => {
  it("the ticking, the end alert and the vibration do not depend on how it shows", () => {
    const tick = bar.slice(bar.indexOf("const interval = setInterval(() => {"), bar.indexOf("function startPreset("));
    expect(tick).toContain("playRestAlert();");
    expect(tick).toContain("}, [running, sessionId]);");
    expect(tick).not.toContain("view");
  });
  it("minimizing closes what the bar cannot show, never the rest itself", () => {
    const change = bar.slice(bar.indexOf("function changeView("), bar.indexOf("function swipeHandlers("));
    expect(change).toContain("setSelectedGame(null);");
    expect(change).not.toContain("setRunning(");
    expect(change).not.toContain("clearRestTimerState(");
  });
  it("the coach's rest keeps its rule, and the Rest? prompt and the task gate are unchanged", () => {
    expect(bar).toContain('{running.source !== "coach" && (');
    expect(bar).toContain('<section aria-label="Start a rest"');
    expect(bar).toContain("🔒 Unlock");
  });
});
