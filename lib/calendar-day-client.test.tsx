import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Oct 27: a client's day page (and a coach's own, in their personal space) crashed whenever the day showed a time: the open times read the coach branch's `timezone`, declared further down
// the same function, before it was set ("Cannot access 'ap' before initialization"). Broken since Oct 6. The page is called here the way Next calls it, in the client branch, against a small
// in-memory database, for an undated program, a dated one, no program, and the coach as their own athlete.
const state = vi.hoisted(() => ({
  user: { id: "client-1" } as { id: string },
  acting: { athleteId: "client-1", isActingAsOther: false },
  tables: {} as Record<string, Record<string, unknown>[]>,
  phone: false,
}));

type Row = Record<string, unknown>;
function table(name: string) {
  let rows: Row[] = [...(state.tables[name] ?? [])];
  const done = () => ({ data: rows, error: null, count: rows.length });
  const b: Record<string, unknown> = {};
  const keep = (fn: (r: Row) => boolean) => ((rows = rows.filter(fn)), b);
  Object.assign(b, {
    select: () => b,
    order: () => b,
    limit: () => b,
    range: () => b,
    or: () => b,
    not: () => b,
    filter: () => b,
    eq: (c: string, v: unknown) => keep((r) => r[c] === v),
    neq: (c: string, v: unknown) => keep((r) => r[c] !== v),
    in: (c: string, v: unknown[]) => keep((r) => v.includes(r[c])),
    is: (c: string, v: unknown) => keep((r) => (v === null ? r[c] == null : r[c] === v)),
    gte: (c: string, v: string) => keep((r) => String(r[c]) >= v),
    gt: (c: string, v: string) => keep((r) => String(r[c]) > v),
    lte: (c: string, v: string) => keep((r) => String(r[c]) <= v),
    lt: (c: string, v: string) => keep((r) => String(r[c]) < v),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(done()).then(resolve, reject),
  });
  return b;
}
const fakeDb = () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from: (t: string) => table(t),
  rpc: async () => ({ data: null, error: null }),
});

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fakeDb() }));
vi.mock("@/lib/acting-as", () => ({ getEffectiveAthlete: async () => state.acting }));
vi.mock("@/lib/pwa-server", () => ({ prefersAthleteStyleView: async () => state.phone, isMobileUserAgent: async () => state.phone, getViewOverride: async () => null, isPwaStandalone: async () => false, isTabletUserAgent: async () => false }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: CalendarDayPage } = await import("@/app/(coach)/groups/[groupId]/calendar/[date]/page");

// Every string in the tree the page returns (components are not called; their text props are read).
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") return (out.push(String(node)), out);
  if (Array.isArray(node)) return (node.forEach((n) => texts(n, out)), out);
  if (typeof node === "object" && "props" in (node as object)) {
    const props = (node as { props: Record<string, unknown> }).props;
    for (const [k, v] of Object.entries(props)) {
      if (k === "children") texts(v, out);
      else if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) for (const o of v) if (o && typeof o === "object" && typeof (o as { label?: unknown }).label === "string") out.push((o as { label: string }).label);
    }
  }
  return out;
}

