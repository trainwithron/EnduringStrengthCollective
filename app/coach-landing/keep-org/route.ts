import { GET as landing } from "../route";

// Home on the phone while working (/dashboard on a phone): the landing decision that keeps the organization chosen in Spotlight. Its own path, not /coach-landing?keep=org: the browser's router
// tells addresses apart by path, not by what follows the "?", so a remembered fresh-open landing (/coach-landing, which starts in the home organization) could have been used for this one
// (lib/my-space-target.ts says how). The same route logic; /coach-landing?keep=org keeps working for old links.
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/coach-landing";
  url.searchParams.set("keep", "org");
  return landing(new Request(url, { headers: request.headers }));
}
