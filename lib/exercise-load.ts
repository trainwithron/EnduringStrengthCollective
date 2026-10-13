// Exercises that are never loaded or rated: mobility drills (CARs), stretches, foam rolling, holds and similar. The workout logger hides weight and RPE for them (a link brings them back), so a coach
// or client logging "Shoulder CARs" is not asked for a weight and an effort score. A strength lift is never matched here.

const NO_LOAD = /\b(cars?|mobility|stretch(?:es)?|foam roll(?:ing)?|roll out|hold|holds|plank|planks|hang|dead hang|cat[- ]cow|bird dog|dead bug|breathing|breathe|squat sit|squat sits|aeroplane|aeroplanes|90\/90|thoracic|scap(?:ular)?|warm[- ]?up|isometric)\b/i;
const LOADED = /\b(barbell|dumbbell|kettlebell|cable|machine|smith|trap bar|sled|weighted|loaded|plate|farmer|sandbag|landmine)\b/i;

export function isNoLoadExercise(name: string): boolean {
  if (!name) return false;
  if (LOADED.test(name)) return false;
  return NO_LOAD.test(name);
}
