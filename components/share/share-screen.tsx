"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OneScreenCard } from "@/components/share/one-screen-card";
import { ShareActions } from "@/components/share/share-actions";
import type { ShareImageInput, ShareImageModel } from "@/lib/share-image";
import { pickFreshFunLine, rerollFunLine, type FunLine, type WorkoutFacts } from "@/lib/workout-fun-line";
import { readFunMemory, rememberLine, writeFunMemory } from "@/lib/fun-line-memory";

function deviceStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// The card, the "Another one" button and the share controls, sharing one fun line. The line is chosen when the card is first made on the CLIENT'S device: fresh,
// and never one they saw in their last 20 (the device remembers). It is remembered per card, so reloading shows the same line and the posted picture always
// matches the screen. Anyone else who opens the link sees the default line the server picked (the same every time), with no button.
export function ShareScreen({
  postId,
  viewerId,
  isOwner,
  facts,
  defaultLine,
  model,
  background,
  coachLine,
  hasPr,
  imageInput,
  title,
  homeHref,
}: {
  postId: string;
  viewerId: string | null;
  isOwner: boolean;
  facts: WorkoutFacts;
  defaultLine: FunLine;
  model: ShareImageModel;
  background: ReactNode;
  coachLine: { coachFirstName: string; text: string } | null;
  hasPr: boolean;
  imageInput: Omit<ShareImageInput, "showName" | "funLine">;
  title: string;
  homeHref: string | null;
}) {
  const [line, setLine] = useState<FunLine>(defaultLine);
  const canShuffle = isOwner && !!viewerId;
  // A viewer who is not the owner shows the default at once. The owner's line is chosen on their device, so the line stays invisible (and the picture waits)
  // until then; otherwise the text would flip after load and the picture would be drawn twice.
  const [ready, setReady] = useState(!canShuffle);

  // First render on the client's own device: use the line already chosen for this card, else choose a fresh one and remember it.
  useEffect(() => {
    if (!canShuffle || !viewerId) return;
    const storage = deviceStorage();
    const memory = readFunMemory(storage, viewerId);
    const chosen = memory.byPost[postId];
    if (chosen) {
      setLine(chosen);
      setReady(true);
      return;
    }
    const fresh = pickFreshFunLine(facts, memory.recent);
    writeFunMemory(storage, viewerId, rememberLine(memory, postId, fresh));
    setLine(fresh);
    setReady(true);
    // The facts are fixed for this card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, viewerId, canShuffle]);

  function another() {
    if (!viewerId) return;
    const storage = deviceStorage();
    const memory = readFunMemory(storage, viewerId);
    const next = rerollFunLine(facts, memory.recent, line.id);
    writeFunMemory(storage, viewerId, rememberLine(memory, postId, next));
    setLine(next);
  }

  return (
    <>
      <OneScreenCard
        model={{ ...model, funLine: line.text }}
        background={background}
        coachLine={coachLine}
        hasPr={hasPr}
        onShuffle={canShuffle ? another : undefined}
        funLineHidden={!ready}
      />
      <ShareActions input={{ ...imageInput, funLine: line.text }} title={title} homeHref={homeHref} hold={!ready} />
    </>
  );
}
