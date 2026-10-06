import { describe, expect, it } from "vitest";
import { clientNameInProgramName } from "@/lib/program-client-name";

const clients = [
  { fullName: "Jeff Z", groupId: "g1" },
  { fullName: "Karina Ramirez", groupId: "g2" },
];

describe("clientNameInProgramName", () => {
  it("finds a client's name used as the program name, in any capitalization", () => {
    expect(clientNameInProgramName("jeff z", clients)?.groupId).toBe("g1");
    expect(clientNameInProgramName("Karina Ramirez - Block 1", clients)?.groupId).toBe("g2");
  });
  it("ignores ordinary program names and very short input", () => {
    expect(clientNameInProgramName("Strength Block 1", clients)).toBeNull();
    expect(clientNameInProgramName("Je", clients)).toBeNull();
    expect(clientNameInProgramName("", clients)).toBeNull();
  });
});
