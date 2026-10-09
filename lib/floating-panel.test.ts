import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterThreadOpened, badgeText, panelHeader, shownUnread } from "./floating-panel";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the floating panel header follows the tab", () => {
  it("Spot keeps Ask Spot and its line; Messages says Messages", () => {
    expect(panelHeader("spot")).toMatchObject({ title: "Ask Spot", subtitle: "Find a page, learn how to do something, or ask about a client." });
    expect(panelHeader("messages")).toMatchObject({ title: "Messages", subtitle: "Pick a client to read and reply.", collapseLabel: "Collapse Messages" });
  });
});

describe("the badge drops as threads are read in the panel", () => {
  it("each thread takes its own unread count off once, never below zero", () => {
    let state = { counted: new Set<string>(), readSince: 0 };
    state = afterThreadOpened(state.counted, state.readSince, "ann", 2);
    expect(shownUnread(5, state.readSince)).toBe(3);
    state = afterThreadOpened(state.counted, state.readSince, "ann", 2);
    expect(shownUnread(5, state.readSince)).toBe(3);
    state = afterThreadOpened(state.counted, state.readSince, "bo", 3);
    expect(shownUnread(5, state.readSince)).toBe(0);
    state = afterThreadOpened(state.counted, state.readSince, "cy", 4);
    expect(shownUnread(5, state.readSince)).toBe(0);
  });
  it("a thread with nothing unread changes nothing, and big numbers read 9+", () => {
    const s = afterThreadOpened(new Set(), 0, "ann", 0);
    expect(s.readSince).toBe(0);
    expect(s.counted.size).toBe(0);
    expect(badgeText(3)).toBe("3");
    expect(badgeText(10)).toBe("9+");
  });
});

describe("wiring", () => {
  const chat = read("components/coach/desktop/collective-intelligence-chat.tsx");
  it("the collapsed edge tab shows the unread count", () => {
    const collapsed = chat.slice(chat.indexOf("if (!open) {"), chat.indexOf("  return (\n    <div\n      style={edgeStyle}"));
    expect(collapsed).toContain("unreadNow > 0");
    expect(collapsed).toContain("badgeText(unreadNow)");
  });
  it("the header comes from the active tab, and the Messages tab is told when a thread is read", () => {
    expect(chat).toContain("{header.title}");
    expect(chat).toContain("onOpened={(otherId, threadUnread) => {");
    expect(read("components/coach/desktop/floating-messages.tsx")).toContain("onOpened?.(id, data.conversations.find((c) => c.otherId === id)?.unreadCount ?? 0)");
  });
  it("the sidebar badge is untouched", () => {
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).toContain("badge: messagesUnread");
    expect(shell).toContain("<CollectiveIntelligenceChat groupId={groupId} unread={messagesUnread} />");
  });
});
