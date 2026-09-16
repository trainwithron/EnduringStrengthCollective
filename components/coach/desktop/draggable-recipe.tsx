"use client";

import type { MealSlot } from "@/lib/meal-engine";

export interface DraggedRecipe {
  recipeId: string;
  recipeName: string;
  slot: MealSlot;
}

export const RECIPE_DRAG_MIME = "application/x-esc-recipe";

// training_block_aware_nutrition_and_dragdrop_meal_planner_sept16.md —
// a direct clone of draggable-workout-day.tsx's already-proven native
// HTML5 drag pattern, pointed at recipes instead of program days. Same
// dataTransfer/effectAllowed shape, own MIME so a recipe can never be
// dropped onto a workout target (or vice versa) by accident.
export function DraggableRecipe({
  recipe,
  children,
  className,
}: {
  recipe: DraggedRecipe;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(RECIPE_DRAG_MIME, JSON.stringify(recipe));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`cursor-grab active:cursor-grabbing ${className ?? ""}`}
      title="Drag onto a meal slot to add this recipe to that day"
    >
      {children}
    </div>
  );
}
