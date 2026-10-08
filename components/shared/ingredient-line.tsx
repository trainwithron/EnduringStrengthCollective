import { ingredientSegments } from "@/lib/ingredient-segments";
import { withHouseholdMeasure, type PortionUnits } from "@/lib/portions";

// One ingredient line as text, with <strong> amounts shown bold. Never dangerouslySetInnerHTML (see lib/ingredient-segments.ts). A gram amount for a food the measure table knows gets
// its household measure added when it is shown ("166g (about 2/3 cup)"); the stored line is not changed. portionUnits "household" puts the measure first.
export function IngredientLine({ text, portionUnits = "grams" }: { text: string; portionUnits?: PortionUnits }) {
  return (
    <>
      {"• "}
      {ingredientSegments(withHouseholdMeasure(text, portionUnits)).map((seg, i) => (seg.bold ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>))}
    </>
  );
}
