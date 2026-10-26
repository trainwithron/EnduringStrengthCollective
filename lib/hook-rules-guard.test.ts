import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { themeRefreshNeeded } from "./org-theme-refresh";

// Oct 26: /programs threw "Application error" once (React #310: a component rendered a different number of hooks than the time before) right after choosing an organization. This guard reads every
// component and hook in the app and fails if any hook is called (1) after an early return, (2) inside a condition, loop, ternary, && / || / ?? (other than as its left side), or a callback, or (3) from
// a function that is neither a component nor a hook. Any of those can change the number of hooks between renders. At the time of writing nothing in the app does; the crash came from the router itself.
const root = join(__dirname, "..");
const isHookName = (n: string) => /^use[A-Z0-9]/.test(n);
const isComponentOrHook = (n: string) => /^[A-Z]/.test(n) || isHookName(n);
const calleeName = (e: ts.Expression): string | null => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) ? e.name.text : null);

function files(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) && !n.endsWith(".d.ts")) out.push(f);
    }
  };
  for (const top of ["app", "components", "lib"]) walk(join(root, top));
  return out;
}

function problemsIn(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const where = (n: ts.Node) => `${relative(root, file).split("\\").join("/")}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const out: string[] = [];
  const nameOf = (fn: ts.Node): string | null => {
    if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
    return null;
  };
  // Every hook call: is the function it is in a component or a hook, and is it reached on every render?
  const visit = (n: ts.Node, owner: string | null, conditional: boolean) => {
    if (ts.isFunctionLike(n)) {
      const name = nameOf(n);
      // A callback inside a component (useMemo(() => ...), items.map(...)) is not where hooks may be called; a named component or hook starts fresh.
      const body = (n as ts.FunctionLikeDeclarationBase).body;
      if (!body) return;
      if (name && isComponentOrHook(name)) {
        checkBody(name, body);
        visit(body, name, false);
      } else visit(body, name ?? "a callback", false);
      return;
    }
    if (ts.isCallExpression(n)) {
      const c = calleeName(n.expression);
      if (c && isHookName(c)) {
        if (owner === null || !isComponentOrHook(owner)) out.push(`${where(n)} ${c} called in ${owner ?? "module scope"} (not a component or hook)`);
        else if (conditional) out.push(`${where(n)} ${c} called conditionally in ${owner}`);
      }
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) {
      visit(n.left, owner, conditional);
      visit(n.right, owner, true);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.condition, owner, conditional);
      visit(n.whenTrue, owner, true);
      visit(n.whenFalse, owner, true);
      return;
    }
    if (ts.isIfStatement(n)) {
      visit(n.expression, owner, conditional);
      visit(n.thenStatement, owner, true);
      if (n.elseStatement) visit(n.elseStatement, owner, true);
      return;
    }
    const loopOrBranch = ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isSwitchStatement(n) || ts.isTryStatement(n);
    ts.forEachChild(n, (c) => visit(c, owner, conditional || loopOrBranch));
  };
  // A hook after a statement that can return early.
  const checkBody = (name: string, body: ts.Node) => {
    if (!ts.isBlock(body)) return;
    let returnedAt: ts.Node | null = null;
    const containsReturn = (n: ts.Node): boolean => {
      if (ts.isFunctionLike(n)) return false;
      if (ts.isReturnStatement(n)) return true;
      return ts.forEachChild(n, (c) => (containsReturn(c) ? true : undefined)) === true;
    };
    const hasHook = (n: ts.Node): boolean => {
      if (ts.isFunctionLike(n)) return false;
      if (ts.isCallExpression(n)) {
        const c = calleeName(n.expression);
        if (c && isHookName(c)) return true;
      }
      return ts.forEachChild(n, (c) => (hasHook(c) ? true : undefined)) === true;
    };
    for (const st of body.statements) {
      if (returnedAt && hasHook(st)) {
        out.push(`${where(st)} a hook in ${name} after an early return at ${where(returnedAt)}`);
        return;
      }
      if (!returnedAt && !ts.isReturnStatement(st) && containsReturn(st)) returnedAt = st;
    }
  };
  ts.forEachChild(sf, (c) => visit(c, null, false));
  return out;
}

describe("hooks are called the same way on every render, everywhere in the app", () => {
  it("no hook after an early return, inside a condition or loop, or outside a component or hook", () => {
    const problems = files().flatMap(problemsIn);
    expect(problems).toEqual([]);
  }, 60_000);
  it("the guard itself catches each kind", () => {
    const tmp = join(root, "lib", "__hook_guard_sample__.tsx");
    writeFileSync(
      tmp,
      [
        "export function A({ x }: { x: boolean }) { if (x) return null; const v = useMemo(() => 1, []); return v; }",
        "export function B({ x }: { x: boolean }) { const v = x ? useMemo(() => 1, []) : 0; return v; }",
        "export function C() { const ok = useContext(Ctx) ?? 1; return ok; }",
        "function helper() { return useState(0); }",
        "export function D({ items }: { items: number[] }) { return items.map(() => useState(0)); }",
      ].join("\n")
    );
    try {
      const found = problemsIn(tmp).map((p) => p.replace(/^.*?:(\d+) /, "$1 "));
      expect(found).toEqual([
        "1 a hook in A after an early return at lib/__hook_guard_sample__.tsx:1",
        "2 useMemo called conditionally in B",
        "4 useState called in helper (not a component or hook)",
        "5 useState called in a callback (not a component or hook)",
      ]);
    } finally {
      unlinkSync(tmp);
    }
  });
});

describe("the organization's look is refreshed once, after the page has started", () => {
  it("only when the cookies differ from what the page was drawn with, and never twice for the same pair", () => {
    const base = { remembered: "g1", chosen: "o1", usedGroup: "g1", usedOrg: "o1", alreadyAsked: null };
    expect(themeRefreshNeeded(base)).toBeNull();
    expect(themeRefreshNeeded({ ...base, chosen: "o2" })).toBe("g1|o2");
    expect(themeRefreshNeeded({ ...base, chosen: "o2", alreadyAsked: "g1|o2" })).toBeNull();
    expect(themeRefreshNeeded({ ...base, remembered: null, chosen: null })).toBeNull();
  });
  it("the refresh is deferred past start-up and made as a transition", () => {
    const src = readFileSync(join(root, "components/shared/org-theme-sync.tsx"), "utf8");
    expect(src).toContain("window.setTimeout(() => startTransition(() => router.refresh()), 0);");
    expect(src).toContain("return () => window.clearTimeout(timer);");
    expect(src).not.toMatch(/\)\) router\.refresh\(\);/);
  });
});
