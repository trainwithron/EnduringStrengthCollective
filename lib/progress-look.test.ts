import { describe, it, expect } from "vitest";
import {
  APPLIED_PREFIX,
  DELIBERATE_PREFIX,
  HINT_KEY,
  LATER_PREFIX,
  THRESHOLD_KEY,
  buildCards,
  buildHelpQuestionDraft,
  buildOptions,
  buildStatusNote,
  cardHeadline,
  collapseCards,
  describeLook,
  hiddenUntil,
  hintEnabled,
  isHidden,
  isMainLift,
  lookAtExercise,
  mentionsPain,
  progressThreshold,
  suggestedLoadStep,
  type ExerciseHistory,
  type ProgressEvent,
  type ProgressPoint,
} from "./progress-look";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 86400000).toISOString();
const pt = (n: number, weight: number, reps: number, rpe: number | null = null, missed = false): ProgressPoint => ({ date: day(n), weight, reps, rpe, missed });
const hist = (name: string, tier: ExerciseHistory["tier"], points: ProgressPoint[], extra: Partial<ExerciseHistory> = {}): ExerciseHistory => ({
  exerciseName: name,
  tier,
  points,
  nextTargetWeight: null,
  lastTargetReps: null,
  ...extra,
});
const ev = (key: string, at: number, action: ProgressEvent["action"] = "confirmed", detail: string | null = null): ProgressEvent => ({ key, action, detail, at: day(at) });

describe("the same load and reps for several sessions", () => {
  it("is seen at the threshold and not before", () => {
    const three = hist("Back Squat", "A", [pt(0, 225, 5), pt(7, 225, 5), pt(14, 225, 5)]);
    expect(lookAtExercise(three, 3, true)).toMatchObject({ sessions: 3, weight: 225, reps: 5, spanDays: 14, isMain: true });
    expect(lookAtExercise(hist("Back Squat", "A", [pt(0, 225, 5), pt(7, 225, 5)]), 3, true)).toBeNull();
  });

  it("counts the whole run back from the latest session, and an earlier change ends it", () => {
    const l = lookAtExercise(hist("Back Squat", "A", [pt(0, 205, 5), pt(7, 225, 5), pt(14, 225, 5), pt(21, 225, 5), pt(28, 225, 5)]), 3, true);
    expect(l?.sessions).toBe(4);
  });

  it("sees nothing when the load or the reps changed in the latest session", () => {
    expect(lookAtExercise(hist("Back Squat", "A", [pt(0, 225, 5), pt(7, 225, 5), pt(14, 230, 5)]), 3, true)).toBeNull();
    expect(lookAtExercise(hist("Back Squat", "A", [pt(0, 225, 5), pt(7, 225, 5), pt(14, 225, 6)]), 3, true)).toBeNull();
  });

  it("a missed set is information, not a reason to ask", () => {
    expect(lookAtExercise(hist("Back Squat", "A", [pt(0, 225, 5), pt(7, 225, 5, null, true), pt(14, 225, 5)]), 3, true)).toBeNull();
  });

  it("shows nothing when the program is already raising the weight next time", () => {
    const h = hist("Back Squat", "A", [pt(0, 225, 5), pt(7, 225, 5), pt(14, 225, 5)], { nextTargetWeight: 230 });
    expect(lookAtExercise(h, 3, true)).toBeNull();
    expect(lookAtExercise({ ...h, nextTargetWeight: 225 }, 3, true)).not.toBeNull();
  });
});

