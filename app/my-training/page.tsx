import { redirect } from "next/navigation";

export const metadata = { title: "My training" };

// "My training" no longer has a page of its own: the coach's own training is their personal space, opened as their own client app (older links and buttons land here).
export default function MyTrainingPage() {
  redirect("/my-space/home");
}
