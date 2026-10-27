"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { detectTrainingIntent } from "@/lib/training-intent";

// "Build program" / "New program": the program is made at once and the builder opens. The name is "[First name]'s program" for a client and "New program" in the library; it is editable at the
// top of the builder. Nothing is asked first. (Made when the page opens in the browser, never by a prefetch.)
// The programs started in the last few seconds, by what was asked for. If this page is mounted twice in a row (a page in a workspace pane could be drawn twice as it opened, which
// made two "Sawyer's program" 5 ms apart on Oct 26), the second mount opens the program the first one is making instead of making another.
const startedRecently = new Map<string, { at: number; made: Promise<string | null> }>();
const SAME_START_MS = 5000;

export function startOnce(key: string, make: () => Promise<string | null>, now: number = Date.now()): Promise<string | null> {
  const recent = startedRecently.get(key);
  if (recent && now - recent.at < SAME_START_MS) return recent.made;
  const made = make().then((id) => {
    if (id === null) startedRecently.delete(key);
    return id;
  });
  startedRecently.set(key, { at: now, made });
  return made;
}

export function CreateAndOpenProgram({
  groupId,
  orgProgram = false,
  createdBy,
  athleteId,
  athleteFirstName,
  forClient,
}: {
  groupId: string;
  createdBy: string;
  athleteId: string | null;
  athleteFirstName: string | null;
  // Started from a client's page: the program has no client on it; the builder offers "Assign to [First]".
  forClient?: { id: string; groupId: string } | null;
  // Made from the program library: the organization's own program (0435), never the group's it is stored in.
  orgProgram?: boolean;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const name = (athleteId || forClient) && athleteFirstName ? `${athleteFirstName}'s program` : "New program";
      const id = await startOnce(JSON.stringify([groupId, createdBy, athleteId, forClient?.id ?? null, orgProgram]), async () => {
        const { data, error: insertError } = await createBrowserClient()
          .from("programs")
          .insert({ group_id: groupId, name, created_by: createdBy, athlete_id: athleteId, is_active: athleteId !== null, training_intent: detectTrainingIntent(name), ...(orgProgram && athleteId === null ? { org_program: true } : {}) })
          .select("id")
          .single();
        return insertError || !data ? null : (data.id as string);
      });
      if (!id) {
        setError("Couldn't start the program. Try again.");
        started.current = false;
        return;
      }
      router.replace(`/groups/${groupId}/programs/${id}?edit=1${forClient ? `&forClient=${forClient.id}&clientGroup=${forClient.groupId}` : ""}`);
    })();
  }, [groupId, createdBy, athleteId, athleteFirstName, forClient, orgProgram, router]);

  return error ? (
    <div className="p-8">
      <p className="font-body text-sm text-rust" role="alert">
        {error}
      </p>
      <button type="button" onClick={() => router.refresh()} className="mt-3 min-h-11 px-4 border border-rust text-rust font-body text-sm">
        Try again
      </button>
    </div>
  ) : (
    <p className="p-8 font-body text-sm text-steel" role="status">
      Setting up your program…
    </p>
  );
}
