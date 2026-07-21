# Feature 002 — Four Meal Slots per Day: Implementation Plan

## Overview

Replaces the one-dinner-per-day plan model with four fixed meal slots per day (snídaně / oběd / večeře / svačiny), per-week slot activation, weighted-random auto-fill, a meal detail page per (week, day, slot), and composition-ready recipe fields. All rules (rotation, quotas, suggestions, shopping list) judge every entry of every slot.

Every step follows TDD (red → green → refactor) and ends in exactly one conventional commit. Conventions carried over from feature 001: pure logic in `src/engine/` (no React, no fetch, no store imports); operation-based conflict merges in `src/store/ops.ts` (`apply(op, remote)` re-application — deletions stick, no unions); data-shape migrations by normalization on load with the cache path also normalized (the `normalizePantry` precedent); injectable `now`/`idFn`/RNG (no raw `Date.now`/`Math.random` in logic); Vitest node env — tests import only `.ts`, components stay thin over `*Logic.ts` view-models; Czech UI labels, ASCII keys and route slugs; global `.btn`/`.select`/`.segmented`/`.glass` utility classes.

Branch: `feature/002-meal-slots`. Baseline: 369 tests green.

## Data model summary (established in steps 1 and 3, consumed everywhere)

- `MealSlotKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'`; display order `SLOT_ORDER = [breakfast, lunch, dinner, snack]`; Czech labels snídaně / oběd / večeře / svačiny (plus an accusative map for warning copy: "pro snídani / pro oběd / pro večeři / pro svačinu").
- `MealEntry { id: string, recipeIds: string[], source: 'auto' | 'manual' }` — this feature's UI always creates entries with exactly one recipeId; the array is reserved for feature 003 (mix-and-match).
- `DayPlan = Record<MealSlotKey, MealEntry[]>`; `WeekPlan { activeSlots: MealSlotKey[], days: Record<IsoDay, DayPlan> }`; `Plans = Record<WeekKey, WeekPlan>` unchanged.
- `Recipe` gains `suitableFor: MealSlotKey[]`, `componentType: 'full' | 'main' | 'side' | 'salad'`, `pairings: { sides: string[], salads: string[] }` (componentType/pairings persisted but no UI until 003).
- `ItemKey`, `Extras`, `Settings`, `SaleItem`, `Pantry`, the `{ schemaVersion: 1, data }` envelope: **unchanged**. `schemaVersion` stays 1 (decision below).

## Design decisions settled in this plan

These were the open design points; they are pinned here so implementation never re-litigates them.

1. **Exact `PlansOp` set** (per-(week, day, slot, entry) merge granularity):
   - `activateSlot(week, slot)` — adds the slot to `activeSlots` (idempotent). Creates the week if missing. Per-slot ops (not a whole-array LWW `setActiveSlots`) so concurrent toggles of *different* slots on two devices merge cleanly.
   - `deactivateSlot(week, slot)` — removes the slot from `activeSlots` **and deletes that slot's entries across all seven days** (user decision 2026-07-21: unticked meals leave the plan, the shopping list, and quota counts — no hidden-but-counting state). Re-applied on a conflict, the deletion sticks.
   - `addMealEntry(week, day, slot, entry: MealEntry)` — appends the entry; **idempotent by `entry.id`** (an entry with the same id already in that slot is replaced, not duplicated — makes conflict re-apply and retry safe). Creates a missing week with `activeSlots: [slot]`.
   - `removeMealEntry(week, day, slot, entryId)` — filters by id; re-applied on a remote that lacks the id → no-op; deletion sticks (no resurrection).
   - `replaceAutoEntries(week, placements: { day, slot, entries: MealEntry[] }[])` — for each targeted slot: keep `source: 'manual'` entries, drop `source: 'auto'` entries, append the op's entries. **One op = one PUT for a whole auto-fill or reroll pass** (never 28 sequential commits). The op carries fully materialized entries (ids fixed at op-construction time via `idFn`), so re-apply is deterministic. Creates a missing week with `activeSlots` = union of targeted slots. **Pinned semantics for empty results:** in reroll mode every targeted slot appears in `placements`, with `entries: []` when nothing is eligible (stale autos are cleared, the "Žádný vhodný recept" hint is then truthful); in fill mode slots with no eligible candidate are simply omitted. A pass producing zero placements issues **no op at all** (no pointless PUT/commit).
   - Merge semantics under conflict: concurrent ops on different (week, day, slot) trivially both survive (per-slot arrays); concurrent `addMealEntry` on the *same* slot → both entries kept (a slot is a list — this is a feature); concurrent `removeMealEntry` + `addMealEntry` in the same slot → both effects survive; concurrent auto-fills on both devices → the re-applied `replaceAutoEntries` replaces the remote's auto entries in the targeted slots (no doubled auto meals) while remote *manual* entries always survive — all pinned by tests in step 3.
   - Both auto-fill ("fill empty slots") and reroll write through `replaceAutoEntries`; they differ only in which targets the engine selects (see step 6). Fill-empty targets slots that are empty locally; if a remote concurrently manually filled one, re-apply keeps the manual entry *and* adds the auto one — documented, harmless (removable on the detail page).
   - `assignDay` is **deleted**, not kept alongside.
