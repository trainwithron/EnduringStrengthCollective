import type { SupabaseClient } from "@supabase/supabase-js";

// A challenge before/after photo is stored as its PATH in the private post-media bucket (not a link). A link that works for a year, stored in a row every fellow participant can read, would let any of them open
// anyone's photo; with a path, only the screen that is allowed to show the photo makes a short-lived link, for the person themselves and the challenge's coach. Photos saved earlier as full links are
// still shown (to those same two people only).
export function isStoredLink(value: string | null | undefined): boolean {
  return !!value && /^https?:\/\//i.test(value);
}

export async function challengePhotoLink(supabase: SupabaseClient, value: string | null | undefined, seconds = 3600): Promise<string | null> {
  if (!value) return null;
  if (isStoredLink(value)) return value;
  const { data } = await supabase.storage.from("post-media").createSignedUrl(value, seconds);
  return data?.signedUrl ?? null;
}

// Who may see a participant's photos: that participant and the coach who runs the challenge.
export function mayViewChallengePhotos(viewerId: string, participantId: string, challengeCoachId: string): boolean {
  return viewerId === participantId || viewerId === challengeCoachId;
}
