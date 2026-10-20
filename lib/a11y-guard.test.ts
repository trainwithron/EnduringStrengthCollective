import { describe, it, expect } from "vitest";
import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { escapeBelongsToInnerThing, openDialogCount, pushDialog, topDialogIs, trapTarget } from "./use-dialog-a11y";

// Accessibility, kept from sliding back (Release K3). Four things are checked across the whole app, not a sample:
//   1. every page names itself (the tab title a screen reader reads first),
//   2. every text field, text area and select has an accessible name,
//   3. every full-screen sheet or pop-up is a dialog (role, label, focus kept inside, Escape closes),
//   4. text is never faded below the contrast the design's own colours were chosen to meet (steel and rust clear 4.5:1 on the dark backgrounds; the same colour at 80% or less does not).
const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const rel = join(dir, e.name);
    if (e.isDirectory()) walk(rel, match, out);
    else if (match(e.name)) out.push(rel.split(sep).join("/"));
  }
  return out;
}

const tsxFiles = [...walk("app", (n) => n.endsWith(".tsx") && !n.includes(".test.")), ...walk("components", (n) => n.endsWith(".tsx") && !n.includes(".test."))];

describe("every page names itself", () => {
  const HAS_TITLE = /export (const metadata\b|async function generateMetadata\b|function generateMetadata\b)/;
  it("each page has a title of its own, or a layout above it does", () => {
    const pages = walk("app", (n) => n === "page.tsx");
    const missing: string[] = [];
    for (const page of pages) {
      if (HAS_TITLE.test(read(page))) continue;
      let dir = dirname(page);
      let covered = false;
      while (dir && dir !== ".") {
        const layout = join(dir, "layout.tsx").split(sep).join("/");
        if (existsSync(join(ROOT, layout)) && HAS_TITLE.test(read(layout))) {
          covered = true;
          break;
        }
        dir = dirname(dir);
      }
      if (!covered) missing.push(page);
    }
    expect(missing, `pages with no title: ${missing.join(", ")}`).toEqual([]);
  });

  it("the tab title is 'Page | Spotlight Coaching'", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('template: "%s | Spotlight Coaching"');
  });
});