describe("effort", () => {
  it("a client who does not log effort is never skipped: it uses the same load and reps alone", () => {
    expect(lookAtExercise(hist("Bench", "A", [pt(0, 185, 5), pt(7, 185, 5), pt(14, 185, 5)]), 3, true)?.effort).toBe("none");
  });
  it("the same load at falling effort counts as getting stronger, and the card says so", () => {
    const l = lookAtExercise(hist("Back Squat", "A", [pt(0, 225, 5, 8), pt(7, 225, 5, 7), pt(14, 225, 5, 7), pt(21, 225, 5, 6.5)]), 3, true)!;
    expect(l.effort).toBe("falling");
    expect(describeLook(l)).toContain("Same weight at lower effort is getting stronger");
  });
  it("effort settling around 6 to 7 is the soft ready signal", () => {
    expect(lookAtExercise(hist("Bench", "A", [pt(0, 185, 5, 7), pt(7, 185, 5, 7), pt(14, 185, 5, 7)]), 3, true)?.effort).toBe("settled");
  });
  it("effort that is climbing at the same load is the fatigue watcher's job, not this one's", () => {
    expect(lookAtExercise(hist("Bench", "A", [pt(0, 185, 5, 7), pt(7, 185, 5, 8), pt(14, 185, 5, 9)]), 3, true)).toBeNull();
  });
  it("hard effort that is not changing is simply flat", () => {
    expect(lookAtExercise(hist("Bench", "A", [pt(0, 185, 5, 9), pt(7, 185, 5, 9), pt(14, 185, 5, 9)]), 3, true)?.effort).toBe("flat");
  });
});

describe("the rough-guide hint", () => {
  const h = hist("Bench", "A", [pt(0, 185, 7), pt(7, 185, 7), pt(14, 185, 7)], { lastTargetReps: 5 });
  it("appears for 1 or 2 reps over target twice in a row, labelled as a rough guide", () => {
    const l = lookAtExercise(h, 3, true)!;
    expect(l.overTargetHint).toBe(true);
    expect(describeLook(l)).toContain("A rough guide");
  });
  it("can be switched off, and is never a trigger on its own", () => {
    expect(lookAtExercise(h, 3, false)?.overTargetHint).toBe(false);
    expect(lookAtExercise(hist("Bench", "A", [pt(0, 185, 7), pt(7, 185, 8), pt(14, 185, 9)], { lastTargetReps: 5 }), 3, true)).toBeNull();
  });
  it("3 or more reps over target is not offered as the hint", () => {
    expect(lookAtExercise(hist("Bench", "A", [pt(0, 185, 9), pt(7, 185, 9), pt(14, 185, 9)], { lastTargetReps: 5 }), 3, true)?.overTargetHint).toBe(false);
  });
});

describe("main lifts", () => {
  it("are tier A or B by default", () => {
    expect(isMainLift("A")).toBe(true);
    expect(isMainLift("B")).toBe(true);
    expect(isMainLift("C")).toBe(false);
    expect(isMainLift(null)).toBe(false);
  });
});

describe("one card per workout", () => {
  const input = (histories: ExerciseHistory[]) => ({ key: "a1::p1::1", athleteId: "a1", groupId: "g1", title: "Tuesday lower", lastSessionAt: day(21), histories });
  const flat = (name: string, tier: ExerciseHistory["tier"]) => hist(name, tier, [pt(0, 100, 8), pt(7, 100, 8), pt(14, 100, 8), pt(21, 100, 8)]);
  const moving = (name: string, tier: ExerciseHistory["tier"]) => hist(name, tier, [pt(0, 100, 8), pt(7, 105, 8), pt(14, 110, 8), pt(21, 115, 8)]);

  it("points at the workout and flags other odd things in it", () => {
    const cards = buildCards(input([flat("Back Squat", "A"), flat("Romanian Deadlift", "C")]), 3, true);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("main");
    expect(cards[0].flagged.map((l) => l.exerciseName)).toEqual(["Back Squat"]);
    expect(cards[0].others.map((l) => l.exerciseName)).toEqual(["Romanian Deadlift"]);
  });

  it("accessories alone do not make the main card; they come later as their own soft card, only once the main lifts are moving", () => {
    expect(buildCards(input([moving("Back Squat", "A"), flat("Leg Curl", "C")]), 3, true).map((c) => c.kind)).toEqual(["accessory"]);
    // no main lift in the workout at all: nothing to say
    expect(buildCards(input([flat("Leg Curl", "C")]), 3, true)).toEqual([]);
  });

  it("an accessory has to have been flat for two weeks before it is mentioned", () => {
    const shortRun = hist("Leg Curl", "C", [pt(14, 100, 8), pt(16, 100, 8), pt(18, 100, 8), pt(20, 100, 8)]);
    expect(buildCards(input([moving("Back Squat", "A"), shortRun]), 3, true)).toEqual([]);
  });

  it("makes no card when everything is moving", () => {
    expect(buildCards(input([moving("Back Squat", "A"), moving("Leg Curl", "C")]), 3, true)).toEqual([]);
  });
});

