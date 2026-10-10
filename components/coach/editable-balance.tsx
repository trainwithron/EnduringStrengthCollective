"use client";

import { useEffect, useRef, useState } from "react";
import { parseBalanceInput } from "@/lib/balance-input";

// The sessions-left number, looking exactly as it did, but typeable: click it, backspace, type a new number. Enter or leaving the box saves it (onCommit says what the
// balance ended up as, or null when nothing changed); Escape or anything that is not a whole number from 0 to 500 puts the old number back, quietly.
export function EditableBalance({
  value,
  label,
  className,
  disabled,
  onCommit,
}: {
  value: number;
  label: string;
  className: string;
  disabled?: boolean;
  onCommit: (next: number) => Promise<number | null>;
}) {
  const [draft, setDraft] = useState(String(value));
  const skipBlur = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);

  async function commit() {
    const next = parseBalanceInput(draft);
    if (next == null || next === value) {
      setDraft(String(value));
      return;
    }
    const result = await onCommit(next);
    setDraft(String(result ?? value));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (skipBlur.current) {
          skipBlur.current = false;
          return;
        }
        void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          skipBlur.current = true;
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
      style={{ width: `${Math.max(draft.length, 2) + 0.5}ch` }}
      className={`${className} bg-transparent p-0 m-0 border-0 rounded-none focus:outline-none focus-visible:ring-1 focus-visible:ring-rust disabled:opacity-40`}
    />
  );
}