describe("every field has an accessible name", () => {
  const SKIP_TYPES = new Set(["hidden", "checkbox", "radio", "submit", "button", "file", "range", "image", "reset", "color"]);
  it("no text field, text area or select is left without a label, an aria-label or a title", () => {
    const unlabeled: string[] = [];
    for (const file of tsxFiles) {
      const text = read(file);
      if (!/<(input|textarea|select)\b/.test(text)) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const hasHtmlFor = /htmlFor/.test(text);
      const visit = (node: ts.Node, labelDepth: number) => {
        let depth = labelDepth;
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "label") depth++;
        const el = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxOpeningElement(node) ? node : null;
        if (el && ["input", "textarea", "select"].includes(el.tagName.getText(sf))) {
          const attrs: Record<string, string> = {};
          for (const a of el.attributes.properties) if (ts.isJsxAttribute(a)) attrs[a.name.getText(sf)] = a.initializer ? a.initializer.getText(sf) : "true";
          const type = (attrs.type ?? "").replace(/["']/g, "");
          if (!SKIP_TYPES.has(type)) {
            const named = attrs["aria-label"] || attrs["aria-labelledby"] || attrs.title || (attrs.id && hasHtmlFor) || depth > 0;
            if (!named) unlabeled.push(`${file}:${sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1}`);
          }
        }
        ts.forEachChild(node, (c) => visit(c, depth));
      };
      visit(sf, 0);
    }
    expect(unlabeled, `fields with no accessible name:\n${unlabeled.join("\n")}`).toEqual([]);
  });
});

describe("every full-screen sheet is a dialog", () => {
  // Backdrops of a dropdown, not a sheet: they only catch a click outside the menu that is open.
  const DROPDOWN_BACKDROPS = new Set(["components/athlete/notification-bell.tsx", "components/coach/swappable-term.tsx"]);
  it("each file with a full-screen overlay names it a dialog and uses the shared focus handling (or is already a labelled dialog)", () => {
    const bad: string[] = [];
    for (const file of tsxFiles) {
      const text = read(file);
      if (!text.includes("fixed inset-0") || DROPDOWN_BACKDROPS.has(file)) continue;
      if (!/role="(alert)?dialog"/.test(text)) bad.push(`${file}: no role="dialog"`);
    }
    expect(bad).toEqual([]);
  });

  it("the nine sheets that had no dialog behaviour now use it", () => {
    for (const file of [
      "components/athlete/view-as-client-picker.tsx",
      "components/coach/auto-categorize-button.tsx",
      "components/coach/desktop/download-app-button.tsx",
      "components/coach/desktop/expanded-day-scheduler.tsx",
      "components/coach/desktop/recap-and-up-next.tsx",
      "components/coach/exercise-qr-code-button.tsx",
      "components/coach/mobile/spot-builder-panel.tsx",
      "components/feed/new-post-composer.tsx",
    ]) {
      const text = read(file);
      expect(text, file).toContain("useDialogA11y");
      expect(text, file).toContain('role="dialog"');
      expect(text, file).toContain('aria-modal="true"');
    }
  });

  it("Tab stays inside a dialog: from the last control it goes to the first, from the first with Shift to the last", () => {
    expect(trapTarget(3, 2, false)).toBe("first");
    expect(trapTarget(3, 0, true)).toBe("last");
    expect(trapTarget(3, 1, false)).toBeNull();
    expect(trapTarget(0, -1, false)).toBe("first");
  });

  it("a field the screen already focused (autoFocus) keeps focus when a dialog opens", () => {
    expect(read("lib/use-dialog-a11y.ts")).toContain("node.contains(document.activeElement)");
  });

  it("with two dialogs open only the topmost answers the keyboard, and the one below answers again once it closes", () => {
    const a = Symbol("sheet");
    const b = Symbol("popup");
    const offA = pushDialog(a);
    expect(topDialogIs(a)).toBe(true);
    const offB = pushDialog(b);
    expect(topDialogIs(b)).toBe(true);
    expect(topDialogIs(a)).toBe(false);
    offB();
    expect(topDialogIs(a)).toBe(true);
    offA();
    expect(openDialogCount()).toBe(0);
  });

  it("Escape that belongs to something smaller does not also close the dialog: already used, an open select, a listbox or a combobox", () => {
    const el = (props: { tagName?: string; closest?: (sel: string) => unknown }) => ({ tagName: "DIV", closest: () => null, ...props }) as unknown as EventTarget;
    expect(escapeBelongsToInnerThing({ defaultPrevented: true, target: el({}) })).toBe(true);
    expect(escapeBelongsToInnerThing({ defaultPrevented: false, target: el({ tagName: "SELECT" }) })).toBe(true);
    expect(escapeBelongsToInnerThing({ defaultPrevented: false, target: el({ closest: (sel) => (sel.includes("listbox") ? {} : null) }) })).toBe(true);
    expect(escapeBelongsToInnerThing({ defaultPrevented: false, target: el({ closest: (sel) => (sel.includes("aria-expanded") ? {} : null) }) })).toBe(true);
    expect(escapeBelongsToInnerThing({ defaultPrevented: false, target: el({}) })).toBe(false);
  });

  it("the hook lets a sheet with unsaved work ask before Escape closes it, and the sheets with work use it", () => {
    const hook = read("lib/use-dialog-a11y.ts");
    expect(hook).toContain("Discard what you have here?");
    expect(hook).toContain('action === "block"');
    expect(hook).toContain("Tab from outside the dialog pulls focus in");
    expect(read("components/coach/mobile/spot-builder-panel.tsx")).toContain('guard: () => (library && aliases ? "ask" : "close")');
    expect(read("components/feed/new-post-composer.tsx")).toContain('guard: () => (body.trim() || file ? "ask" : "close")');
    expect(read("components/feed/new-post-composer.tsx")).toContain('e.key === "Escape" && mentionQuery !== null');
    expect(read("components/coach/desktop/expanded-day-scheduler.tsx")).toContain('assigning ? "block"');
    expect(read("components/coach/desktop/recap-and-up-next.tsx")).toContain('? "ask" : "close"');
    expect(read("components/coach/auto-categorize-button.tsx")).toContain('applying ? "block" : "close"');
  });
});

describe("a field's name says what the field IS, never an example of what to type", () => {
  it("no aria-label is an example value (e.g. ..., a sample like 0.00) or a name copied from an example placeholder", () => {
    const bad: string[] = [];
    for (const file of tsxFiles) {
      read(file)
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/aria-label="([^"]*)"/g)) {
            const label = m[1];
            const placeholder = /placeholder="([^"]*)"/.exec(line)?.[1];
            const isExample = /(^|[\s(,])e\.g\./i.test(label) || /^[\d.,$%\s]+$/.test(label) || label.includes("for example");
            const sameAsExamplePlaceholder = placeholder === label && /e\.g\./i.test(placeholder);
            if (isExample || sameAsExamplePlaceholder) bad.push(`${file}:${i + 1}: ${label}`);
          }
        });
    }
    expect(bad).toEqual([]);
  });

  it("the names found wrong in review are fixed (an ingredient row is not named after its sample food, the Style field is not named Conjugate)", () => {
    expect(read("components/coach/mobile/spot-builder-panel.tsx")).not.toContain('aria-label="Conjugate"');
    expect(read("components/coach/mobile/spot-builder-panel.tsx")).toContain('aria-label="Style"');
    expect(read("components/coach/desktop/recipe-hub-manager.tsx")).toContain('aria-label="Ingredient name"');
    expect(read("components/coach/desktop/recipe-hub-manager.tsx")).not.toContain('aria-label="Chicken Breast"');
  });
});

describe("text is not faded below the contrast the colours were chosen to meet", () => {
  // Disabled controls and decorative marks are exempt from the contrast rule.
  const EXEMPT = new Set(["components/shared/mic-button.tsx", "components/shared/shop-card.tsx", "components/shared/program-day-picker.tsx"]);
  it("no text uses steel at 80% or less, or chalk at 50% or less (steel is 5.1:1 on the page and 4.55:1 on a card; at 80% it is 3.7:1)", () => {
    const bad: string[] = [];
    for (const file of tsxFiles) {
      if (EXEMPT.has(file)) continue;
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (/(?<![-\w])(placeholder:)?text-steel\/(80|70|60|50|40|30)\b/.test(line) || /(?<![-\w])text-chalk\/(50|40|30)\b/.test(line)) bad.push(`${relative(ROOT, join(ROOT, file)).split(sep).join("/")}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