2. **How `apply()` handles an old-shape remote — normalize *inside* apply, and also on load and cache hydrate.** `saveWithRetry`'s conflict path calls `apply(op, remoteData)` with raw refetched JSON; during rollout the remote can still be old-shape (or *mixed* — see risk section). Therefore `applyPlansOp` begins with `data = normalizePlans(data)` and `applyRecipesOp` begins with `data = normalizeRecipes(data)`. Load (`loadAll`) and cache hydrate (`hydrateFromCache`) also normalize (generalizing today's `key === 'pantry'` special case into an optional per-file `normalize` function on the `FILES` registry). Three ingress points, one normalizer each — the in-memory store and every written file are always new-shape.
3. **`normalizePlans` handles per-day mixed shapes.** Old shape is detected per **day value**, not per file: a `string` day value → one dinner `MealEntry { recipeIds: [id], source: 'manual' }`; `null` → empty slots; an object → validated `DayPlan` (missing slot keys → `[]`, malformed entries dropped). **A week missing `activeSlots` derives it as the union of slots that contain entries, falling back to `['dinner']`** — for a pure legacy week that union is `['dinner']` anyway, and after an old-device `assignDay` write (which wholesale-drops `activeSlots`, see risk section) this restores visibility of surviving breakfast/lunch/snack entries instead of hiding them. This tolerates an old device writing an `assignDay` string into an already-migrated week.
4. **Deterministic legacy entry ids.** Migrated old-shape entries get id `legacy-{week}-{day}` (e.g. `legacy-2026-W30-wed`) — *not* `idFn()`. Both devices normalizing the same old file independently produce byte-identical entries, so the id-idempotent `addMealEntry`/merge path can never duplicate a migrated meal. All other entry ids come from injectable `idFn` (default `crypto.randomUUID`).
5. **Weighting curve: harmonic.** Draw weight of the candidate at rank *i* (0-based) in the existing lexicographic ranking is `1 / (i + 1)`. Strong top bias, non-zero long tail, no tuning constants; pinned by cumulative-boundary tests with an injected RNG.
6. **`activeSlots` lifecycle.** Stored `activeSlots` is the single source of truth for what renders. Deactivation deletes the slot's entries (decision 1), so inactive slots hold entries only transiently (old-device writes; absorbed by decision 3's union derivation). An **empty `activeSlots` is valid** (a "we're away" week: no day-card lines, auto-fill computes zero targets and issues no op, shopping list holds only extras). Display default for a week not yet stored: the nearest *earlier* stored week's `activeSlots` (compared via `mondayOf`, never string sort), else `['dinner']` — computed by a pure `defaultActiveSlots(plans, week)`. The UI persists the default via `activateSlot` ops on first interaction with a not-yet-stored week, so op-level week-creation fallbacks rarely fire.
7. **`schemaVersion` stays 1.** Bumping it would make the not-yet-updated partner's device throw `SchemaError` and hard-lock them out mid-rollout. Normalization-on-read is chosen instead; the residual old-app-writes-old-ops risk is documented (risk section) and mitigated by updating both devices at the same time.
8. **The week-level `SuggestionsPanel` on PlanPage is removed.** Its "assign to first empty day" action is meaningless with slots; auto-fill plus the slot-aware suggestions on the meal detail page supersede it. `RecipePicker` survives, reused by the meal detail page.
9. **`menuLogic` changes: yes, one line.** The `mealDetail` route joins the plan/recipes family that shows "Nový recept" in the ⋯ menu (the natural moment to notice a recipe is missing). Pinned by a test.

## Steps

### Step 1 — Recipe model: `suitableFor`, `componentType`, `pairings` + normalization

**Commit:** `feat: add recipe slot suitability and composition fields with normalization`

**Tests first:**

