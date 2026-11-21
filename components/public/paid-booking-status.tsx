"use client";

import { useEffect, useState } from "react";
import { formatInTimezone } from "@/lib/format-in-timezone";

interface Status {
  state: "waiting" | "booked" | "refunded" | "lapsed";
  startIso: string;
  timezone: string;
  amountCents: number;
  typeName: string | null;
  coachName: string | null;
}

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Where a visitor lands after paying on Stripe (wave 3 C7). The booking is made when Stripe tells the app the payment went through, usually within seconds, so this page
// checks every few seconds for up to about two minutes and says plainly what happened.
export function PaidBookingStatus({ slug, token }: { slug: string; token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    let tries = 0;
    async function check() {
      tries++;
      try {
        const res = await fetch(`/api/public-booking/${slug}/paid-status?s=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as Status;
          if (stop) return;
          setStatus(data);
          if (data.state !== "waiting") return;
        }
      } catch {
        // try again
      }
      if (stop) return;
      if (tries >= 40) {
        setGaveUp(true);
        return;
      }
      setTimeout(check, 3000);
    }
    void check();
    return () => {
      stop = true;
    };
  }, [slug, token]);

  const what = status ? `${status.typeName ?? "Your session"}${status.coachName ? ` with ${status.coachName}` : ""}` : null;
  const when = status ? formatInTimezone(new Date(status.startIso), status.timezone, "dateTime") : null;

  let title = "Confirming your booking";
  let body: string = "Your payment is going through. This usually takes a few seconds.";
  if (missing) {
    title = "We can't find this payment";
    body = "Check your email for your booking. If you were charged and nothing arrives within an hour, contact your coach.";
  } else if (status?.state === "booked") {
    title = "You're booked";
    body = `${what}, ${when}. We emailed you a private link to change or cancel.`;
  } else if (status?.state === "refunded") {
    title = "Nothing was booked";
    body = `We couldn't book that time (usually because it was taken just before your payment went through), so we refunded ${money(status.amountCents)} to your card. Please pick another time.`;
  } else if (status?.state === "lapsed") {
    title = "Nothing was booked";
    body = "The time was released before a payment came through. If you were charged, it will be refunded automatically and we'll email you.";
  } else if (gaveUp) {
    title = "Still confirming";
    body = "This is taking longer than usual. You'll get an email as soon as it's booked. If the time can't be booked, your payment is refunded automatically.";
  }

  return (
    <div className="max-w-lg mx-auto px-5 py-10">
      <h1 className="font-display font-bold text-3xl uppercase leading-none" aria-live="polite">
        {title}
      </h1>
      <p className="font-body text-base mt-4" role="status">
        {body}
      </p>
      {(status?.state === "refunded" || status?.state === "lapsed") && (
        <a href={`/book/${slug}`} className="min-h-11 mt-6 inline-flex items-center bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2">
          Pick another time
        </a>
      )}
    </div>
  );
}
