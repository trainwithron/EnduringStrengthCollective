import { describe, it, expect } from "vitest";
import { pageDestinations, clientDestinations, searchDestinations, isAllowedWorkspacePath, pushRecent } from "./workspace-destinations";

const G = "0b1f4c2e-aaaa-4bbb-8ccc-123456789abc";

describe("workspace destinations", () => {
  it("every page path is allowed and belongs to the group or is a coach-wide page", () => {
    for (const shared of [true, false]) {
      for (const d of pageDestinations(G, shared)) {
        expect(isAllowedWorkspacePath(d.path), d.path).toBe(true);
      }
    }
  });
  it("offers the group-only pages only inside a team or social group", () => {
    const solo = pageDestinations(G, false).map((d) => d.id);
    const shared = pageDestinations(G, true).map((d) => d.id);
    expect(solo).not.toContain(`page:team-performance:${G}`);
    expect(shared).toContain(`page:team-performance:${G}`);
    expect(solo).toContain(`page:calendar:${G}`);
  });
  it("a group's page has an id tied to that group, so two groups' Programs never count as one view", () => {
    const a = pageDestinations(G, true, "Home Team").find((d) => d.label === "Programs")!;
    const b = pageDestinations("1c2d3e4f-aaaa-4bbb-8ccc-123456789abc", true, "Alumni").find((d) => d.label === "Programs")!;
    expect(a.id).not.toBe(b.id);
    expect(a.section).toContain("Home Team");
    // coach-wide pages stay one view whichever group you stand in
    expect(pageDestinations(G, true).find((d) => d.label === "Clients")!.id).toBe(pageDestinations("1c2d3e4f-aaaa-4bbb-8ccc-123456789abc", true).find((d) => d.label === "Clients")!.id);
  });
  it("ids are unique", () => {
    const ids = pageDestinations(G, true).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("a client has their own pages, with ids tied to the client", () => {
    const d = clientDestinations({ athleteId: "11111111-2222-4333-8444-555555555555", name: "Maria Lopez", groupId: G });
    expect(d.map((x) => x.id)).toContain("client:11111111-2222-4333-8444-555555555555:messages");
    expect(d.every((x) => isAllowedWorkspacePath(x.path))).toBe(true);
    expect(d.find((x) => x.id.endsWith(":programs"))!.path).toContain("?tab=program");
  });
});

describe("search", () => {
  const all = [...pageDestinations(G, true), ...clientDestinations({ athleteId: "11111111-2222-4333-8444-555555555555", name: "Maria Lopez", groupId: G })];
  it("finds a page by its name, by a prefix and by a related word", () => {
    expect(searchDestinations(all, "calendar")[0].id).toBe(`page:calendar:${G}`);
    expect(searchDestinations(all, "cal")[0].label.toLowerCase()).toContain("cal");
    expect(searchDestinations(all, "money")[0].id).toBe(`page:business:${G}`);
  });
  it("finds a client's pages by their name", () => {
    const r = searchDestinations(all, "maria");
    expect(r.length).toBe(6);
    expect(r.every((x) => x.id.startsWith("client:"))).toBe(true);
    const msgs = searchDestinations(all, "maria messages");
    expect(msgs[0].id).toBe("client:11111111-2222-4333-8444-555555555555:messages");
  });
  it("every word typed must match", () => {
    expect(searchDestinations(all, "calendar zzzz")).toEqual([]);
  });
  it("shows the start of the list when nothing is typed, and respects the limit", () => {
    expect(searchDestinations(all, "", 5)).toHaveLength(5);
    expect(searchDestinations(all, "  ", 3)).toHaveLength(3);
  });
});

describe("what a pane may load", () => {
  it("allows the app's own pages", () => {
    expect(isAllowedWorkspacePath("/dashboard")).toBe(true);
    expect(isAllowedWorkspacePath("/clients")).toBe(true);
    expect(isAllowedWorkspacePath(`/groups/${G}/calendar?x=1#top`)).toBe(true);
    expect(isAllowedWorkspacePath(`/groups/${G}`)).toBe(true);
  });
  it("refuses outside addresses and tricks", () => {
    for (const bad of ["/groups/aaaaaaaa/.%2e/x", "/groups/aaaaaaaa/%2e./x", "/groups/aaaaaaaa/%2e%2e/%2e%2e/api/x", "/groups/aaaaaaaa/x;y", "https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/admin/organizations", `/groups/${G}/../../admin`, "/groups/x/calendar", "", "groups/abc", "/api/clients/delete", `/groups/${G}/%2e%2e/admin`, `/groups/${G}/%2E%2E/%2e%2e/admin`, `/groups/${G}/a%2fb`, `/groups/${G}/a%5cb`]) {
      expect(isAllowedWorkspacePath(bad), bad).toBe(false);
    }
    expect(isAllowedWorkspacePath("/groups/" + G + "/x\u0000y")).toBe(false);
    expect(isAllowedWorkspacePath("/" + "a".repeat(600))).toBe(false);
  });
});

describe("recent", () => {
  const d = (id: string) => ({ id, label: id, path: `/groups/${G}/${id}`, section: "s" });
  it("puts the newest first without repeats and keeps at most the limit", () => {
    let r = pushRecent([], d("a"));
    r = pushRecent(r, d("b"));
    r = pushRecent(r, d("a"));
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    let many: ReturnType<typeof pushRecent> = [];
    for (let i = 0; i < 12; i++) many = pushRecent(many, d(`p${i}`), 8);
    expect(many).toHaveLength(8);
    expect(many[0].id).toBe("p11");
  });
});
