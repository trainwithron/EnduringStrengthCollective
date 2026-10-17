# Guardian-signed consent for clients under 18 (design only, not built)

Status: design page for Ron. Nothing here is built. Until Ron decides, the written stance stays **adults only** (the beta notice says no real data for people under 18 until these steps exist).
Source: docs/research/intake-waivers-consent.md (F3), trust-privacy-minors.md. Not legal advice; the lawyer questions are at the end.

## What exists today
- A client under 13 is stopped at the birthday screen until a coach ticks "parent consent verified" (`minor_consent.verified`). That is a coach attestation, not a parent doing anything.
- A client 13 to 17 fills in the health form and signs the waiver themselves.
- There is a read-only parent view link (guardian_links) that needs verified consent to be made.

## What this design adds (smallest version)
1. **Under 13: stay closed.** No health answers are collected. The coach declines to onboard under-13s in the app until a verified-parent method is chosen with the lawyer (signed form returned by scan is the lowest-friction candidate).
2. **13 to 17: the guardian signs, the athlete agrees.**
   - Athlete enters their birthday, answers the health questions (they know their body), and taps "I agree to take part". They cannot finish.
   - The coach (or athlete) gives the guardian's email or phone. The guardian gets a signed link (same token style as the parent view link, expiring in 14 days).
   - The guardian sees the full waiver, a summary of the health answers, and an emergency-care line; types their name and relationship; ticks the box. The server records the guardian's own time, IP, device and the exact text (same record as an adult's signature, `legal_acceptances`, with a guardian role).
   - The form counts as complete only when both exist. Until then the athlete can look but not start a workout; the coach sees "Waiting on guardian" with Resend.
3. **No change to nutrition rules** (Ron's coach-and-parent decision stands).

## Built pieces this reuses
Server-finished intake (release D), the waiver snapshot with a version fingerprint, the parent link token, the coach "Needs you" strip for "Waiting on guardian".

## Not decided (needs Ron / the lawyer)
- Is a release signed by a 13 to 17 year old's guardian enforceable in the states our coaches work in? Which states void it?
- Can a coach's attestation ever satisfy verifiable parental consent for under-13s? (Report: probably not.)
- Does the guardian need an account, or is the signed link enough?
- Retention: how long signed waivers are kept, and what deleting an account removes.

## Recommendation
Keep "adults only" in writing. Build the 13-to-17 guardian flow only after the lawyer answers the first question; it is about a week of work on top of release D.