describe("one collapsed row, at most three cards open", () => {
  it("counts them all and shows the three with the oldest evidence first", () => {
    const mk = (n: number, evidence: number) => ({ key: `k${n}`, athleteId: "a", groupId: "g", title: "T", kind: "main" as const, flagged: [], others: [], lastSessionAt: day(30), evidenceAt: day(evidence) });
    const { count, shown } = collapseCards([mk(1, 20), mk(2, 5), mk(3, 12), mk(4, 1), mk(5, 9), mk(6, 15)]);
    expect(count).toBe(6);
    expect(shown.map((c) => c.key)).toEqual(["k4", "k2", "k5"]);
  });
});

describe("learning per coach", () => {
  it("starts at 3", () => expect(progressThreshold([])).toBe(3));
  it("each 'Yes, deliberate' raises it by 1, up to 6", () => {
    const events = Array.from({ length: 8 }, (_, i) => ev(DELIBERATE_PREFIX + "x" + i, i));
    expect(progressThreshold(events.slice(0, 2))).toBe(5);
    expect(progressThreshold(events)).toBe(6);
  });
  it("each applied option lowers it by 1, never below 3", () => {
    const events = [ev(DELIBERATE_PREFIX + "a", 1), ev(DELIBERATE_PREFIX + "b", 2), ev(APPLIED_PREFIX + "c", 3), ev(APPLIED_PREFIX + "d", 4), ev(APPLIED_PREFIX + "e", 5)];
    expect(progressThreshold(events)).toBe(3);
  });
  it("a number the coach sets by hand wins, and the learning carries on from it", () => {
    expect(progressThreshold([ev(THRESHOLD_KEY, 1, "edited", "4")])).toBe(4);
    expect(progressThreshold([ev(THRESHOLD_KEY, 1, "edited", "4"), ev(DELIBERATE_PREFIX + "a", 2)])).toBe(5);
    expect(progressThreshold([ev(THRESHOLD_KEY, 1, "edited", "30")])).toBe(8);
    expect(progressThreshold([ev(THRESHOLD_KEY, 1, "edited", "nonsense")])).toBe(3);
  });
  it("is read in time order, whatever order the rows arrive in", () => {
    const a = [ev(DELIBERATE_PREFIX + "a", 5), ev(THRESHOLD_KEY, 1, "edited", "4")];
    expect(progressThreshold(a)).toBe(5);
  });
  it("the hint is on until the coach switches it off, and the latest choice wins", () => {
    expect(hintEnabled([])).toBe(true);
    expect(hintEnabled([ev(HINT_KEY, 1, "edited", "off")])).toBe(false);
    expect(hintEnabled([ev(HINT_KEY, 1, "edited", "off"), ev(HINT_KEY, 2, "edited", "on")])).toBe(true);
  });
});

