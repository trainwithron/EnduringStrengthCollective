import { headers } from "next/headers";

// The browser itself labels what a request is for (Sec-Fetch-Dest) and a page cannot change that label, so "this request is for an iframe" is trustworthy as a
// DISPLAY hint (it only decides whether to draw the site's own chrome; it never grants anything). Only the site's own pages may frame a page (frame-ancestors).
export function isEmbeddedDest(secFetchDest: string | null | undefined): boolean {
  return secFetchDest === "iframe" || secFetchDest === "frame";
}

export async function isEmbeddedRequest(): Promise<boolean> {
  try {
    return isEmbeddedDest((await headers()).get("sec-fetch-dest"));
  } catch {
    return false;
  }
}
