// Athlete-facing loading-screen tips
// (loading_screen_tips_biomechanics_content_bank.md) — real, sourced
// biomechanics "did you know" facts and cue breakdowns, not generic
// fitness-magazine cliché. Citations are kept here even though they never
// ship to the UI, per the content bank's own instruction: a coach or
// athlete who pushes back on one of these should be answerable in one
// lookup.
//
// `type: "correction"` marks anything that overturns a popular belief
// (knees past toes, seated calf raises, soreness, etc.) — kept roughly
// balanced against plain "fact" entries so a run of loading screens
// doesn't read as relentlessly contrarian. Selection is a uniform random
// pick per render, not a tracked no-repeat playlist — these are brief,
// scattered flashes during route transitions, not one continuously
// re-rendered surface, so there's no real session state worth threading
// through a server component just to avoid an occasional back-to-back
// repeat.

export interface LoadingTip {
  id: string;
  type: "fact" | "correction";
  text: string;
  citation: string;
}

export const LOADING_TIPS: LoadingTip[] = [
  {
    id: "toe-windlass",
    type: "fact",
    text: "Press the big toe down and the plantar fascia winds tight, the arch lifts, and the shinbone rotates outward — your foot sets your hip's position before the hip does anything.",
    citation: "Hicks 1954; Bolgla & Malone 2004, J Athl Train; PMC11719425",
  },
  {
    id: "pinky-up-curl",
    type: "fact",
    text: "\"Pinky up\" on a curl really does add biceps work — but only when your wrist can still rotate (dumbbells, cables, rings — a barbell's already maxed out).",
    citation: "Coratella et al. 2023, PMC10054060; PubMed 42426831",
  },
  {
    id: "cue-chest-up",
    type: "correction",
    text: "\"Chest up\" actually means ribs to hips first, then lift the sternum — skip step one and the arch happens in your low back instead.",
    citation: "StatPearls, Anatomy Back Thoracic Vertebrae; PMC7002062",
  },
  {
    id: "cue-brace-core",
    type: "correction",
    text: "\"Brace your core\" means pressurize the whole wall like you're about to take a punch — not suck your navel in. Hollowing tested out weaker under load.",
    citation: "Grenier & McGill 2007, Arch Phys Med Rehabil",
  },
  {
    id: "cue-knees-out",
    type: "correction",
    text: "\"Knees out\" is a hip cue wearing a knee costume — the rotation comes from your glutes, the knee's just along for the ride.",
    citation: "Powers 2010, JOSPT; PMC3201064",
  },
  {
    id: "cue-knees-past-toes",
    type: "correction",
    text: "Blocking your knees from traveling forward doesn't remove the load — it cuts knee torque and multiplies hip torque roughly tenfold instead.",
    citation: "Fry et al. 2003, JSCR 17:629-633",
  },
  {
    id: "cue-drive-heels",
    type: "correction",
    text: "\"Drive through your heels\" is a fix for lifters drifting forward — a genuinely balanced lifter feels the whole foot, heel to toes, at once.",
    citation: "Starting Strength / Barbell Logic mid-foot balance cue",
  },
  {
    id: "cue-pack-shoulders",
    type: "correction",
    text: "\"Pack your shoulders\" is right on the bench and wrong overhead — your shoulder blade has to rotate up there, not stay pinned down.",
    citation: "Inman's scapulohumeral rhythm; Bret Contreras critique",
  },
  {
    id: "cue-squeeze-glutes",
    type: "correction",
    text: "\"Squeeze your glutes at the top\" means tuck the pelvis under, not lean back — leaning back just fakes hip extension with your low back.",
    citation: "Contreras, Hip Thrust: Hinge vs. Scoop Method",
  },
  {
    id: "cue-squat-deep",
    type: "correction",
    text: "If glutes are the goal, parallel isn't where the payoff is — glute EMG jumps significantly below parallel, not at it.",
    citation: "Caterisano et al. 2002, JSCR 16:428-432",
  },
  {
    id: "cue-feel-the-muscle",
    type: "fact",
    text: "Mind-muscle focus genuinely boosts activation — but only up to about 60% of your max. Past that, think about moving the weight, not feeling it.",
    citation: "Calatayud et al., PubMed 26700744",
  },
  {
    id: "fact-seated-calf-raise",
    type: "correction",
    text: "Seated calf raises have no soleus advantage over standing ones — the standing version grew the calf muscles more across the board.",
    citation: "Kinoshita/Maeo et al. 2023, Front Physiol 14:1272106",
  },
  {
    id: "fact-arch-spring",
    type: "fact",
    text: "The arch of your foot is a spring — it returns about 17% of the energy of a running stride, and the Achilles tendon about 35%, before your muscles do anything.",
    citation: "Ker et al. 1987, Nature 325:147-149",
  },
  {
    id: "fact-grip-strength",
    type: "fact",
    text: "Grip strength predicts death better than blood pressure does — every 5kg drop was linked to a 16% higher all-cause mortality risk across 139,691 adults.",
    citation: "Leong et al. 2015, Lancet 386:266-273 (PURE study)",
  },
  {
    id: "fact-wide-grip",
    type: "correction",
    text: "Wide grip doesn't build a wider back — grip width made no difference to lat activation on a pulldown. Grip orientation did; overhand beat underhand.",
    citation: "Lusk et al. 2010, JSCR; Andersen et al. 2014, PubMed 24662157",
  },
  {
    id: "fact-stiff-ankle",
    type: "fact",
    text: "A stiff ankle shows up as a knee problem — restricting ankle mobility during a squat increased knee valgus without changing anything about the knee itself.",
    citation: "Macrum et al. 2012, J Sport Rehabil 21:144-150",
  },
  {
    id: "fact-nordic-curl",
    type: "fact",
    text: "One exercise cuts hamstring injuries roughly in half — programs including the Nordic hamstring curl reduced injury rate 51% across 8,459 athletes.",
    citation: "van Dyk et al. 2019, BJSM 53:1362-1370",
  },
  {
    id: "fact-diaphragm-posture",
    type: "fact",
    text: "Your diaphragm is a posture muscle — it contracts before your arm even moves, and that contraction alone measurably stiffens your spine.",
    citation: "Hodges et al. 1997, J Physiol 505:539-548",
  },
  {
    id: "fact-biceps-rotator",
    type: "fact",
    text: "The biceps is a rotator before it's a lifter — one of the body's strongest forearm supinators, with its rotational leverage peaking near 90° of elbow flexion.",
    citation: "Coratella et al. 2023, PMC10054060",
  },
  {
    id: "fact-upper-arm-position",
    type: "fact",
    text: "Where your upper arm sits decides which muscle grows — incline curls grew the biceps more, preacher curls grew the brachialis/brachioradialis more.",
    citation: "2025, Eur J Sport Sci; PMC11906226",
  },
  {
    id: "fact-hamstring-length",
    type: "fact",
    text: "Training a muscle at long length beats training it short — true for calves, hamstrings, and biceps alike across three separate studies.",
    citation: "Maeo et al. 2021, Med Sci Sports Exerc",
  },
  {
    id: "fact-soreness",
    type: "correction",
    text: "Soreness is not a growth signal — in week one, protein synthesis goes toward repairing damage, not building muscle. It only tracks growth once the damage settles.",
    citation: "Damas et al. 2016, J Physiol 594:5209-5222",
  },
  {
    id: "fact-active-rom",
    type: "fact",
    text: "Range you can't control isn't range you own — passive range (where someone else moves your joint) routinely exceeds what you can actually use under load.",
    citation: "Standard kinesiology; FRC/CARs assessment logic",
  },
];

export function pickLoadingTip(): LoadingTip {
  return LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
}
