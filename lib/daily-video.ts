// Server-only Daily.co REST client for 1-on-1 booking video calls
// (webrtc_video_provider_comparison memory). Same "missing key degrades
// gracefully" pattern as lib/stripe.ts/lib/anthropic-client.ts — the app
// runs fine with no DAILY_API_KEY set, the Join Call control just
// returns a clear "not configured" error instead of crashing.
//
// Deliberately behind one helper, not called directly from route
// handlers — if usage ever crosses the point where LiveKit Cloud becomes
// materially cheaper, swapping providers means changing this one file,
// not every call site.
const DAILY_API_BASE = "https://api.daily.co/v1";

export function isDailyConfigured(): boolean {
  return !!process.env.DAILY_API_KEY;
}

export interface VideoRoom {
  url: string;
  name: string;
}

function dailyHeaders() {
  return {
    Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
    "content-type": "application/json",
  };
}

// Lazily creates (or reuses) a video room for one booking — room name is
// deterministic from the booking id so both parties independently
// clicking "Join call" land in the same room instead of creating
// duplicates. `expUnixSeconds` + eject_at_room_exp means the room
// self-destructs shortly after the booking window, no manual cleanup
// job needed. Recording is deliberately never requested — the moment it
// is would create a durable video record of a minor in a real group,
// which needs parental consent + a retention policy that doesn't exist
// yet. Not exposed in the UI at all for V1.
export async function getVideoRoom(bookingId: string, expUnixSeconds: number): Promise<VideoRoom> {
  if (!isDailyConfigured()) {
    throw new Error("DAILY_API_KEY is not set.");
  }
  const roomName = `booking-${bookingId}`;

  const existing = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, { headers: dailyHeaders() });
  if (existing.ok) {
    const room = await existing.json();
    return { url: room.url, name: room.name };
  }

  const created = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: "POST",
    headers: dailyHeaders(),
    body: JSON.stringify({
      name: roomName,
      privacy: "private",
      properties: {
        exp: expUnixSeconds,
        eject_at_room_exp: true,
        enable_recording: false,
      },
    }),
  });
  if (!created.ok) {
    throw new Error(`Failed to create Daily room (${created.status}).`);
  }
  const room = await created.json();
  return { url: room.url, name: room.name };
}

// Rooms are private, so joining needs a real per-participant meeting
// token rather than just the room URL.
export async function createMeetingToken(
  roomName: string,
  participantName: string,
  isOwner: boolean
): Promise<string> {
  if (!isDailyConfigured()) {
    throw new Error("DAILY_API_KEY is not set.");
  }
  const res = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
    method: "POST",
    headers: dailyHeaders(),
    body: JSON.stringify({
      properties: { room_name: roomName, user_name: participantName, is_owner: isOwner },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Daily meeting token (${res.status}).`);
  }
  const data = await res.json();
  return data.token as string;
}
