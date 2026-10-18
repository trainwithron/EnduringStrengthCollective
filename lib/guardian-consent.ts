import { isUnder13 } from "@/lib/coppa";
import { isMinorDob } from "@/lib/youth-block";

// Guardian consent for a client aged 13 to 17 (Release V1). Built on the strictest-state research (docs/research/minor-consent-strictest-state.md): the guardian's signature is INFORMED CONSENT and an
// acknowledgment of risk, never a release of the child's claims; there is no waiver, release or indemnity wording anywhere in it; it says plainly that the guardian may refuse; and the child is never the one who
// consents. A client under 13 is not taken at all (a hard block). Not legal advice: the lawyer questions are in docs/NEEDS_RON.md.
export type AgeBand = "under13" | "teen" | "adult" | "unknown";

// 13 to 17 needs a guardian; under 13 is not accepted; 18 and over is an adult. (The age of majority in Alabama, Nebraska and Mississippi is higher; see majorityAgeFor.)
export function ageBand(dateOfBirth: string | null | undefined, now: Date = new Date()): AgeBand {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) return "unknown";
  const dob = dateOfBirth.slice(0, 10);
  if (isUnder13(dob, now)) return "under13";
  return isMinorDob(dob, now) ? "teen" : "adult";
}

export type GuardianConsentState = "none" | "pending" | "signed" | "withdrawn";

export const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

export function isUsState(code: string): boolean {
  return US_STATES.some((s) => s.code === code);
}

// The age of majority where the guardian lives: 18 almost everywhere, 19 in Alabama and Nebraska, and Mississippi treated as 21 until counsel says otherwise. Recorded with the consent and named in the packet.
// (Making the app require a guardian for someone 18 to 20 in those states is not built yet; it is listed in docs/NEEDS_RON.md.)
export function majorityAgeFor(state: string): number {
  if (state === "AL" || state === "NE") return 19;
  if (state === "MS") return 21;
  return 18;
}

export const RELATIONSHIPS = ["Parent", "Legal guardian"] as const;

// The packet. VERSION changes whenever the words change; the exact text the guardian saw is stored with the signature (its SHA-256 fingerprint is recorded too), so the record always matches the words.
export const GUARDIAN_PACKET_VERSION = "guardian-consent-2026-10";

export function guardianPacketText(args: { athleteName: string; coachName: string | null; state: string | null }): string {
  const child = args.athleteName.trim() || "your child";
  const coach = args.coachName?.trim() || "their coach";
  const age = args.state ? majorityAgeFor(args.state) : null;
  return [
    `PERMISSION FOR ${child.toUpperCase()} TO TRAIN`,
    "",
    `${child} is 17 or younger and wants to train with ${coach} using Spotlight Coaching (the app). Because ${child} is under the age of majority, we ask a parent or legal guardian to read this and give informed consent. ${child} also agrees to take part; ${child}'s own agreement is not a substitute for yours.`,
    "",
    "WHAT THE SERVICE IS",
    `${coach} writes training programs and may give nutrition guidance. They may send messages in the app. Some programs and suggestions are drafted with the help of artificial intelligence; ${coach} reviews them before ${child} sees them. Nothing here is medical advice.`,
    "",
    "THE RISKS, IN PLAIN WORDS",
    "Exercise carries a risk of injury, from sore muscles to serious injury, and in rare cases worse. Following a program, lifting weights, running, jumping and similar work all carry that risk even when done correctly. By signing you say you understand this and are choosing to let your child take part.",
    "",
    "THE HEALTH QUESTIONS",
    `${child} will be asked health and injury questions so the program can be safe. The answers are seen by ${child} and ${coach} (and, in a gym or team, only the people the organization's owner has allowed). They are used only to plan training safely. If your child has a condition, injury or doctor's restriction, tell ${coach} and follow your doctor's advice first.`,
    "",
    "YOUR RIGHTS",
    `You may refuse to sign. If you do not sign, we may decline to coach ${child}. You may withdraw this permission at any time using the link in the copy we email you; after that, ${child} can no longer use the app until a guardian gives permission again. You may ask ${coach} to see what is kept about your child.`,
    "",
    "OTHER THINGS WE WILL NOT DO WITHOUT SEPARATE PERMISSION",
    `We will not use ${child}'s photos, videos, name or results in advertising or on shared pages that people outside the team can see without a separate yes from you. Names of people under 18 are shortened on shared boards.`,
    "",
    age
      ? `AGE OF MAJORITY: in your state, a person becomes an adult at ${age}. This permission applies until then.`
      : "AGE OF MAJORITY: this permission applies until your child becomes an adult where you live (18 in most states, 19 in Alabama and Nebraska, 21 in Mississippi).",
    "",
    "THIS IS NOT A RELEASE",
    `Signing this does not give up any right you or ${child} may have. It records that you were told about the risks, that you were told how the service works, and that you agreed to it.`,
  ].join("\n");
}

export type EmailCheck = { ok: true; email: string } | { ok: false; reason: "invalid" | "same_as_child" };

// The guardian's address must look like an address and must not be the child's own sign-in address (the whole point is a different person's inbox).
export function checkGuardianEmail(raw: string, childEmail: string | null | undefined): EmailCheck {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, reason: "invalid" };
  if (childEmail && email === childEmail.trim().toLowerCase()) return { ok: false, reason: "same_as_child" };
  return { ok: true, email };
}

export const GUARDIAN_LINK_DAYS = 14;

// Valid signature fields: a real name (two or more letters), a relationship from the list, a state, and both boxes ticked.
export function checkSignature(input: { name: string; relationship: string; state: string; understood: boolean; mayRefuse: boolean }): string | null {
  if (input.name.trim().replace(/[^\p{L}]/gu, "").length < 2) return "Type your full name.";
  if (!(RELATIONSHIPS as readonly string[]).includes(input.relationship)) return "Choose your relationship to the child.";
  if (!isUsState(input.state)) return "Choose the state where you live.";
  if (!input.understood) return "Tick the box to say you read and understood this.";
  if (!input.mayRefuse) return "Tick the box to say you know you may refuse.";
  return null;
}
