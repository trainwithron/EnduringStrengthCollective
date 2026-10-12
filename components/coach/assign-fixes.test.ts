import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Assign cannot run twice from a quick double click", () => {
  const menu = read("components/coach/desktop/program-card-menu.tsx");
  it("the program menu's three assign handlers all go through one in-flight guard set before the first await", () => {
    expect(menu).toContain("const assigning = useRef(false);");
    expect(menu).toContain("return once(() => assignToPosition(position));");
    expect(menu).toContain("return once(() => assignToClient(client));");
    expect(menu).toContain("return once(assignToSelf);");
    const once = menu.slice(menu.indexOf("async function once("), menu.indexOf("const [error"));
    expect(once.indexOf("assigning.current = true")).toBeLessThan(once.indexOf("await run()"));
    expect(once).toContain("finally");
  });
  it("the client's Programs-tab picker has the same guard", () => {
    const actions = read("components/coach/client-program-actions.tsx");
    expect(actions).toContain("if (busyId || assigning.current) return;");
    expect(actions.indexOf("assigning.current = true")).toBeLessThan(actions.indexOf("await assignOnce(program)"));
  });
});

describe("the assigned message matches what happened", () => {
  const menu = read("components/coach/desktop/program-card-menu.tsx");
  it("an attached program says it is theirs now; a copy still says they have their own copy", () => {
    expect(menu).toContain("attached: result.attached");
    expect(menu).toContain("They have been notified. This program is theirs now.");
    expect(menu).toContain("They have been notified and now have their own copy.");
    expect(menu).toContain('assigned.attached ? "Open their program" : "Open their copy"');
  });
});

describe("assign only attaches inside one organization", () => {
  it("the migration compares the two groups' organizations before attaching", () => {
    const sql = read("supabase/migrations/0337_assign_same_org_only.sql");
    expect(sql).toContain("and v_src_org is not distinct from v_dest_org");
    expect(sql).not.toMatch(/delete from|drop table/);
  });
});

describe("a prospect is never silently left unnotified", () => {
  const lib = read("lib/trainer-dispatch-advance.ts");
  it("a failed or unconfigured email is logged plainly and the trainer is told", () => {
    expect(lib).toContain("async function emailProspect(");
    expect(lib).toContain("console.error(`[dispatch] the ${what} email was not sent");
    expect(lib).toContain("Booked. We couldn't email ${request.prospect_name} to confirm, so please let them know yourself: ${request.prospect_email}");
    expect(lib).toContain("Your question was saved, but we couldn't email ${request.prospect_name}. Please contact them yourself: ${request.prospect_email}");
    // the log line carries no address
    expect(lib.slice(lib.indexOf("async function emailProspect("), lib.indexOf("export async function acceptDispatchStep"))).not.toContain("prospect_email");
  });
  it("the routes pass the notice on and the buttons show it", () => {
    expect(read("app/api/org-dispatch/accept/route.ts")).toContain("notice: result.notice");
    expect(read("app/api/org-dispatch/ask-question/route.ts")).toContain("notice: result.notice");
    expect(read("components/coach/dispatch-step-actions.tsx")).toContain("confirmDialog({ message: data.notice");
  });
});
