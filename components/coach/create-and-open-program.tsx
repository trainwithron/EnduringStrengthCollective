"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { detectTrainingIntent } from "@/lib/training-intent";

// "Build program" / "New program": the program is made at once and the builder opens. The name is "[First name]'s program" for a client and "New program" in the library; it is editable at the
// top of the builder. Nothing is asked first. (Made when the page opens in the browser, never by a prefetch.)
export function CreateAndOpenProgram({
  groupId,
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
}) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const name = (athleteId || forClient) && athleteFirstName ? `${athleteFirstName}'s program` : "New program";
      const { data, error: insertError } = await createBrowserClient()
        .from("programs")
        .insert({ group_id: groupId, name, created_by: createdBy, athlete_id: athleteId, training_intent: detectTrainingIntent(name) })
        .select("id")
        .single();
      if (insertError || !data) {
        setError("Couldn't start the program. Try again.");
        started.current = false;
        return;
      }
      router.replace(`/groups/${groupId}/programs/${data.id}${forClient ? `?forClient=${forClient.id}&clientGroup=${forClient.groupId}` : ""}`);
    })();
  }, [groupId, createdBy, athleteId, athleteFirstName, forClient, router]);

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
