import { CheckCircle2, AlertTriangle } from "lucide-react";

// Real gap: client_intake.waiver_accepted/waiver_signed_name/completed_at
// were already fetched by the client profile page (for the age-gate/
// PAR-Q+ intake build) but never actually rendered anywhere — a coach
// had no way to confirm a signed waiver exists on file, same class of
// gap the PAR-Q+ answers panel already closed for the health-screening
// half of the same intake record. Only rendered when an intake row
// genuinely exists (this client was ever asked) — never shown for a
// pre-existing client who was never subject to the (non-retroactive)
// intake gate, which would otherwise read as a false alarm on every
// older client.
export function WaiverStatusLine({
  waiverAccepted,
  waiverSignedName,
  completedAt,
}: {
  waiverAccepted: boolean;
  waiverSignedName: string | null;
  completedAt: string | null;
}) {
  if (completedAt && waiverAccepted) {
    return (
      <div className="flex items-center gap-2 font-body text-xs text-moss">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>
          Waiver signed{waiverSignedName ? ` by ${waiverSignedName}` : ""} —{" "}
          {new Date(completedAt).toLocaleDateString()}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 font-body text-xs text-rust">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>Intake started but the waiver isn&apos;t signed yet.</span>
    </div>
  );
}
