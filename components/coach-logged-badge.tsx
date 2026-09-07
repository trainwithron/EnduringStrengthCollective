import { Star } from "lucide-react";

// Shown wherever a session/log resulted from a coach logging an in-person
// session on a client's behalf, so it never silently looks like the
// client's own entry when they look back at their history later.
export function CoachLoggedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-body text-[11px] text-[#D4A94C] ${className}`}
    >
      <Star className="w-3 h-3 fill-current" aria-hidden="true" />
      Coach logged
    </span>
  );
}
