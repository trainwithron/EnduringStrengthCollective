import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createConfirmStore, describeConfirm } from "./confirm-store";

describe("the words and look of a confirmation come from the message", () => {
  it("a delete, remove, revoke or clear names its own button and is red", () => {
    expect(describeConfirm('Delete "Bench press"? This can\'t be undone.')).toMatchObject({ confirmLabel: "Delete", cancelLabel: "Cancel", destructive: true });
    expect(describeConfirm("Remove Sam from the group?")).toMatchObject({ confirmLabel: "Remove", destructive: true });
    expect(describeConfirm("Revoke this parent link? The page will stop working immediately.")).toMatchObject({ confirmLabel: "Revoke", destructive: true });
    expect(describeConfirm("Clear the saved macro target for 2026-10-10? This can't be undone.")).toMatchObject({ confirmLabel: "Clear", destructive: true });
  });
  it("a cancel gets Yes, cancel / Keep it so the two buttons are never both Cancel", () => {
    expect(describeConfirm("Cancel this session? Anything already taken for it goes back to their sessions.")).toEqual({
      message: "Cancel this session? Anything already taken for it goes back to their sessions.",
      confirmLabel: "Yes, cancel",
      cancelLabel: "Keep it",
      destructive: true,
    });
  });
  it("closing a pane with unsaved typing discards", () => {
    expect(describeConfirm("Close and discard what you typed? It has not been saved or sent.")).toMatchObject({ confirmLabel: "Discard", destructive: true });
  });
  it("an ordinary question is a plain Confirm, not red", () => {
    expect(describeConfirm("Move your session to Mon, Oct 12, 5:00 PM?")).toMatchObject({ confirmLabel: "Confirm", destructive: false });
    expect(describeConfirm("Set Sam's balance from 4 to 6? This is recorded in their session ledger.")).toMatchObject({ confirmLabel: "Confirm", destructive: false });
  });
  it("what the call says wins over what the message suggests", () => {
    expect(describeConfirm({ message: "Delete it?", destructive: false, confirmLabel: "Go" })).toMatchObject({ confirmLabel: "Go", destructive: false });
  });
});

describe("the confirmation store", () => {
  it("answers the asker with true or false, and shows nothing when idle", async () => {
    const store = createConfirmStore();
    expect(store.getSnapshot()).toBeNull();
    const yes = store.ask("Delete this?");
    expect(store.getSnapshot()?.message).toBe("Delete this?");
    store.answer(true);
    await expect(yes).resolves.toBe(true);
    expect(store.getSnapshot()).toBeNull();
    const no = store.ask("Remove it?");
    store.answer(false);
    await expect(no).resolves.toBe(false);
  });
  it("a second ask waits its turn instead of replacing the one on screen", async () => {
    const store = createConfirmStore();
    const first = store.ask("First?");
    const second = store.ask("Second?");
    expect(store.getSnapshot()?.message).toBe("First?");
    store.answer(false);
    await expect(first).resolves.toBe(false);
    expect(store.getSnapshot()?.message).toBe("Second?");
    store.answer(true);
    await expect(second).resolves.toBe(true);
    expect(store.getSnapshot()).toBeNull();
  });
  it("tells listeners when it changes, and an answer with nothing open does nothing", () => {
    const store = createConfirmStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.answer(true);
    expect(calls).toBe(0);
    void store.ask("Hello?");
    expect(calls).toBe(1);
    store.answer(false);
    expect(calls).toBe(2);
    off();
    void store.ask("Again?");
    expect(calls).toBe(2);
  });
});

describe("nothing in the app uses the browser's own popups any more", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(full);
    }
  };
  for (const d of ["app", "components", "lib"]) walk(join(root, d));
  it("no window.confirm, window.alert or window.prompt in app, components or lib", () => {
    const bad = files.filter((f) => /\bwindow\.(confirm|alert|prompt)\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
  it("the dialog is mounted once, in the root layout", () => {
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
    expect(layout).toContain("<ConfirmDialogHost />");
    const host = readFileSync(join(root, "components/shared/confirm-dialog.tsx"), "utf8");
    expect(host).toContain('role="alertdialog"');
    expect(host).toContain("min-h-[44px]");
    expect(host).toContain('e.key === "Escape"');
  });
});
