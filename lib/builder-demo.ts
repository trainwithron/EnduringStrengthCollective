// The demo video a coach sees on an exercise in the program builder (pure). It is looked up from the exercise's CURRENT name in the coach's own library, with the very same lookup the
// client's logger uses (lib/exercise-demo.ts findDemo), so what the coach previews is the demo the client will get. A snapshot taken when the page loaded would go stale the moment the
// coach picks a different exercise, so the lookup runs on the name as it is now.

import { findDemo, type Demo, type DemoRow } from "@/lib/exercise-demo";

export interface BuilderDemo {
  demo: Demo;
  // When the video is stored under a different exercise name (a Bulgarian split squat showing the rear foot elevated split squat video), that name, so a mismatch is visible.
  // Null when it is stored under this exercise's own name.
  storedUnder: string | null;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function builderDemoFor(library: DemoRow[], exerciseName: string): BuilderDemo | null {
  const demo = findDemo(library, exerciseName);
  if (!demo) return null;
  return { demo, storedUnder: same(demo.foundAs, exerciseName) ? null : demo.foundAs };
}

// The line shown under a thumbnail: always names the exercise the video belongs to, so a wrong pick is easy to spot.
export function demoCaption(exerciseName: string, b: BuilderDemo): string {
  return `Demo: ${b.storedUnder ?? exerciseName}`;
}
