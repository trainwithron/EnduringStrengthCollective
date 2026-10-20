import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPhoneView, isTabletUA, phoneCoachRedirect } from "./phone-coach-routes";

// Ron, Oct 19: "tab should be able to switch between both". A tablet opens the phone app like a phone, and only a tablet is offered the switch.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const GALAXY_TAB = "Mozilla/5.0 (Linux; Android 14; SM-X520) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 15; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPADOS_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

describe("what is a tablet", () => {
  it("a Galaxy Tab (Android without Mobile), an iPad, and iPadOS reporting a Mac with touch", () => {
    expect(isTabletUA(GALAXY_TAB)).toBe(true);
    expect(isTabletUA(IPAD)).toBe(true);
    expect(isTabletUA(IPADOS_AS_MAC, 5)).toBe(true);
  });
  it("never a phone or a computer (a Mac without touch is a computer)", () => {
    expect(isTabletUA(ANDROID_PHONE)).toBe(false);
    expect(isTabletUA(IPHONE)).toBe(false);
    expect(isTabletUA(DESKTOP)).toBe(false);
    expect(isTabletUA(IPADOS_AS_MAC)).toBe(false);
    expect(isTabletUA(IPADOS_AS_MAC, 0)).toBe(false);
  });
});

describe("the switch is the existing view choice", () => {
  it("a tablet opens the phone app by default, and the computer layout once chosen", () => {
    expect(isPhoneView({ override: null, standalone: null, userAgent: GALAXY_TAB })).toBe(true);
    expect(isPhoneView({ override: "desktop", standalone: null, userAgent: GALAXY_TAB })).toBe(false);
    expect(isPhoneView({ override: "mobile", standalone: null, userAgent: GALAXY_TAB })).toBe(true);
  });
  it("in the computer layout a tablet is never sent to a phone page (the middleware asks isPhoneView, which the choice wins)", () => {
    const mw = read("lib/supabase/middleware.ts");
    expect(mw).toContain("isPhoneView({ override: request.cookies.get(VIEW_OVERRIDE_COOKIE)?.value");
    // a computer page still has a phone target, so only the choice keeps the tablet on it
    expect(phoneCoachRedirect("/running-low")).not.toBeNull();
  });
});

describe("where the switch shows", () => {
  const sw = read("components/coach/tablet-layout-switch.tsx");
  it("it renders nothing unless the device is a tablet", () => {
    expect(sw).toContain("setTablet(isTabletUA(navigator.userAgent, navigator.maxTouchPoints));");
    expect(sw).toContain("if (!tablet) return null;");
    expect(sw).toContain('const label = to === "desktop" ? "Computer layout" : "Phone layout";');
    expect(sw).toContain("writeViewOverride(to);");
  });
  it("ONE 'Computer layout' row in the coach's own Settings on the phone (Release 2: there is no More list), ONE 'Phone layout' button in the computer rail footer", () => {
    const more = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(more.match(/<TabletLayoutSwitch /g)?.length).toBe(1);
    expect(more).toContain('<TabletLayoutSwitch to="desktop" />');
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell.match(/<TabletLayoutSwitch /g)?.length).toBe(1);
    expect(shell).toContain('<TabletLayoutSwitch to="mobile" variant="rail" />');
  });
  it("the phone app still has no Desktop mode anywhere", () => {
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).not.toContain("Desktop mode");
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).not.toContain("Desktop mode");
  });
  it("a tablet in the computer layout is not told it is stuck in desktop mode", () => {
    expect(read("app/(coach)/dashboard/page.tsx")).toContain("const stuckInDesktopModeOnRealPhone = (await isMobileUserAgent()) && !(await isTabletUserAgent());");
  });
});