// The names a scope binds itself: its own let/const/var, a function's parameters, a catch's variable.
function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const e of name.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, out);
  return out;
}
// A let/const read inside a callback that runs at once (an argument of a call, or JSX) that comes before its own declaration in the scope it resolves to: when the callback runs, the
// variable is not set yet (a ReferenceError, which tsc does not catch inside a callback). Read from the file's syntax alone.
function readsBeforeSet(text: string): string[] {
  const sf = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const scopes: { node: ts.Node; names: Map<string, { pos: number; blockScoped: boolean }> }[] = [];
  const found: string[] = [];
  const own = (node: ts.Node) => {
    const names = new Map<string, { pos: number; blockScoped: boolean }>();
    const add = (n: string, pos: number, blockScoped: boolean) => names.set(n, { pos, blockScoped });
    if (ts.isFunctionLike(node)) for (const p of node.parameters) for (const n of bindingNames(p.name)) add(n, -1, false);
    if (ts.isCatchClause(node) && node.variableDeclaration) for (const n of bindingNames(node.variableDeclaration.name)) add(n, -1, false);
    const stmts = ts.isBlock(node) || ts.isSourceFile(node) ? node.statements : [];
    for (const st of stmts)
      if (ts.isVariableStatement(st)) {
        const blockScoped = (st.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
        for (const d of st.declarationList.declarations) for (const n of bindingNames(d.name)) add(n, d.getStart(sf), blockScoped);
      }
    return names;
  };
  const isRead = (id: ts.Identifier) => {
    const p = id.parent;
    if ((ts.isPropertyAccessExpression(p) && p.name === id) || (ts.isPropertyAssignment(p) && p.name === id) || ts.isJsxAttribute(p) || (ts.isBindingElement(p) && p.propertyName === id)) return false;
    if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isImportSpecifier(p) || ts.isImportClause(p)) && (p as { name?: ts.Node }).name === id) return false;
    return !ts.isTypeReferenceNode(p) && !ts.isPropertySignature(p) && !ts.isTypeAliasDeclaration(p) && !ts.isInterfaceDeclaration(p) && !ts.isQualifiedName(p);
  };
  const visit = (node: ts.Node) => {
    const scoped = ts.isBlock(node) || ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isCatchClause(node);
    if (scoped) scopes.push({ node, names: own(node) });
    if (ts.isIdentifier(node) && isRead(node)) {
      const at = node.getStart(sf);
      for (let i = scopes.length - 1; i >= 0; i--) {
        const b = scopes[i].names.get(node.text);
        if (!b) continue;
        if (b.blockScoped && b.pos > at) {
          // only when the read is inside a callback that runs right away, between the scope and the read
          let p: ts.Node = node.parent;
          let fn: ts.Node | null = null;
          while (p !== scopes[i].node) {
            if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) fn = p;
            p = p.parent;
          }
          if (fn && (ts.isCallExpression(fn.parent) || ts.isJsxExpression(fn.parent))) found.push(`${node.text} at line ${sf.getLineAndCharacterOfPosition(at).line + 1}`);
        }
        break;
      }
    }
    ts.forEachChild(node, visit);
    if (scoped) scopes.pop();
  };
  visit(sf);
  return found;
}

const GROUP = "g-1";
const COACH = "coach-1";
const DATE = "2027-03-10"; // a Wednesday, far enough ahead that no minimum notice hides its times
function seed({ athlete, coachRole, program }: { athlete: string; coachRole: "athlete" | "coach"; program: "undated" | "dated" | "none" }) {
  state.tables = {
    groups: [{ id: GROUP, group_kind: "one_on_one", organization_id: null }],
    group_memberships: [
      { group_id: GROUP, profile_id: COACH, role: "coach" },
      ...(athlete === COACH ? [] : [{ group_id: GROUP, profile_id: athlete, role: coachRole }]),
    ],
    profiles: [{ id: COACH, timezone: "America/Chicago", full_name: "Coach Ron" }],
    coach_availability_windows: [{ coach_id: COACH, weekday: 3, start_time: "09:00", end_time: "11:00", slot_duration_minutes: 60 }],
    coach_booking_policies: [{ coach_id: COACH, booking_mode: "request", buffer_minutes: 0, minimum_notice_hours: 0, credit_expiry_days: 0 }],
    session_credits: [{ athlete_id: athlete, group_id: GROUP, balance: 3 }],
    programs:
      program === "none"
        ? []
        : [
            {
              id: "p-1",
              group_id: GROUP,
              athlete_id: athlete,
              name: "Christmas abs",
              is_active: true,
              org_program: false,
              start_date: program === "dated" ? DATE : "2026-08-17",
              training_days: program === "dated" ? [3] : null,
            },
          ],
    workouts: program === "none" ? [] : [{ id: "w-1", program_id: "p-1", title: "Abs day", week_number: 1, day_index: 1, scheduled_date: program === "dated" ? DATE : null }],
  };
}
const open = () => CalendarDayPage({ params: Promise.resolve({ groupId: GROUP, date: DATE }), searchParams: Promise.resolve({}) } as never);

beforeEach(() => {
  state.user = { id: "client-1" };
  state.acting = { athleteId: "client-1", isActingAsOther: false };
});

// The href of the element whose own text is `label` (a Link: its props are read, the component is not called).
function hrefOf(node: unknown, label: string): string | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const h = hrefOf(n, label);
      if (h) return h;
    }
    return null;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return null;
  if (typeof props.href === "string" && texts(props.children).join("").includes(label)) return props.href;
  return hrefOf(props.children, label);
}

