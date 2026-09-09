import type { ReactNode } from "react";

// Light-touch highlighting — matches "@First Last" / "@First" without
// needing the render path to know the actual member list. Good enough
// for visual emphasis; the real notification (who actually gets pinged)
// is resolved server-side against real member names in the database
// trigger, not this regex.
const MENTION_PATTERN = /@[A-Z][a-zA-Z'-]*(?:\s[A-Z][a-zA-Z'-]*)?/g;

export function renderWithMentions(body: string): ReactNode[] {
  const parts = body.split(MENTION_PATTERN);
  const matches = body.match(MENTION_PATTERN) ?? [];
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    out.push(part);
    if (matches[i]) {
      out.push(
        <span key={i} className="text-rust font-medium">
          {matches[i]}
        </span>
      );
    }
  });
  return out;
}
