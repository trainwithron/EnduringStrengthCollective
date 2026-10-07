import { ingredientSegments } from "@/lib/ingredient-segments";

// One ingredient line as text, with <strong> amounts shown bold. Never dangerouslySetInnerHTML (see lib/ingredient-segments.ts).
export function IngredientLine({ text }: { text: string }) {
  return (
    <>
      {"• "}
      {ingredientSegments(text).map((seg, i) => (seg.bold ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>))}
    </>
  );
}
