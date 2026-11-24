"use client";

import { parseHeightInput, cmToFtIn, type WeightUnit } from "@/lib/units";

// Height as two drop-downs, feet and inches (Ron, Nov 23: typing 5'2 failed on an iPhone, which curls the '). Centimetres stay a number box with the number keypad.
// The value is the same text the forms already read with parseHeightInput: "5'2" for feet and inches, "157" for centimetres, "" for not given.
export const HEIGHT_FEET = [3, 4, 5, 6, 7] as const;
export const HEIGHT_INCHES = Array.from({ length: 12 }, (_, i) => i);

export function heightParts(value: string, unit: WeightUnit): { ft: string; inches: string } {
  const cm = value.trim() ? parseHeightInput(value, unit) : null;
  if (cm == null) return { ft: "", inches: "" };
  const { ft, inches } = cmToFtIn(cm);
  return { ft: String(ft), inches: String(inches) };
}

export function heightFromParts(ft: string, inches: string): string {
  return ft ? `${ft}'${inches || "0"}` : "";
}

export function HeightPicker({
  id,
  unit,
  value,
  onChange,
  selectClass,
  inputClass,
}: {
  id: string;
  unit: WeightUnit;
  value: string;
  onChange: (next: string) => void;
  selectClass: string;
  inputClass: string;
}) {
  if (unit === "kg") {
    return <input id={id} aria-label="Height in centimetres" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="cm" />;
  }
  const { ft, inches } = heightParts(value, unit);
  return (
    <div className="flex gap-2">
      <select id={id} aria-label="Feet" className={selectClass} value={ft} onChange={(e) => onChange(heightFromParts(e.target.value, inches))}>
        <option value="">Feet</option>
        {HEIGHT_FEET.map((f) => (
          <option key={f} value={String(f)}>
            {f} ft
          </option>
        ))}
      </select>
      <select aria-label="Inches" className={selectClass} value={ft ? inches || "0" : ""} disabled={!ft} onChange={(e) => onChange(heightFromParts(ft, e.target.value))}>
        {!ft && <option value="">Inches</option>}
        {HEIGHT_INCHES.map((i) => (
          <option key={i} value={String(i)}>
            {i} in
          </option>
        ))}
      </select>
    </div>
  );
}
