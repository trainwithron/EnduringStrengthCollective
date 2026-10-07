import { describe, it, expect } from "vitest";
import { ingredientSegments } from "./ingredient-segments";

describe("ingredient line segments", () => {
  it("keeps plain text as plain text", () => {
    expect(ingredientSegments("2 eggs")).toEqual([{ text: "2 eggs", bold: false }]);
  });
  it("bolds only what sits between an exact <strong> and </strong>", () => {
    expect(ingredientSegments("<strong>200g</strong> chicken breast")).toEqual([
      { text: "200g", bold: true },
      { text: " chicken breast", bold: false },
    ]);
    expect(ingredientSegments("<STRONG>1 cup</STRONG> rice")).toEqual([
      { text: "1 cup", bold: true },
      { text: " rice", bold: false },
    ]);
  });
  it("shows any other tag as text, never as markup", () => {
    const img = ingredientSegments('<img src=x onerror="alert(1)">');
    expect(img).toEqual([{ text: '<img src=x onerror="alert(1)">', bold: false }]);
    const script = ingredientSegments("<script>alert(1)</script>");
    expect(script.map((s) => s.text).join("")).toBe("<script>alert(1)</script>");
  });
  it("does not treat a strong tag with an attribute as bold (it stays text)", () => {
    const s = ingredientSegments('<strong onclick="x()">hi</strong>');
    expect(s.map((x) => x.text).join("")).toContain('<strong onclick="x()">hi');
    expect(s.find((x) => x.text.startsWith("<strong onclick"))?.bold).toBe(false);
  });
  it("handles empty and missing input", () => {
    expect(ingredientSegments("")).toEqual([]);
    expect(ingredientSegments(undefined as unknown as string)).toEqual([]);
  });
});
