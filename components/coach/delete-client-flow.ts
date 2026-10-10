import { confirmDialogWithChoice } from "@/components/shared/confirm-dialog";

export type DeleteClientResult = { status: "cancelled" } | { status: "deleted"; spaceGone: boolean } | { status: "failed"; error: string };

// The ONE way a client is deleted (from their profile or from a card's menu): the in-page confirm, with the one extra choice (also erase their logged workouts and the coach's notes) as a tick-box in
// the same dialog, then the delete request. The server still checks everything that matters (the caller coaches the group, the person is a plain client of it, the rest of their groups are this
// coach's too, no live subscription).
export async function runDeleteClient({ groupId, athleteId, athleteName }: { groupId: string; athleteId: string; athleteName: string }): Promise<DeleteClientResult> {
  const { confirmed, checked } = await confirmDialogWithChoice({
    message: `Delete ${athleteName}? This permanently removes their account and cannot be undone.`,
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
    checkbox: { label: "Also erase their logged workouts and my notes about them", checked: false },
  });
  if (!confirmed) return { status: "cancelled" };
  try {
    const res = await fetch("/api/clients/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId, athleteId, eraseHistory: checked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: "failed", error: data.error ?? "Couldn't delete this client. Nothing was deleted." };
    return { status: "deleted", spaceGone: Array.isArray(data.deletedGroupIds) && data.deletedGroupIds.includes(groupId) };
  } catch {
    return { status: "failed", error: "Couldn't delete this client. Check your connection. Nothing was deleted." };
  }
}
