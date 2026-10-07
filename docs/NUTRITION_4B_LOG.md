# Nutrition phase 4b: the library-first meal builder

What changed, what to know, and what needs a decision. Built on 4a (Ron's recipe engine, `lib/meal-templates/`).

## What it does

- **Library first.** A day, or a whole week, is built from Ron's 66 recipes and the coach's own saved recipes before any AI is asked. Each meal slot gets up to three options. Fewer than three is **said on the screen** ("2 from the library, 1 to generate"); the Nutrition Spot button fills the rest. A slot with no library recipe at all (a keto or carnivore snack today) shows "0 from the library, 3 to generate".
- **Selection rules** (`lib/library-selection.ts`): every candidate is scaled to the slot's target and skipped if it cannot land inside the tolerance; the client's allergies, intolerances, dislikes and diet are checked **again on what the meal really contains** (its name, every food's name and printed label, the preparation text); favorites first, then foods the client likes, then closeness to the target; "mix it up" moves meals offered recently down (never a favorite); three options with different main proteins where possible.
- **The client's variety setting** drives the week: *mix it up* (anything offered in the last 7 days moves down, the featured meal rotates), *a few favorites on repeat* (last 3 days), *same meals most days* (nothing moves, the same meal is featured).
- **Build the week** (`lib/week-build.ts`): seven days, each meal slot with its options, a **featured** option for the client's card (never the same one two days running; favorites stay among the options every day but are not the featured one while others can be), and no meal twice in one day. It asks before replacing days that already have a plan.
- **The coach's own recipes** are scaled by one factor per role (protein sources together, carb sources together, fat sources together) solved against all three macros at once, kept within 0.4 to 2.5 times their reference grams, rounded to what a person can weigh, and measured from the printed amounts (`lib/library-scaling.ts`). A recipe saved before reference grams existed is scaled the old way and held to the same tolerance.
- **The client's card** (`components/athlete/todays-meal-cards.tsx`): the featured option first with its grams and macros, the others one tap away, **"I ate this"** logs that option's name and its own macros. Eaten meals matched by name (three times in four weeks) become favorites.
- **Save an AI option to the library** (`lib/ai-recipe-save.ts`): no AI call; a verified option becomes a private recipe with tags worked out from its lines, a fingerprint (the same lines saved twice is one recipe), a main protein and reference grams. Every measured line must be matched to a real food (the database also refuses it otherwise).

## Database (one paste, Release K, step 41, migration 0296)

Columns on `recipes` and `recipe_ingredients` only (see `supabase/apply/README.md`). Who can read or write a recipe does not change. The app reads the new columns softly: before the paste the coach's recipes still load (without the new fields) and the builder works; only "Save to my library" needs the paste. **Paste first, then deploy.**

## Decisions and honest limits

1. **Stars are not read.** A client's starred foods are private by design (0286: a coach never sees them). The builder therefore uses what the coach can already see, the meals the client logged as eaten, for favorites. If Ron wants stars to steer the menu, that is a privacy decision to make, not a code change.
2. **The old "low appetite / poor digestion" liquid-meal option is gone from the builder.** It only existed in the old engine's helper (`enableLiquid`) and the library has no liquid recipes yet. It can come back as library recipes.
3. **Food-table numbers are unchanged** (Ron's decisions pending, see the 4a port log). Meals shown to clients use those numbers: the raw-meat protein rows and the rice cake are the known uncorrected ones.
4. **Keto and carnivore snacks have no library recipe**, and pescatarian breakfast only exists on the low-carb shape. The builder falls through to "generate" for those (section 4 of the 4a port log lists every gap).
5. **Carb cycling** builds both a training-day and a rest-day menu for every day of the week (the client sees both, as with a single-day save).
6. A meal's **printed grams are what is measured**, so the macros on the card are the macros of what is on the plate.