describe("a card stays away after an answer", () => {
  const key = "progress::a::g::w::main";
  const now = new Date(day(10));
  it("'Yes, deliberate' keeps it quiet for 6 weeks", () => {
    const events = [ev(DELIBERATE_PREFIX + key, 0)];
    expect(isHidden(key, events, new Date(day(40)))).toBe(true);
    expect(isHidden(key, events, new Date(day(43)))).toBe(false);
  });
  it("'Not now' and 'look again in 2 weeks' keep it away for 2 weeks", () => {
    expect(isHidden(key, [ev(key, 0, "denied")], now)).toBe(true);
    expect(isHidden(key, [ev(key, 0, "denied")], new Date(day(15)))).toBe(false);
    expect(isHidden(key, [ev(LATER_PREFIX + key, 0)], now)).toBe(true);
  });
  it("applying an option gives the change 2 weeks to show", () => {
    expect(hiddenUntil(key, [ev(APPLIED_PREFIX + key, 0)])?.toISOString()).toBe(day(14));
  });
  it("answers about another workout change nothing", () => {
    expect(isHidden(key, [ev("progress::a::g::other::main", 0, "denied")], now)).toBe(false);
  });
});

describe("the options and the words", () => {
  const look = lookAtExercise(hist("Back Squat", "A", [pt(0, 225, 5, 8), pt(7, 225, 5, 7), pt(14, 225, 5, 7)]), 3, true)!;
  const options = buildOptions(look, "Rear Foot Elevated Split Squat");

  it("the panel is wide: load, rep, set, eccentric, pause, tempo, range, harder variation, control, lower effort, later, own program", () => {
    expect(options.map((o) => o.id)).toEqual(["load", "reps", "set", "eccentric", "pause", "tempo", "rom", "variation", "control", "effort", "later", "own"]);
    expect(options.find((o) => o.id === "variation")?.draft).toContain("Rear Foot Elevated Split Squat");
  });
  it("every number is a small rough starting draft", () => {
    expect(suggestedLoadStep(225)).toBe(5);
    expect(suggestedLoadStep(20)).toBe(2.5);
    expect(options.find((o) => o.id === "load")?.draft).toBe("+5");
  });
  it("never uses stalled, plateau or stuck, or blames", () => {
    const text = [
      ...options.map((o) => o.label + " " + o.draft),
      describeLook(look),
      cardHeadline({ key: "k", athleteId: "a", groupId: "g", title: "Tuesday lower", kind: "main", flagged: [look], others: [], lastSessionAt: day(14), evidenceAt: day(0) }, "Sam"),
      cardHeadline({ key: "k", athleteId: "a", groupId: "g", title: "Tuesday lower", kind: "accessory", flagged: [look], others: [], lastSessionAt: day(14), evidenceAt: day(0) }, "Sam"),
      buildStatusNote({ firstName: "Sam", effort: "falling" }),
      buildStatusNote({ firstName: "Sam", effort: "none" }),
      buildHelpQuestionDraft("Sam"),
    ].join(" ");
    expect(text).not.toMatch(/stall|plateau|stuck|fail|lazy|should have/i);
  });
  it("the client note is in the coach's voice and invites a reply instead of promising anything", () => {
    const note = buildStatusNote({ firstName: "Sam", effort: "settled" });
    expect(note).toContain("Hi Sam");
    expect(note).toContain("just reply here");
    expect(note).toContain("6 or 7");
  });
  it("the help question asks it in the client's own words and is optional", () => {
    expect(buildHelpQuestionDraft("Sam")).toContain("what do you feel you need the most help with right now");
    expect(buildHelpQuestionDraft("")).toContain("Hi there");
  });
});

describe("a recent pain or injury note", () => {
  it("is noticed in plain words", () => {
    expect(mentionsPain("left knee hurt on the way up")).toBe(true);
    expect(mentionsPain("Felt a tweak in my back")).toBe(true);
    expect(mentionsPain("Strained my shoulder last week")).toBe(true);
    expect(mentionsPain("sharp pinch in my elbow")).toBe(true);
    expect(mentionsPain("shoulder popped")).toBe(true);
    expect(mentionsPain("felt dizzy after")).toBe(true);
  });
  it("is not triggered by ordinary training talk", () => {
    expect(mentionsPain("felt strong, easy set")).toBe(false);
    expect(mentionsPain("sore but fine")).toBe(false);
    expect(mentionsPain(null)).toBe(false);
  });
});
