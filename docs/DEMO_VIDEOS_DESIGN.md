# Exercise demo videos: easy to see, never forced

Ron, Oct 6: while logging a workout he did not see the demo video. Demos must be glanceable and easy to play, available if you want them, and quiet for clients who do not.

## What was wrong

1. The logger showed only a tiny text link ("Watch demo") that opened YouTube in a new tab, or a 200px-wide video for an upload. Easy to miss.
2. The demo was looked up by the exact exercise name. His library holds the same movement several times and the video sits on only one: "Bulgarian Split Squat" and "Bulgarian Split Squats" have no link; "Rear Foot Elevated Split Squat", the barbell and dumbbell versions and "Split Squat" do. 109 of his 208 exercises have a YouTube link, none has an upload.
3. An exercise added or swapped mid-workout, or added with quick-add, was given no demo at all.

## What it does now (no migration)

- **A "Demo" button** under each exercise's title in the logger (and on the pre-workout list, and on the coach's builder card). One tap opens the demo in a sheet that slides up from the bottom: a big 16:9 player (the YouTube no-cookie embed, or the uploaded video), a large Close button, tap outside or Escape also closes. It never plays by itself, and closing it drops the player.
- **Quiet for those who do not want it**: Settings has "Hide exercise demos" for a client. It is kept on that device (no database change), and takes effect at once. A coach building a program always sees the button.
- **Found by what the exercise is** (`lib/exercise-demo.ts`): the exact name first; then any row that is the same exercise written differently (plural, hyphen, word order, abbreviation, from `lib/exercise-normaliser.ts`); then a known second name for the same movement (a Bulgarian split squat is a rear foot elevated split squat). An uploaded video wins over a YouTube link; ties go to the shorter name so the choice never flips. Two different movements that merely share a word never borrow each other's video. When the video came from a differently named row the sheet says so ("Demo: Rear Foot Elevated Split Squat").
- **Mid-workout exercises**: the logger is given the coach's library once, and each card looks its demo up from its current name, so an added, quick-added or swapped exercise has its demo too.

## When duplicates are merged (the exercise catalog build)

The 12 sure merges Ron approved collapse spellings into one row. The rule for that merge: **the surviving row inherits the demo from whichever duplicate has one** (an upload first, then a YouTube link, then the shorter name), so nothing that shows a video today stops showing it. The lookup above already behaves this way before any merge happens, so the merge is not needed for Ron's squat to show its video.

## For the global library later

A shared catalog video carries a `video_credit` (who made it, shown under the player) and a link-health check: a link that stops playing is flagged for the platform admin and the sheet falls back to the next row in the same group before showing "could not be loaded". Not built here.

## Known limits

- The hide setting is per device; the same client on a second phone sees the button until they hide it there too. Making it follow the person needs one column on profiles (a later paste step).
- An exercise newly typed into the coach's builder gets its demo on the next load, not as it is typed.
