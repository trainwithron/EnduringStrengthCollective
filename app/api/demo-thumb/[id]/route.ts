import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isYoutubeId, youtubeThumbSource } from "@/lib/exercise-demo";

// The small picture on an exercise's Demo thumbnail, served from our own address so a client's phone never asks Google for it just by looking at a
// workout (the YouTube player itself is contacted only when someone taps Demo). The server fetches the picture from YouTube's image host, only for a
// well-formed video id and only for a signed-in person, and lets the phone and our edge keep it for a long time. If YouTube has no picture for the id
// (a private or removed video) this answers 404 and the card shows a neutral play tile instead.
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const id = params.id;
  if (!isYoutubeId(id)) return new NextResponse(null, { status: 400 });

  try {
    const upstream = await fetch(youtubeThumbSource(id), { cache: "force-cache", next: { revalidate: 60 * 60 * 24 * 7 } });
    const type = upstream.headers.get("content-type") ?? "";
    // Only a plain picture: never something else (an SVG, say) served from our own address.
    if (!upstream.ok || !/^image\/(jpeg|webp|png)\b/i.test(type)) return new NextResponse(null, { status: 404 });
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 500_000) return new NextResponse(null, { status: 404 });
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
