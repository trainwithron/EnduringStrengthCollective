import type { FocusEvent } from "react";
import { mismatchLine, WORKED_OUT_NOTE, type MacroAutofill, type MacroKey } from "@/lib/macro-autofill";

// The shared look of the worked-out field (lib/macro-autofill.ts) in the coach's target forms: its number in a muted style, a small "worked out" next to its label, and selected on focus so typing replaces it.
export function autoFieldProps(key: MacroKey, raw: string, fill: MacroAutofill): { value: string; auto: boolean; onFocus?: (e: FocusEvent<HTMLInputElement>) => void } {
  const auto = fill.key === key && fill.value != null && raw.trim() === "";
  return auto ? { value: String(fill.value), auto, onFocus: (e) => e.currentTarget.select() } : { value: raw, auto };
}

export function WorkedOutTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-1 font-body text-[11px] normal-case tracking-normal text-steel" data-worked-out>
      ({WORKED_OUT_NOTE})
    </span>
  );
}

export function MacroMismatchLine({ fill }: { fill: MacroAutofill }) {
  const line = mismatchLine(fill);
  if (!line) return null;
  return (
    <p className="font-body text-xs text-steel" data-macro-mismatch>
      {line}
    </p>
  );
}
