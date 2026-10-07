// A meal-plan ingredient line is stored as text that may carry <strong>...</strong> around the amount (the recipe database does, and older plans stored that way).
// A coach can write any text into a plan a client opens, so it must never be handed to the browser as HTML (a stored script in the line would run in the client's
// signed-in session). This splits a line into plain-text pieces and marks which are bold: ONLY an exact <strong> or </strong> counts as bold; every other tag, with any
// attribute, is shown as the text it is.

export interface IngredientSegment {
  text: string;
  bold: boolean;
}

export function ingredientSegments(line: string): IngredientSegment[] {
  const parts = String(line ?? "").split(/(<\/?strong>)/gi);
  const out: IngredientSegment[] = [];
  let bold = false;
  for (const part of parts) {
    if (/^<strong>$/i.test(part)) {
      bold = true;
    } else if (/^<\/strong>$/i.test(part)) {
      bold = false;
    } else if (part !== "") {
      out.push({ text: part, bold });
    }
  }
  return out;
}
