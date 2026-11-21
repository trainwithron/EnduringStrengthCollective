"use client";

import { useRouter } from "next/navigation";
import { MachineCatalogSection, useMachineCatalog } from "@/components/coach/machine-catalog-section";
import type { LibraryExerciseRow } from "@/components/coach/exercise-library-list";

// The platform admin curating the shared machine list directly (clutter audit DK1, Nov 21): the same section a coach's Machines tab has, with the admin's powers (additions go on the
// list at once, demos, exercises, taking things off) and without "Add to my gym". It lives here, under the review of what coaches sent, never on a coach's own Exercise library.
// `library` is the admin's own exercises with their demos, for "Or use one of my demos". The page keys this on the waiting requests, so an approval or denial above reads the list
// again; a change made here refreshes the page, so the review above is current too. The page above checks that the viewer is the platform admin; the tables' own row security and
// the review function check again.
export function MachineCatalogCurate({ adminId, library }: { adminId: string; library: LibraryExerciseRow[] }) {
  const router = useRouter();
  const { catalog, reload } = useMachineCatalog();
  // null: still reading, or the list could not be read (the review above says when it is not set up)
  if (!catalog) return null;
  return (
    <div className="mt-10" data-admin-machine-curate>
      <MachineCatalogSection
        coachId={adminId}
        orgId={null}
        isAdmin
        curateOnly
        catalog={catalog}
        reload={reload}
        machines={[]}
        library={library}
        onAdded={() => {}}
        onListChanged={() => router.refresh()}
      />
    </div>
  );
}