describe("Back to calendar from a coach's day page", () => {
  const coachOpen = async (date: string, search: Record<string, string> = {}) => {
    state.user = { id: COACH };
    state.acting = { athleteId: COACH, isActingAsOther: false };
    seed({ athlete: "client-1", coachRole: "athlete", program: "none" });
    return CalendarDayPage({ params: Promise.resolve({ groupId: GROUP, date }), searchParams: Promise.resolve(search) } as never);
  };
  it("on a phone goes straight to the phone's Calendar, on the month of the day (Oct 27: it went through the group's calendar and landed on Home)", async () => {
    state.phone = true;
    expect(hrefOf(await coachOpen("2026-10-28"), "Back to calendar")).toBe("/my-space/calendar?month=2026-10");
    // the month the link carried wins
    expect(hrefOf(await coachOpen("2026-10-28", { month: "2026-11" }), "Back to calendar")).toBe("/my-space/calendar?month=2026-11");
    state.phone = false;
  });
  it("on a computer is the group's calendar, as before", async () => {
    state.phone = false;
    expect(hrefOf(await coachOpen("2026-10-28"), "Back to calendar")).toBe(`/groups/${GROUP}/calendar`);
  });
});

describe("the client's day page draws the coach's open times", () => {
  for (const program of ["undated", "dated", "none"] as const) {
    it(`a client, ${program === "none" ? "no program" : `${program === "dated" ? "a dated" : "an undated"} program`}: the page draws, with the times in the coach's time zone`, async () => {
      seed({ athlete: "client-1", coachRole: "athlete", program });
      const all = texts(await open());
      expect(all).toContain("9:00 AM");
      expect(all).toContain("10:00 AM");
      if (program === "dated") expect(all).toContain("Abs day");
    });
  }
  it("the coach in their own space, as their own athlete (Ron's case: an undated program): the page draws", async () => {
    state.user = { id: COACH };
    state.acting = { athleteId: COACH, isActingAsOther: true };
    seed({ athlete: COACH, coachRole: "coach", program: "undated" });
    const all = texts(await open());
    expect(all).toContain("9:00 AM");
  });
});

describe("nothing in the page reads a variable before it is set", () => {
  it("no let/const is read inside a callback (a .map, JSX) above its own declaration in the same block", () => {
    const file = join(__dirname, "..", "app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(readsBeforeSet(readFileSync(file, "utf8"))).toEqual([]);
  });
  it("the check finds the Oct 27 crash in the page as it was", () => {
    const before = [
      "function Page() {",
      "  if (a) {",
      "    if (b) {",
      "      const timezone = 'x';",
      "    }",
      "    return <div>{slots.map((s) => fmt(s, timezone))}</div>;",
      "  }",
      "  const timezone = 'y';",
      "  return timezone;",
      "}",
    ].join("\n");
    expect(readsBeforeSet(before)).toEqual(["timezone at line 6"]);
    // a name bound by the callback itself, or one declared above, is fine
    expect(readsBeforeSet(["function P() {", "  const tz = 1;", "  return [1].map((timezone) => timezone + tz);", "  const timezone = 2;", "}"].join("\n"))).toEqual([]);
  });
});

describe("a month on the Calendar does not load every day page when it opens", () => {
  it("each day cell links with prefetch off (the phone's month, a client's month and week, and the schedule-for month)", () => {
    const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
    expect(read("components/coach/mobile/coach-phone-schedule.tsx")).toContain("href={`/groups/${anchorGroupId}/calendar/${dayKey(date)}`} prefetch={false}");
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("<Link key={i} href={dayHref(date)} prefetch={false} className={cellClass}>");
    expect(body).toContain("<Link key={i} href={dayHref(date)} prefetch={false} className={rowClass}>");
    expect(body).toContain("href={`/groups/${params.groupId}/calendar/${dateKey(date)}?client=${selected.id}`}\n                    prefetch={false}");
    // no other link to a day page in these two files prefetches
    for (const src of [read("components/coach/mobile/coach-phone-schedule.tsx"), body]) {
      const links = src.match(/<Link[^>]*\/calendar\/\$\{[^>]*>|<Link[^>]*dayHref\([^>]*>/g) ?? [];
      for (const l of links) expect(l, l).toContain("prefetch={false}");
    }
  });
});
