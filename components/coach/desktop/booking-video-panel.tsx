"use client";

import { useState } from "react";
import { BookingVideoToggle } from "@/components/coach/booking-video-toggle";
import { VideoCallButton } from "@/components/booking/video-call-button";

export function BookingVideoPanel({
  bookingId,
  initialSessionType,
}: {
  bookingId: string;
  initialSessionType: "in_person" | "video";
}) {
  const [sessionType, setSessionType] = useState(initialSessionType);
  return (
    <div className="flex items-center gap-2">
      {sessionType === "video" && <VideoCallButton bookingId={bookingId} />}
      <BookingVideoToggle bookingId={bookingId} initialSessionType={sessionType} onChanged={setSessionType} />
    </div>
  );
}
