import { cookies } from "next/headers";
import { ACTING_AS_COOKIE, ACTING_AS_SELF_COOKIE } from "@/lib/acting-as";
import { ActingAsBanner as ActingAsBannerClient } from "./acting-as-banner";

// The bar, decided on the server so it is right from the first paint. It is the coach's own training when the "acting as myself" setting is on, or when there is no act-as setting at all: the
// setting lasts 12 hours, and after it runs out the coach's own space still opens as their client app (lib/acting-as.ts), which showed "Coach Ron / Back to me" over their own feed (Ron, Nov 12).
export async function ActingAsBanner(props: { athleteFullName: string; groupId: string; isSelf?: boolean }) {
  const jar = await cookies();
  const isSelf = !!props.isSelf || jar.get(ACTING_AS_SELF_COOKIE)?.value === "1" || !jar.get(ACTING_AS_COOKIE)?.value;
  return <ActingAsBannerClient {...props} isSelf={isSelf} />;
}
