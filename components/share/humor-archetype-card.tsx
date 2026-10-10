"use client";

import { useId } from "react";
import type { HumorArchetype } from "@/lib/humor-archetypes";

// Composites the athlete's own avatar into the archetype's face-hole via
// a real SVG clipPath + <image> — not a CSS mask hack layered over two
// separate elements, which drifts out of alignment at different sizes.
// avatarUrl is optional: with none, the hole shows a plain disc with the
// person's first initial (never an empty dashed circle, which reads as a
// missing picture).
export function HumorArchetypeCard({
  archetype,
  avatarUrl,
  initial,
}: {
  archetype: HumorArchetype;
  avatarUrl: string | null;
  // The person's name; its first letter is drawn when there is no photo.
  initial?: string | null;
}) {
  const clipId = useId();
  const { faceHole } = archetype;
  const firstLetter = (initial ?? "").trim().charAt(0).toUpperCase();

  return (
    <svg viewBox="0 0 150 170" className="w-full h-full" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <circle cx={faceHole.cx} cy={faceHole.cy} r={faceHole.r} />
        </clipPath>
      </defs>
      {/* eslint-disable-next-line react/no-danger */}
      <g dangerouslySetInnerHTML={{ __html: archetype.bodyPaths }} />
      {avatarUrl ? (
        <image
          href={avatarUrl}
          x={faceHole.cx - faceHole.r}
          y={faceHole.cy - faceHole.r}
          width={faceHole.r * 2}
          height={faceHole.r * 2}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <>
          <circle cx={faceHole.cx} cy={faceHole.cy} r={faceHole.r} fill="#211f1c" stroke="rgba(210,112,59,.6)" strokeWidth={2} />
          {firstLetter && (
            <text
              x={faceHole.cx}
              y={faceHole.cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={faceHole.r * 1.1}
              fontWeight={700}
              fill="#EDE8E0"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              {firstLetter}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
