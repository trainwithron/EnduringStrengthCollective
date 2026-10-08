import { describe, it, expect } from "vitest";
import { assignedClients } from "./program-assigned-clients";

describe("clients assigned to a program", () => {
  it("lists copy holders (opening their copy) and group members without a copy (opening their profile), once each, A to Z", () => {
    const list = assignedClients({
      groupId: "g1",
      copies: [
        { programId: "p-robin", groupId: "g2", athleteId: "robin", name: "Robin Lee" },
        { programId: "p-ann", groupId: "g1", athleteId: "ann", name: "Ann Cole" },
      ],
      members: [
        { id: "ann", name: "Ann Cole" },
        { id: "bo", name: "Bo Diaz" },
      ],
    });
    expect(list).toEqual([
      { id: "ann", name: "Ann Cole", href: "/groups/g1/programs/p-ann" },
      { id: "bo", name: "Bo Diaz", href: "/groups/g1/athletes/bo" },
      { id: "robin", name: "Robin Lee", href: "/groups/g2/programs/p-robin" },
    ]);
  });
  it("nobody assigned is an empty list, and a missing name reads 'Client'", () => {
    expect(assignedClients({ groupId: "g1", copies: [], members: [] })).toEqual([]);
    expect(assignedClients({ groupId: "g1", copies: [], members: [{ id: "x", name: null }] })[0].name).toBe("Client");
  });
});
