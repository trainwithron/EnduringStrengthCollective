"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="h-10 px-4 bg-black text-white text-sm font-medium">
      Print or save as PDF
    </button>
  );
}
