// What a new client still needs to do to get the app working properly on
// their phone, worked out from the live state of their device. Nothing here is
// stored: the answers come from the browser every time, so the card can never
// disagree with reality.

export type DevicePlatform = "ios-safari" | "ios-other" | "android" | "desktop";

export function detectPlatform(userAgent: string): DevicePlatform {
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ reports as a Mac, so "ipad" alone is not enough; the caller can
  // pass maxTouchPoints through `isTouchMac` if it matters. Phones are the case here.
  if (/iphone|ipad|ipod/.test(ua)) {
    // Only Safari can add to the iPhone home screen; Chrome, Firefox and Edge on iOS cannot.
    return /crios|fxios|edgios|opios/.test(ua) ? "ios-other" : "ios-safari";
  }
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export type PushState = "loading" | "unsupported" | "denied" | "off" | "on";

export type GuideStepKey = "install" | "notifications";
export type GuideStepStatus = "done" | "todo" | "blocked" | "hidden";

export interface GuideStep {
  key: GuideStepKey;
  status: GuideStepStatus;
  // Why a step cannot be done yet, in words a client can act on.
  reason?: "needs-install" | "denied" | "unsupported";
}

export interface GuideInput {
  platform: DevicePlatform;
  standalone: boolean;
  push: PushState;
}

export function computeGuideSteps({ platform, standalone, push }: GuideInput): GuideStep[] {
  // Step 1 only exists on a phone that is still in a browser tab.
  const installNeeded = platform !== "desktop" && !standalone;
  const install: GuideStep = { key: "install", status: installNeeded ? "todo" : platform === "desktop" ? "hidden" : "done" };

  let notifications: GuideStep;
  if (push === "on") {
    notifications = { key: "notifications", status: "done" };
  } else if (platform.startsWith("ios") && !standalone) {
    // iPhone only delivers web push to an installed home-screen app, never to a Safari tab.
    notifications = { key: "notifications", status: "blocked", reason: "needs-install" };
  } else if (push === "denied") {
    notifications = { key: "notifications", status: "blocked", reason: "denied" };
  } else if (push === "unsupported") {
    notifications = { key: "notifications", status: "blocked", reason: "unsupported" };
  } else {
    notifications = { key: "notifications", status: "todo" };
  }

  return [install, notifications];
}

// The card is finished when nothing is left to do. A step that is "blocked"
// because the platform cannot do it (unsupported) does not hold the card open.
export function isGuideComplete(steps: GuideStep[]): boolean {
  return steps.every(
    (s) => s.status === "done" || s.status === "hidden" || (s.status === "blocked" && s.reason === "unsupported")
  );
}
