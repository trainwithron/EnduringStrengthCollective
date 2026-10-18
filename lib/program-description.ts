// The description of a program: a few plain sentences the coach types (or keeps from what the AI wrote) and clients see where they already see a program's description. Saved exactly as typed, apart from line endings and
// blank space at the two ends; an empty one is stored as nothing.
export const PROGRAM_DESCRIPTION_MAX = 2000;

export function tidyProgramDescription(text: string | null | undefined): string | null {
  const cleaned = (text ?? "").replace(/\r\n/g, "\n").trim().slice(0, PROGRAM_DESCRIPTION_MAX);
  return cleaned === "" ? null : cleaned;
}

// "123 / 2000", turning to a warning when there is little room left.
export function descriptionCounter(text: string): { label: string; nearLimit: boolean } {
  const used = text.length;
  return { label: `${used} / ${PROGRAM_DESCRIPTION_MAX}`, nearLimit: used >= PROGRAM_DESCRIPTION_MAX - 100 };
}
