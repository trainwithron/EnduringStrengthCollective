import { redirect } from "next/navigation";

export const metadata = { title: "Availability" };

// Availability has ONE home: the Calendar's Availability tab (how clients book, the booking rules, the recurring hours, time off). This old page only sends the coach there, so a saved link or an old menu entry never
// lands on a second copy of the settings.
export default async function AvailabilityMovedPage() {
  redirect("/calendar?tab=availability");
}
