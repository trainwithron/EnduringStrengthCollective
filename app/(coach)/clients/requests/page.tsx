import { redirect } from "next/navigation";
import { REQUESTS_PATH } from "@/lib/requests-center";

// The people asking to train with the coach are on the Requests page now, with everything else waiting on the coach's answer (Ron, Nov 19). Old links and old notices land there.
export default function ClientRequestsPage() {
  redirect(REQUESTS_PATH);
}
