import { describe, it, expect } from "vitest";
import { candidateNameTokens, editDistance, foldName, rankClientsByName, resolveClient } from "./client-name-match";

const roster = [
  { id: "1", fullName: "Johann Gorsik" },
  { id: "2", fullName: "Alice Athlete" },
  { id: "3", fullName: "Karina Ramirez" },
  { id: "4", fullName: "Robyn Lee" },
  { id: "5", fullName: "Michael Brandt" },
  { id: "6", fullName: "Zoë Müller" },
];
const names = (r: { client: { fullName: string } }[]) => r.map((x) => x.client.fullName);

describe("finding a client from how a coach says the name", () => {
  it("folds accents, possessives and punctuation", () => {
    expect(foldName("Johann's")).toBe("johann");
    expect(foldName("ZOË  Müller!")).toBe("zoe muller");
    expect(foldName("Mary-Anne")).toBe("mary anne");
  });
  it("counts a swap of two neighbouring letters as one slip", () => {
    expect(editDistance("john", "jhon")).toBe(1);
    expect(editDistance("johann", "johan")).toBe(1);
    expect(editDistance("karina", "karrina")).toBe(1);
  });
  it("does not treat place or action words as names", () => {
    expect(candidateNameTokens("pull up Johann's program")).toEqual(["johann"]);
    expect(candidateNameTokens("what did Alice say in that last chat")).toEqual(["alice"]);
  });

  it("finds a first name, a possessive and a full name", () => {
    expect(resolveClient("pull up Johann's program", roster).confident?.fullName).toBe("Johann Gorsik");
    expect(resolveClient("let me see Karina Ramirez calendar", roster).confident?.fullName).toBe("Karina Ramirez");
    expect(resolveClient("alice nutrition", roster).confident?.fullName).toBe("Alice Athlete");
  });
  it("tolerates typos and a missing letter", () => {
    expect(resolveClient("pull up Johan's program", roster).confident?.fullName).toBe("Johann Gorsik");
    expect(resolveClient("open Karrina", roster).confident?.fullName).toBe("Karina Ramirez");
    expect(resolveClient("show me Alcie", roster).confident?.fullName).toBe("Alice Athlete");
    expect(resolveClient("Robin's goals", roster).confident?.fullName).toBe("Robyn Lee");
  });
  it("finds a last name alone, and folds accents", () => {
    expect(resolveClient("what about Gorsik", roster).confident?.fullName).toBe("Johann Gorsik");
    expect(resolveClient("show Zoe", roster).confident?.fullName).toBe("Zoë Müller");
  });
  it("finds a nickname", () => {
    expect(resolveClient("pull up Mike", roster).confident?.fullName).toBe("Michael Brandt");
  });

  it("with two people who fit, never guesses: it lists them", () => {
    const two = [...roster, { id: "7", fullName: "Johann Weber" }];
    const r = resolveClient("pull up Johann's program", two);
    expect(r.confident).toBeNull();
    expect(r.choices.map((c) => c.fullName).sort()).toEqual(["Johann Gorsik", "Johann Weber"]);
    // the full name settles it
    expect(resolveClient("pull up Johann Weber's program", two).confident?.fullName).toBe("Johann Weber");
  });
  it("lists the closest when the spelling fits two people about equally", () => {
    const similar = [{ id: "a", fullName: "John Smith" }, { id: "b", fullName: "Johann Gorsik" }];
    const r = resolveClient("Johan", similar);
    expect(r.confident).toBeNull();
    expect(r.choices).toHaveLength(2);
  });
  it("a person in two groups is one person", () => {
    const dup = [...roster, { id: "1", fullName: "Johann Gorsik" }];
    expect(resolveClient("Johann", dup).confident?.fullName).toBe("Johann Gorsik");
    expect(names(rankClientsByName("Johann", dup))).toEqual(["Johann Gorsik"]);
  });

  it("finds nobody for a word that is not a name, an empty message, or a roster with no match", () => {
    expect(resolveClient("show me the calendar", roster).choices).toEqual([]);
    expect(resolveClient("", roster).choices).toEqual([]);
    expect(resolveClient("pull up Xavier", roster).choices).toEqual([]);
    expect(resolveClient("pull up Johann", []).choices).toEqual([]);
  });
  it("only ever returns people from the roster it was given", () => {
    const mine = [{ id: "1", fullName: "Johann Gorsik" }];
    expect(resolveClient("Alice", mine).choices).toEqual([]);
  });
});
