import { createServerClient } from "@/lib/supabase/server";
import { NeedsYouStrip } from "@/components/coach/desktop/needs-you-strip";
import { pickNeedsYou } from "@/lib/needs-you";
import { loadNeedsYouItems, type NeedsYouHomeInputs } from "@/lib/needs-you-data";

// "Needs you": the single most urgent item of each of three kinds, from what Home already loaded plus a few small soft reads. It loads here, behind a Suspense on Home, so the rest
// of Home shows without waiting for those reads. A failure leaves that kind out, never the page. A strip that could not be built, or built from checks that did not all succeed,
// never says "You're caught up."
export async function NeedsYouLoader({ input }: { input: NeedsYouHomeInputs }) {
  const supabase = await createServerClient();
  let view = pickNeedsYou([], { incomplete: true });
  try {
    const needsYou = await loadNeedsYouItems(supabase, input);
    view = pickNeedsYou(needsYou.items, { incomplete: needsYou.failed.length > 0 });
  } catch (e) {
    console.error("[dashboard] needs-you failed:", e instanceof Error ? e.message : e);
  }
  return <NeedsYouStrip view={view} />;
}

export function NeedsYouLoading() {
  return (
    <section className="mb-6" aria-label="Needs you">
      <p className="font-body text-sm text-steel border border-steel/20 p-4" role="status">
        Checking what needs you…
      </p>
    </section>
  );
}
