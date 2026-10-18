import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { pendingForProfile } from "@/lib/email-change";
import { CancelMyEmailChangeButton } from "@/components/auth/cancel-my-email-change-button";

// Shown at the top of every page for a person whose sign-in email has a change waiting (asked for by their coach, not yet confirmed by the new address). It is a banner and not only a notice, because a client
// with no real old email would otherwise never be told by email. Nothing has changed yet; they can cancel it here.
export async function PendingEmailChangeBanner({ userId }: { userId: string }) {
  let pending: { newEmail: string } | null = null;
  try {
    pending = await pendingForProfile(createServiceRoleClient(), userId);
  } catch {
    pending = null;
  }
  if (!pending) return null;
  return (
    <div className="border-b border-rust/50 bg-graphite px-4 py-3" role="status">
      <p className="font-body text-sm text-chalk">
        Your coach asked to change your sign-in email to {pending.newEmail}. Nothing has changed yet: it changes only if that address confirms. If you did not expect this, cancel it.
      </p>
      <CancelMyEmailChangeButton />
    </div>
  );
}