- `src/store/ops.test.ts` (extend): `normalizeRecipes(unknown)` — legacy recipe without the new fields → `suitableFor: ['lunch','dinner']`, `componentType: 'full'`, `pairings: { sides: [], salads: [] }`; recipe already carrying the fields passes through unchanged; invalid values (`suitableFor: []` or non-slot strings → default; unknown componentType → `'full'`; pairings missing one list → that list `[]`); non-array input → `[]`. `applyRecipesOp` on a legacy-shape remote array normalizes it first, so the merged result is fully new-shape (the conflict-refetch path, decision 2).
- `src/store/data.test.ts` (extend): `loadAll` with a legacy `recipes.json` payload → store state carries normalized recipes and the cache is written normalized; cache-hydrate path (`NetworkError` fallback) normalizes too.

**Files:**

- `src/types/index.ts` — add `MealSlotKey`, `ComponentType`, `Pairings`; extend `Recipe` (all three fields required in TS — normalization guarantees presence at every ingress). `MealSlotKey` lands here now so step 2 can use it before the plan-shape change.
- `src/features/recipes/recipeFormLogic.ts` — **`toRecipe`'s create path must set the three defaults** (`['lunch','dinner']`, `'full'`, empty pairings) or step 1 does not compile (it is the only non-test `Recipe` constructor); the edit path already compiles via `...existing`. Form UI/validation still waits for step 2.
- `src/store/ops.ts` — `normalizeRecipes`; `applyRecipesOp` normalizes its `data` argument first. Mixed `suitableFor` arrays (`['lunch','bogus']`) keep the valid subset (`['lunch']`); only fully-empty/invalid results fall back to the default.
- `src/store/data.ts` — generalize the registry: `AnyFileEntry` gains optional `normalize: (raw: unknown) => unknown`; `loadAll`/`hydrateFromCache` use it (pantry's existing special case moves into the registry; recipes registered now, plans in step 3).
- Existing recipe fixtures in `src/engine/suggest.test.ts`, `src/engine/shoppingList.test.ts`, `src/features/**` tests — introduce `makeRecipe(overrides)` in a new `src/testing/fixtures.ts` and migrate fixtures to it, so step 3's churn is one-line-per-fixture.

**Risks / edge cases:**

- Making the fields required in TS breaks every inline `Recipe` literal at compile time — that is the point; the `makeRecipe` helper contains the churn. Vitest transpiles without type-checking, so run `npm run build` (tsc) as part of the step gate, not just the suite.
- `suitableFor: []` must normalize to the default, not stay empty — an empty list would silently make a recipe unsuggestable everywhere.
- Do not touch `componentType`/`pairings` semantics beyond persistence (out of scope until 003).

### Step 2 — Recipe form + detail: "Vhodné pro" chips

**Commit:** `feat: add vhodne pro slot selection to recipe form and detail`

**Tests first:**

- `src/features/recipes/recipeFormLogic.test.ts` (extend): `FormValues` gains `suitableFor: MealSlotKey[]`; `validateFullForm` rejects empty selection with Czech error ("Vyberte alespoň jeden typ jídla"); new-recipe default is `['lunch','dinner']`; `validateQuickAdd` recipes default to `['lunch','dinner']`; `toRecipe` on create sets `componentType: 'full'` + empty `pairings`, on edit preserves the existing recipe's `componentType`/`pairings` and updates `suitableFor` from the form; `fromRecipe` round-trips `suitableFor`; `toggleSlotSelection(current, slot)` pure chip-toggle helper (toggling to empty allowed in form state, validation rejects on submit).
- Placement decision: `SLOT_ORDER` lives in `src/types/index.ts` (data order); Czech label maps (`SLOT_LABELS`, `SLOT_ACCUSATIVE`) live in `src/components/slotLabels.ts` (shared by recipes, plan, meal detail) — tested here.

**Files:**

- `src/features/recipes/recipeFormLogic.ts`, `src/features/recipes/RecipeForm.tsx` (chip row of 4, `.segmented`-style multi-select), `src/features/recipes/RecipeDetailPage.tsx` (read-only chips), `src/components/slotLabels.ts`, `src/types/index.ts` (`SLOT_ORDER`).

**Risks / edge cases:**

- Editing a legacy recipe must not silently rewrite `componentType`/`pairings` — the `...existing` spread in `toRecipe` already preserves them; pin with a test.
- Quick-add stays a ~15 s flow: no chips on the quick form, defaults applied in `validateQuickAdd`.
- AC6 first half starts here (a snídaně-only recipe is *markable*); enforcement lands in steps 5–6.

### Step 3 — Plan model flag-day: types, `normalizePlans`, new `PlansOp` set, store wiring, mechanical consumer migration

**Commit:** `feat: replace day-recipe plan model with meal-slot entry model`

This is the deliberately meaty migration step (a shared-type change cannot compile half-done). Everything here is either new pure code with fresh tests, or a *mechanical* consumer update whose existing semantic assertions are preserved through a fixture helper.

**Tests first:**

- `src/engine/planModel.test.ts` (new): `emptyDayPlan()` / `emptyWeekPlan(activeSlots)`; `entriesOfDay(dayPlan)`; `weekRecipeIds(weekPlan)` (every recipeId of every entry of every slot, duplicates preserved); `slotIsEmpty(weekPlan, day, slot)`.
- `src/store/ops.test.ts` (rewrite plans section): `normalizePlans` — old-shape week (`days: { wed: 'r1', thu: null, … }`) → dinner entries with **deterministic ids `legacy-{week}-{day}`**, `activeSlots: ['dinner']`, all other slots `[]`; already-new-shape week passes through; missing `activeSlots` on an object week derives the union of slots-with-entries (decision 3); **mixed week** (object days + one string day, as written by an old device post-migration) normalizes per day; malformed entries dropped; non-object → `{}`. The five new ops (decision 1), each including its conflict-merge re-apply cases: add vs. concurrent add same slot (both kept), same id twice (idempotent, one entry), remove sticks against a remote that re-added other entries, `activateSlot`/`deactivateSlot` — concurrent toggles of different slots both survive, deactivation deletes the slot's entries and sticks on re-apply, `replaceAutoEntries` preserves remote manual entries and replaces remote auto entries in targeted slots (incl. `entries: []` clearing), week-creation fallbacks, **`applyPlansOp` on a raw old-shape remote normalizes before applying** (decision 2).
- `src/store/data.test.ts` (extend/migrate): store actions `activateSlot`/`deactivateSlot`/`addMealEntry`/`removeMealEntry`/`replaceAutoEntries` route to `mutate('plans', …)`; `assignDay` removed; existing `assignDay`-based tests rewritten onto `addMealEntry`.
- Migrated fixtures: `src/testing/fixtures.ts` gains `weekPlanWith(entries)` / `dinnerWeek({ wed: 'r1', … })` (builds new-shape weeks with manual dinner entries) so `rotation.test.ts`, `suggest.test.ts`, `shoppingList.test.ts`, `planLogic.test.ts` keep their *semantic* assertions with one-line fixture swaps.

**Files:**

- `src/types/index.ts` (`MealEntry`, `DayPlan`, new `WeekPlan`), `src/engine/planModel.ts` (pure helpers above), `src/store/ops.ts` (delete `assignDay`/old `applyPlansOp`; add `normalizePlans` + the five ops), `src/store/data.ts` (registry `normalize` for plans; new actions; drop `assignDay`), mechanical consumer updates so the build compiles and behavior is preserved on the migrated fixtures: `src/engine/rotation.ts` (`lastCookedWeek` iterates `weekRecipeIds`), `src/engine/suggest.ts` (`plannedCategories` counts every entry's every recipeId — duplicates count twice; `assignedRecipeIds` across all slots), `src/engine/shoppingList.ts` (`collectOccurrences` iterates days → slots → entries → recipeIds), `src/features/plan/planLogic.ts` + `PlanPage.tsx` — **interim wiring, pinned:** `dayRows` renders the dinner slot's entries; the picker/suggestion assign paths call `addMealEntry(week, day, 'dinner', newManualEntry(recipeId, idFn))`; the ✕ button calls `removeMealEntry` for the day's first dinner entry; `SuggestionsPanel` stays wired this way until step 10 removes it — plus all migrated test files.

**Risks / edge cases:**

- **The riskiest step of the feature.** Mitigations: all new behavior enters through `planModel.ts`/`normalizePlans`/ops with fresh tests; consumers change only their iteration layer; the fixture helper keeps 001's semantic assertions intact (a failing old test here means a real regression, not fixture noise). Gate on suite + lint + `npm run build`.
- `normalizePlans` must never throw on garbage (a corrupt day/entry is dropped, not fatal) — the load path has no other guard.
- `replaceAutoEntries` ordering: manual entries keep their relative order, new auto entries append after them — pin it (UI stability).
- Duplicated recipeIds across the week must *not* be deduplicated by `weekRecipeIds` (quota counting and shopping both need multiplicity) — but `assignedRecipeIds` (a `Set`) still dedupes for the already-planned suggestion exclusion.

### Step 4 — Migration and concurrency hardening (integration tests)

**Commit:** `test: harden plan migration across load, cache, and conflict paths`

**Tests first (this step is test-dominant by design; any code it flushes out is a fix, not a feature):**

- `src/store/data.test.ts` (extend): full old-shape `plans.json` through `loadAll` → state is new-shape, non-null days are večeře entries, nothing lost (AC1); the next mutation persists the new shape (assert the PUT body via mocked API); cache written normalized; airplane-mode hydrate from an *old-shape cached snapshot* → normalized (the cache-path half of AC1 — an updated app's first offline start after the update still has the old snapshot); conflict retry where the refetched remote is old-shape → merged write is new-shape and the local op survives; **two-device double migration**: device A and B both normalize the same old file, A saves, B conflicts and re-applies → no duplicated meals (deterministic `legacy-*` ids, decision 4).
- `src/store/ops.test.ts` (extend): the AC9 matrix — concurrent ops on (same week, different day), (same day, different slot), (same slot, different entries) all both-survive; remove-vs-add interleavings.

**Files:**

- `src/store/data.test.ts`, `src/store/ops.test.ts`; fixes in `src/store/ops.ts`/`data.ts` if any scenario fails.

**Risks / edge cases:**

- The old-cached-snapshot case is easy to forget and is exactly the "migration correctness on both load AND cache paths" cross-cutting risk — it gets an explicit fixture here.
- These tests are the contract the rollout depends on; do not weaken them to pass.

### Step 5 — Slot-aware suggestions + all-slot rules pinning

**Commit:** `feat: add slot-aware suggestion filtering across all meal slots`

**Tests first:**

- `src/engine/suggest.test.ts` (extend): `RankSuggestionsInput` gains optional `slot?: MealSlotKey`; with `slot` given, recipes whose `suitableFor` lacks it are excluded (AC6: snídaně-only recipe never in večeře suggestions); without `slot`, no suitability filter (used by pickers listing everything). New `Warning` kind `{ kind: 'unsuitable', slot }` from `warningsFor` when a slot is given and the recipe doesn't fit (AC5 warning path). Multi-slot fixtures: maso at oběd *and* večeře on Monday consumes "max 2× maso" for the whole week (AC7 first half); a recipe planned in *any* slot of the target week is excluded; a recipe cooked in any slot last week is rotation-hidden this week regardless of slot (AC7 second half).
- `src/engine/rotation.test.ts` (extend): cross-slot `lastCookedWeek` (cooked as a snack last week hides it for dinner this week); multi-recipe entry (both recipeIds count as cooked — composition-readiness).
- `src/engine/quota.test.ts`: unchanged (it takes category lists); the multiplicity behavior is pinned via `plannedCategories` tests in suggest.

**Files:**

- `src/engine/suggest.ts` (slot filter + `unsuitable` warning), `src/engine/suggest.test.ts`, `src/engine/rotation.test.ts`.

**Risks / edge cases:**

- The suitability filter is a hard *exclusion* in ranked suggestions but only a *warning* in `warningsFor` (manual picks stay allowed) — same pattern as blocked ingredients today; don't conflate.
- `plannedCategories` multiplicity: one entry with `recipeIds: [a, b]` contributes both categories — pin now so 003 inherits it.

### Step 6 — Weighted-random auto-fill engine

**Commit:** `feat: add weighted random auto-fill engine`

**Tests first:**

- `src/engine/autoFill.test.ts` (new):
  - `pickWeighted(rankedLength, rng)` → index: harmonic weights `1/(i+1)` (decision 5); `rng: () => 0` → index 0; rng just under 1 → last index; cumulative boundary fixtures for 3 candidates (weights 1, ½, ⅓: thresholds at 6/11 and 9/11 of the total — pinned exactly); empty list → null.
  - `buildAutoFill({ recipes, plans, sales, settings, week, activeSlots, targets, rng, idFn })` → `{ placements, emptySlots }`:
    - **Fill mode** targets every (day, slot) with `slot ∈ activeSlots` and an empty entry list, in day-major order (mon→sun × `SLOT_ORDER`); occupied slots never targeted (AC3).
    - **Reroll mode** (whole week or a single (day, slot)) targets slots containing ≥1 `source: 'auto'` entry, **restricted to `activeSlots`**; the simulation baseline first strips those auto entries (so their categories/ids don't block their own replacements); manual entries stay in the baseline and keep consuming quotas (AC4). Every targeted slot appears in the result — `entries: []` when nothing is eligible (stale autos cleared, decision 1); tested.
    - **Zero targets** (empty `activeSlots`, or nothing empty/auto) → empty placements; the caller issues no op; tested.
    - Each pick re-ranks via `rankSuggestions` with the simulated plan including all picks made earlier in the pass → **progressive quota consumption** (fixture: "max 2× maso", rng forced to prefer maso → third maso is never placed) and no recipe twice in one week; `suitableFor`, blocked, rotation respected (they come free from `rankSuggestions`).
    - No eligible candidate → `emptySlots` includes `{ day, slot }` and the pass continues (AC3 hint "Žádný vhodný recept").
    - Placements carry ready `MealEntry`s (`source: 'auto'`, id from `idFn`), shaped exactly as `replaceAutoEntries` input; deterministic given (rng, idFn); two different rng sequences → different valid fills (AC3 reroll variety).

**Files:**

- `src/engine/autoFill.ts`, `src/engine/autoFill.test.ts`.

**Risks / edge cases:**

- Rebuilding a simulated `Plans` per pick is O(slots × recipes log recipes) — trivial at this scale; prefer the simple reuse of `rankSuggestions` over an incremental-state micro-optimization.
- The engine only *computes*; it never writes. The single `replaceAutoEntries` op is issued by the UI layer (steps 9–10) — keeps the one-PUT-per-pass property.
- Floating-point cumulative sums: compare with `<` against running totals, never equality; the boundary tests pin behavior.

### Step 7 — Shopping list aggregation across slots and entries

**Commit:** `feat: aggregate shopping list across all meal slots and entries`

**Tests first:**

- `src/engine/shoppingList.test.ts` (extend; the mechanical iteration landed in step 3 — this pins AC8): ingredients from entries in different slots of the same day all appear; two entries of the same recipe in one week (any slots) contribute its ingredients **twice** (400 g mouka from 2 × 200 g); a multi-recipe entry contributes each recipe's ingredients; deleted recipeId inside an entry skipped silently; `ItemKey`s for unchanged ingredients are byte-identical to pre-migration keys (checks survive the model change — fixture asserts a known key string like `mouka|g`); check state re-attaches after adding a second entry to a slot.
- `src/features/shopping/shoppingLogic.test.ts` (extend): `shoppingView` over a multi-slot week; no API change expected.

**Files:**

- `src/engine/shoppingList.test.ts`, `src/features/shopping/shoppingLogic.test.ts`; `src/engine/shoppingList.ts` only if a pinned case fails.

**Risks / edge cases:**

- `ItemKey` stability is the cross-cutting contract: keys derive from ingredient name + unit only — the plan-model change must be provably invisible to `extras.json`. The literal-key fixture is the guard.
- `fromRecipes` display list still dedupes names while amounts multiply — assert both on the same fixture so they can't be conflated.

### Step 8 — Meal detail route + menu

**Commit:** `feat: add meal detail route and menu entry`

**Tests first:**

- `src/router/router.test.ts` (extend): `parseRoute('#/plan/2026-W30/wed/dinner')` → `{ name: 'mealDetail', week: '2026-W30', day: 'wed', slot: 'dinner' }`; **`#/plan/2026-W30` → `{ name: 'plan', week: '2026-W30' }` (optional week segment — back-navigation keeps the viewed week)**; validation — malformed week (`2026-W3`, `abc`), unknown day, unknown slot, missing segments → fall back to `{ name: 'plan' }`; `#/plan` alone still → plan (no week); `routeHash` round-trips both.
- `src/components/menuLogic.test.ts` (extend): `menuItemsFor({ name: 'mealDetail', … })` includes "Nový recept" + "Nastavení" (decision 9).

**Files:**

- `src/router/router.ts` (Route union + parse + hash; validate against `ISO_DAYS` and `SLOT_ORDER`), `src/components/menuLogic.ts`, both test files.

**Risks / edge cases:**

- Route slugs stay ASCII (`dinner`, not `večeře`) per the 001 percent-encoding lesson.
- Week segment must be validated by shape only, not existence — a stale link to an empty week renders an empty (valid) detail page, never a crash.

### Step 9 — Meal detail page

**Commit:** `feat: add meal detail page with slot suggestions and reroll`

**Tests first:**

- `src/features/plan/mealDetailLogic.test.ts` (new, pure view-model):
  - Header data: Czech day + date + slot label from (week, day, slot).
  - `entryRows(weekPlan, day, slot, recipes)`: per entry — id, display name (multi-recipe entries join names with " + "), per-recipe links, untried badge, portions text, deleted-recipe fallback ("smazaný recept"); each row removable → `removeMealEntry(week, day, slot, entryId)` args.
  - Add flow: slot-aware suggestions (`rankSuggestions` with `slot`); `pickerEntries` gains the slot → warnings include the Czech unsuitable line built from `SLOT_ACCUSATIVE` ("Recept není označen jako vhodný pro snídani") alongside existing blocked/quota/rotation warnings; picking still allowed (AC5); `newManualEntry(recipeId, idFn)` → `{ id, recipeIds: [recipeId], source: 'manual' }`.
  - A slot holding two entries renders two rows (AC5).
  - Reroll-this-slot: builds `buildAutoFill` reroll targets `[{ day, slot }]` and maps placements to `replaceAutoEntries` input; slot with only manual entries → no-op with Czech notice.
- Store wiring assertions (mocked API): add/remove round-trip through `mutate('plans', …)`.

**Files:**

- `src/features/plan/mealDetailLogic.ts`, `MealDetailPage.tsx` + `.module.css`, `czechWarnings` extension in `planLogic.ts` (or a shared warning-text helper), `RecipePicker.tsx` (accept optional slot, pass through), `App.tsx` route wiring.

**Risks / edge cases:**

- Deep-linking a week/slot with no stored week must render an empty list + "Přidat jídlo", not crash (`plans[week]` undefined path).
- Adding to an *inactive* slot from a stale deep link: allowed; the UI also issues `activateSlot` for it (decision 6) so the new meal is visible on the plan screen.
- **Navigation pinned:** the Plán tab highlights for `mealDetail` routes too (App.tsx `isActive`); the page has an explicit back link targeting `#/plan/{week}` — the plan route gains an optional week segment (`#/plan` and `#/plan/2026-W30` both valid, parsed in step 8) so returning from a meal keeps the week you were planning instead of resetting to "Příští týden".
- `Math.random`/`crypto.randomUUID` appear only in the thin component layer as injected defaults — logic stays deterministic.

### Step 10 — PlanPage rework: slot chips, day cards, auto-fill / reroll

**Commit:** `feat: rework plan screen with slot chips, day cards, and auto-fill`

**Tests first:**

- `src/features/plan/planLogic.test.ts` (rework):
  - `defaultActiveSlots(plans, week)`: stored week wins; else nearest earlier stored week by `mondayOf` (fixture crossing a year boundary); else `['dinner']` (AC2 inheritance, first-ever-week default).
  - `toggleSlotResult(weekPlan|undefined, slot)` → `{ op: 'activate' | 'deactivate', needsConfirm, entryCount }`; unticking a slot with entries → `needsConfirm: true` with Czech copy "Slot obsahuje jídla — odebrat je?"; confirming issues `deactivateSlot` (entries deleted for the week, leaving shopping list and quotas — AC2); unticking an empty slot needs no confirm; all four slots may end unticked (valid empty week).
  - `dayCards(week, plans, recipes, activeSlots)`: 7 cards, only active slots as lines in `SLOT_ORDER`; per line — entry summaries (joined names, untried badge), "—" when empty, mealDetail route target; hidden-slot entries absent from the card but intact in data.
  - Auto-fill wiring: "Doplnit návrhy" → `buildAutoFill` fill mode over the shown week's active slots → one `replaceAutoEntries` op; empty result slots map to transient "Žádný vhodný recept" hints keyed by (day, slot); "Přegenerovat" (shown when any auto entry exists in the week) → reroll mode, manual entries untouched (AC3, AC4).
  - Quota summary line over all-slot `plannedCategories`.
  - First-touch persistence: interacting with a not-yet-stored week issues `activateSlot` ops for `defaultActiveSlots(...)` before/with the first entry op (decision 6).
  - PlanPage week selection seeds from the route's optional week segment when present (back-navigation from mealDetail), else the current/next toggle default.

**Files:**

- `src/features/plan/planLogic.ts` (rework), `PlanPage.tsx` + `PlanPage.module.css` (chips row above the segmented week toggle; day cards; two action buttons; `window.confirm` for the untick warning), delete `SuggestionsPanel.tsx` + its import (decision 8), `src/features/plan/planLogic.test.ts`.

**Risks / edge cases:**

- The "Žádný vhodný recept" hint is transient UI state (component `useState`), never persisted — an empty slot after reload is just "—".
- Reroll button visibility depends on auto entries existing in the *shown* week — derive from data, don't track separately.
- Two rapid auto-fill taps: the per-file mutation queue serializes them; the second pass sees the first's entries and finds no empty slots — no double fill. Note in code comment; cover the queue interaction in a data.test if cheap.
- Deleting `SuggestionsPanel` orphans `suggestionView` in planLogic — remove it (and its tests) only if the meal detail page doesn't reuse it; check before deleting (surgical-changes rule).

### Step 11 — Finalization: cleanup, docs, full gate

**Commit:** `chore: finalize meal slots feature docs and cleanup`

**Tests first:**

- No new units; the gate is the full suite + `npm run lint` + `npm run build` green (AC10), plus a grep-sweep: no remaining references to `assignDay`, old `WeekPlan['days']` string indexing, or raw `Math.random`/`Date.now` in `src/engine/` and `*Logic.ts`.

**Files:**

- `README.md` — rollout note: **update both devices at (or near) the same time**; what the migration does; that a not-yet-updated device shows migrated meals as "smazaný recept" and its ✕ deletes them (git history of the data repo = last-resort recovery); the four-slot behavior summary.
- `docs/features/002-meal-slots/spec.md` — Status: In Progress → (Done in Phase 9).
- Dead-code sweep of anything steps 3–10 orphaned.

**Smoke checklist (manual, both phones — feeds the Phase 8 validation report):**

1. Open the updated app against the existing data repo → old dinners appear as večeře entries, chip row shows only večeře; edit anything; reload on device B → new shape intact (AC1).
2. Toggle snídaně on; next week inherits the selection; untick a slot holding a meal → warning, on confirm the meals disappear from the plan AND the shopping list; untick all four chips → valid empty week (AC2).
3. Mark one recipe snídaně-only → never offered for večeře (AC6). "Doplnit návrhy" fills exactly the empty active slots; reroll twice → different valid fills; manual entries survive (AC3, AC4).
4. Set "max 2× maso", plan maso at Monday oběd + večeře → no maso suggested or auto-filled anywhere that week; last week's meal (any slot) hidden by rotation (AC7).
5. Meal detail: add two meals to one slot, remove one, add an unsuitable and a blocked recipe (warned but allowed) (AC5).
6. Shopping list shows ingredients from all slots, doubled recipe doubles amounts, existing checks still work (AC8).
7. A edits Monday oběd while B edits Wednesday večeře near-simultaneously → both survive (AC9).

## Acceptance criteria → steps map

| AC | Steps |
| --- | --- |
| 1. Old plans load as večeře entries, next save persists new shape, second device ok | 3, 4 (smoke: 11) |
| 2. Slot toggle, previous-week inheritance, untick warns then deletes the slot's week entries | 3, 10 |
| 3. Auto-fill fills only empty active slots; respects suitableFor/blocked/rotation/max, progressively; rerolls vary | 5, 6, 10 |
| 4. Přegenerovat replaces auto entries only | 6, 9, 10 |
| 5. Meal detail lists/adds/removes; two meals per slot; unsuitable/blocked warned but possible | 5, 9 |
| 6. snídaně-only recipe never in večeře suggestions; legacy recipes behave as oběd + večeře | 1, 2, 5, 6 |
| 7. Cross-slot max quota and rotation | 3, 5, 6 |
| 8. Shopping list across all slots and entries; check states keep working | 3, 7 |
| 9. Concurrent (day, slot) edits both survive | 3, 4 |
| 10. All logic unit-tested; suite, lint, build green | every step; gated in 11 |

## Cross-cutting risks

- **Migration has three ingress points** — `loadAll` fetch, cache hydrate (including an *old snapshot cached before the app update*), and `apply(op, remoteRefetch)` inside `saveWithRetry`. All three normalize (decisions 2–3); steps 3–4 pin each with its own test. Missing any one of them corrupts state exactly once, on the least-tested path.
- **Rollout concurrency (old device writes old shape).** With `schemaVersion` kept at 1 (decision 7), a not-yet-updated device can still read the new file and write `assignDay` string values into migrated weeks. Honest extent (verified against the old code): (a) an old-device write overwrites that day's slot entries wholesale AND drops the week's `activeSlots` (old `applyPlansOp` rebuilds `{days}` only) — decision 3's union derivation restores visibility of surviving entries; (b) worse, the **old UI renders every migrated day as "smazaný recept" with a working ✕ button**, actively inviting the not-yet-updated partner to "clean up" — each tap destroys that day's entries. Bounded, not fully preventable: **both partners must update at (or near) the same time**; the README and the Phase 8 validation report must say what the old app shows and that the data repo's git history is the last-resort recovery.
- **Deterministic legacy entry ids** (`legacy-{week}-{day}`) — defense-in-depth and test determinism, not the primary duplication guard: merges re-apply *ops* onto the refetched remote and never union entry lists, so double migration cannot duplicate meals regardless of ids. The deterministic ids additionally make the two-device migration test byte-stable. Every *new* entry id comes from injectable `idFn`, fixed at op-construction time so conflict re-application never regenerates ids.
- **`ItemKey` stability**: the plan-model change must be invisible to `extras.json`; step 7 pins literal key strings. Any drift silently orphans every stored check.
- **Step 3 is a flag-day** (shared-type change): mitigated by the `planModel` helper layer, fixture helpers preserving 001's semantic assertions, and gating each step on `npm run build` (Vitest alone does not type-check).
- **One PUT per auto-fill pass** via the compound `replaceAutoEntries` op — never per-slot mutations (each write is a Git commit and a queue turn); the engine computes, the UI issues exactly one op.
- **Vitest node env** (001 parity): all new behavior lives in `planModel`/`autoFill`/ops/`mealDetailLogic`/`planLogic`; the residual untested surface (chip rendering, confirm dialogs, navigation taps) is listed under "Needs user validation" in Phase 8.
