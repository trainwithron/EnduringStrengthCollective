import { initialsOf, initialsTint } from "@/lib/initials";

// A person's initials in a round chip of their own soft color (Look Refresh, Nov 20). `tintKey` is their id (their name when there is none), so the color is the
// same in every list. Size and type come from className.
export function InitialsAvatar({ name, tintKey, className = "w-10 h-10 text-xs" }: { name: string; tintKey: string; className?: string }) {
  const tint = initialsTint(tintKey || name);
  return (
    <span
      className={`rounded-full inline-flex items-center justify-center shrink-0 font-body font-semibold ${className}`}
      style={{ backgroundColor: tint.bg, color: tint.fg }}
      aria-hidden="true"
      data-initials-avatar
    >
      {initialsOf(name)}
    </span>
  );
}
