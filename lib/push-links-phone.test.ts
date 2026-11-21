import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { phoneCoachRedirect } from "@/lib/phone-coach-routes";

// Ron, Nov 21: a push tapped on a phone must open what it is about, never a page the phone redirects away from (lib/phone-coach-routes.ts). Every link written straight into a
// sendPushToProfile / sendCoachPush call in app/ and lib/ is checked here (a ${...} part stands for a real id). Notice pushes go through /notice/<id> (lib/notice-links.ts), whose
// targets lib/notice-every-type.test.ts checks.
const ROOT = join(__dirname, "..");
const SAMPLE = "11111111-1111-4111-8111-111111111111";

// Opening Home on purpose, with why.
const HOME_OK: Record<string, string> = {
  "app/api/cron/coach-digest/route.ts": "the morning digest is about the coach's day: Home (on a phone, their own app's Home)",
  // wrapped as noticeHref's fallback for a notice with no link (the push itself opens /notice/<id>)
  "app/api/cron/notification-push/route.ts": "only the fallback inside noticeHref; the push opens /notice/<id>",
  // a group not found for the organization (none made yet): Home
  "lib/ai-budget-server.ts": "only when the organization has no group yet; otherwise Plan & Billing",
};

// Pushes only to clients: the phone's coach redirect applies only to a person who coaches the group, so a client's own space opens as it is.
const TO_CLIENTS: Record<string, string> = {
  "app/api/cron/rest-day-nudge/route.ts": "a rest-day nudge to a client",
  "app/api/reup/remind/route.ts": "a re-up reminder to a client",
};

function pushLinks(): { file: string; link: string }[] {
  const out: { file: string; link: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
      const src = readFileSync(full, "utf8");
      if (!/send(CoachPush|PushToProfile)\(/.test(src)) continue;
      const file = relative(ROOT, full).split(sep).join("/");
      const call = /send(?:CoachPush|PushToProfile)\(([\s\S]*?)\)\s*[;.]/g;
      let m: RegExpExecArray | null;
      while ((m = call.exec(src))) {
        for (const lit of m[1].match(/(["`])(\/[^"`]*)\1/g) ?? []) out.push({ file, link: lit.slice(1, -1).replace(/\$\{[^}]+\}/g, SAMPLE) });
      }
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "lib"));
  return out;
}

describe("every push opens a page a phone keeps", () => {
  const links = pushLinks();
  it("finds the push links (a scan that finds nothing would pass anything)", () => {
    expect(links.length).toBeGreaterThan(15);
  });
  it("none is a page the phone redirects away from (Home only where listed, with why)", () => {
    const bad = links.filter(({ file, link }) => {
      const [pathAndQuery] = link.split("#");
      const [path, query = ""] = pathAndQuery.split("?");
      if (path === "/dashboard" && HOME_OK[file]) return false;
      if (TO_CLIENTS[file]) return false;
      return phoneCoachRedirect(path, query ? `?${query}` : "") !== null;
    });
    expect(bad.map((b) => `${b.file}: ${b.link}`)).toEqual([]);
  });
  it("the pushes the audit named land on their pages on the phone", () => {
    expect(phoneCoachRedirect("/running-low")).toBeNull();
    expect(phoneCoachRedirect("/recurring-conflicts")).toBeNull();
    expect(phoneCoachRedirect(`/groups/${SAMPLE}/business`)).toBeNull();
    expect(phoneCoachRedirect(`/groups/${SAMPLE}/business/leads`)).toBeNull();
    expect(phoneCoachRedirect(`/groups/${SAMPLE}/business/support`)).toBeNull();
    expect(phoneCoachRedirect(`/groups/${SAMPLE}/branding`, "?tab=billing")).toBeNull();
    expect(phoneCoachRedirect("/leaving")).toBeNull();
    expect(phoneCoachRedirect(`/notice/${SAMPLE}`)).toBeNull();
  });
});
