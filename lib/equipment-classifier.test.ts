import { describe, it, expect } from "vitest";
import { classifyEquipmentType } from "./equipment-classifier";

describe("classifyEquipmentType", () => {
  it("matches barbell exercises, including trap/EZ bar variants", () => {
    expect(classifyEquipmentType("Barbell Back Squat")).toBe("barbell");
    expect(classifyEquipmentType("Trap Bar Deadlift")).toBe("barbell");
    expect(classifyEquipmentType("EZ Bar Curl")).toBe("barbell");
  });

  it("matches dumbbell exercises", () => {
    expect(classifyEquipmentType("Dumbbell Bench Press")).toBe("dumbbell");
  });

  it("matches kettlebell exercises", () => {
    expect(classifyEquipmentType("Kettlebell Swing")).toBe("kettlebell");
  });

  it("prefers cable over the generic machine rule", () => {
    expect(classifyEquipmentType("Cable Machine Row")).toBe("cable");
    expect(classifyEquipmentType("Cable Fly")).toBe("cable");
  });

  it("matches machine exercises without cable/band in the name", () => {
    expect(classifyEquipmentType("Leg Press Machine")).toBe("machine");
    expect(classifyEquipmentType("Smith Machine Squat")).toBe("machine");
  });

  it("matches band exercises", () => {
    expect(classifyEquipmentType("Band Pull-Apart")).toBe("band");
  });

  it("matches bodyweight exercises", () => {
    expect(classifyEquipmentType("Push-Up")).toBe("bodyweight");
    expect(classifyEquipmentType("Pull-Up")).toBe("bodyweight");
    expect(classifyEquipmentType("Bodyweight Lunge")).toBe("bodyweight");
  });

  it("lets an explicit equipment word override the bodyweight default for the same movement", () => {
    expect(classifyEquipmentType("Dumbbell Walking Lunge")).toBe("dumbbell");
  });

  it("returns null when nothing in the name signals equipment", () => {
    expect(classifyEquipmentType("Nordic Curl")).toBeNull();
    expect(classifyEquipmentType("Face Pull")).toBeNull();
  });
});
