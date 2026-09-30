import type { ReactNode } from "react";

// The established "real section card" treatment for a settings-style
// control — a small rust eyebrow label above a bordered, rounded,
// tinted-background container. Originally local to the athlete Settings
// page; extracted here so the coach's client-profile page (and anywhere
// else with a cluster of individually-bare settings controls) can match
// the same visual language instead of quietly reinventing it.
export function SettingsGroup({
  label,
  highlight,
  children,
}: {
  label?: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      {label && (
        <p className="font-body text-[10px] font-bold uppercase tracking-wide text-rust mb-2">
          {label}
        </p>
      )}
      <div
        className={`border rounded-lg p-4 ${
          highlight ? "border-rust/40 bg-surface/60" : "border-steel/20 bg-surface/30"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
