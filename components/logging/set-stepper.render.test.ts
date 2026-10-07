import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetStepper } from "./set-stepper";

const base = {
  count: 4,
  canRemove: true,
  addBusy: false,
  onAdd: () => {},
  onRemove: () => {},
  prescribedNote: null,
  confirmText: null,
  onConfirmRemove: () => {},
  onKeep: () => {},
  undo: null,
};
const html = (over: Partial<Parameters<typeof SetStepper>[0]> = {}) => renderToStaticMarkup(createElement(SetStepper, { ...base, ...over }));

describe("the Sets stepper", () => {
  it("is one row: Sets, a minus, the count, a plus", () => {
    const out = html();
    expect(out).toContain("Sets");
    expect(out.indexOf('aria-label="Remove the last set"')).toBeLessThan(out.indexOf(">4<"));
    expect(out.indexOf(">4<")).toBeLessThan(out.indexOf('aria-label="Add a set"'));
  });
  it("disables the minus at one set, and only then", () => {
    const one = html({ count: 1, canRemove: false });
    const minus = (s: string) => s.slice(s.indexOf("<button"), s.indexOf("</button>"));
    expect(minus(one)).toContain('disabled=""');
    expect(minus(html())).not.toContain('disabled=""');
  });
  it("shows the prescribed count quietly, and the one-line confirm for a logged set", () => {
    expect(html({ count: 3, prescribedNote: "Prescribed 4" })).toContain("Prescribed 4");
    const out = html({ confirmText: "Remove set 2? It's already logged." });
    expect(out).toContain("already logged.");
    expect(out).toContain("Keep");
  });
  it("offers Undo after a logged set was removed, and holds it back while the removal is still saving", () => {
    expect(html({ undo: { text: "Set 3 removed.", pending: false, onUndo: () => {} } })).toContain(">Undo<");
    const pending = html({ undo: { text: "Set 3 removed.", pending: true, onUndo: () => {} } });
    expect(pending).toContain("Removing…");
    expect(pending).not.toContain(">Undo<");
  });
});
