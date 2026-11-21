// What sits under "More": the places you go, as opposed to Settings, which holds what you configure. One list so the page and anything that
// points at it agree, and so who sees what is a rule you can test.
export interface MoreLink {
  label: string;
  hint: string;
  href: string;
}

export interface MoreSection {
  title: string;
  links: MoreLink[];
}

export function buildMoreSections(opts: {
  groupId: string;
  athleteId: string;
  isCoach: boolean;
  historyImportEnabled: boolean;
  // CL20 (Nov 21): the coach sets this client's targets (the Macro calculator would only disagree with them), and the space is one-on-one (no group for a Hall of fame).
  coachSetsTargets?: boolean;
  oneOnOne?: boolean;
}): MoreSection[] {
  const g = `/groups/${opts.groupId}`;
  // A coach has no goal page of their own, so that one is for clients only. (There is no public progress page any more: Ron turned it off.)
  const training: MoreLink[] = [
    ...(opts.isCoach ? [] : [{ label: "My goal", hint: "What you are working toward", href: `${g}/goal` }]),
    { label: "1RM calculator", hint: "Estimate a max and see your percentages", href: `${g}/tools/one-rep-max` },
    ...(opts.oneOnOne ? [] : [{ label: "Hall of fame", hint: "The best lifts in the group", href: `${g}/records` }]),
  ];
  if (!opts.isCoach) {
    // Wave 2, P1 (Ron, Nov 20): the client's own lifts, body weight, photos and measurements, first in Training.
    training.unshift({ label: "My progress", hint: "Your lifts, best sets, photos and measurements", href: `${g}/progress` });
    // Audit C2 (Nov 21): the weekly check-in can always be opened again from here (to change it before the coach reviews it, or to see it after).
    training.splice(1, 0, { label: "Weekly check-in", hint: "Tell your coach how the week went", href: `${g}/check-in` });
    training.push({ label: "Video check-ins", hint: "Short videos from your coach", href: `${g}/video-checkins` });
    if (opts.historyImportEnabled) training.push({ label: "My exercise history", hint: "Past lifts you brought in", href: `${g}/my-history` });
  }
  const sections: MoreSection[] = [
    { title: "Training", links: training },
    {
      title: "Body and food",
      links: [
        ...(opts.isCoach
          ? [{ label: "Nutrition", hint: "Targets, meal plans and the calculator", href: `${g}/nutrition` }]
          : opts.coachSetsTargets
            ? []
            : [{ label: "Macro calculator", hint: "Work out calories and macros", href: `${g}/tools/macro-calculator` }]),
        // A client's photos are under My progress, Photos (with Add there); a coach keeps the photo journal row (CL20: two rows opened two different photo pages).
        ...(opts.isCoach ? [{ label: "My progress photos", hint: "Private unless you share them", href: `${g}/progress-photos` }] : []),
      ],
    },
    {
      title: "Community",
      links: [
        { label: "Messages", hint: opts.isCoach ? "Message your clients" : "Message your coach", href: `${g}/messages` },
        { label: "Find a training partner", hint: "Match with someone who trains near you", href: "/partners" },
        { label: "Resources", hint: "Links and offers from your coach", href: `${g}/resources` },
        { label: "Quick tips", hint: "Short reads on training and recovery", href: `${g}/quick-tips` },
      ],
    },
  ];
  // A section left with nothing in it is not shown.
  return sections.filter((s) => s.links.length > 0);
}
