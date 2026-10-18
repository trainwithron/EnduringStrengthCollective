import { confirmDialog, confirmDialogWithChoice } from "@/components/shared/confirm-dialog";
import { DELETE_CONFIRM, REMOVE_CONFIRM } from "@/lib/client-removal";

export type DeleteClientResult = { status: "cancelled" } | { status: "deleted"; spaceGone: boolean } | { status: "failed"; error: string };
export type RemoveClientResult = { status: "cancelled" } | { status: "removed" } | { status: "failed"; error: string };

async function post(path: string, payload: Record<string, unknown>, failure: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? failure };
    return { ok: true };
  } catch {
    return { ok: false, error: `${failure.replace(/\.$/, "")}. Check your connection.` };
  }
}

// "Remove from my clients": the default way to get rid of a client. They leave the coach's lists and counts and lose the group; their account and data are kept and the coach can put them back at any time.
export async function runRemoveClient({ groupId, athleteId, athleteName }: { groupId: string; athleteId: string; athleteName: string }): Promise<RemoveClientResult> {
  const confirmed = await confirmDialog({ message: REMOVE_CONFIRM(athleteName), confirmLabel: "Remove", cancelLabel: "Cancel" });
  if (!confirmed) return { status: "cancelled" };
  const result = await post("/api/clients/remove", { groupId, athleteId, permanent: false }, "Couldn't remove this client. Nothing was changed.");
  return result.ok ? { status: "removed" } : { status: "failed", error: result.error };
}

// "Delete permanently": the same removal, with 30 days to change your mind before the account is erased. The one extra choice (also erase their logged workouts and the coach's notes) is a tick-box in the same dialog.
// The server still checks everything that matters (the caller coaches the group and the person is a client of it).
export async function runDeleteClient({ groupId, athleteId, athleteName }: { groupId: string; athleteId: string; athleteName: string }): Promise<DeleteClientResult> {
  const { confirmed, checked } = await confirmDialogWithChoice({
    message: DELETE_CONFIRM(athleteName),
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
    checkbox: { label: "Also erase their logged workouts and my notes about them", checked: false },
  });
  if (!confirmed) return { status: "cancelled" };
  const result = await post("/api/clients/remove", { groupId, athleteId, permanent: true, eraseHistory: checked }, "Couldn't delete this client. Nothing was changed.");
  // The person is out of the group now; a one-on-one space that held only them is still there (it goes when the account does).
  return result.ok ? { status: "deleted", spaceGone: false } : { status: "failed", error: result.error };
}
