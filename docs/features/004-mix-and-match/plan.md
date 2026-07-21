# Feature 004 — Mix-and-Match Meal Components: Implementation Plan

## Overview

Gives the reserved composition model (`componentType`, `pairings`, persisted and normalized since feature 002) its behavior and UI: the recipe form gains "Typ receptu" and pairing multi-selects; ranked suggestions and auto-fill place complete meals (one entry `recipeIds: [main, příloha]`); bare sides/salads and unpaired mains are excluded from ranking but stay freely pickable; the meal detail page composes and adjusts combinations through a new conflict-safe `setEntryRecipes` op.

Every step follows TDD (red → green → refactor) and ends in exactly one conventional commit. Conventions carried over from features 001–003: pure logic in `src/engine/` (no React, no store, injectable `rng`/`idFn`/`now`); operation-based conflict merges in `src/store/ops.ts` (`apply(op, remote)` re-application — deletions stick, no unions); Vitest node env — all behavior in `.ts` modules, components stay thin over `*Logic.ts` view-models; Czech UI labels, ASCII keys; global `.btn`/`.select`/`.segmented`/`.glass` classes; `makeRecipe`/`weekPlanWith` fixtures from `src/testing/fixtures.ts`; gate each step on suite + `npm run lint` + `npm run build` (Vitest alone does not type-check).

Branch: `feature/004-mix-and-match`. Baseline: 522 tests green. **No data migration is needed** — `componentType` and `pairings` already exist on every recipe (feature 002 step 1 normalization), and multi-recipe `MealEntry.recipeIds` has been supported by the plan model, ops, shopping aggregation, and entry rendering since 002.

## Design decisions settled in this plan

Pinned here so implementation never re-litigates them.

1. **Quota vs. rotation semantics for composed entries — the spec contradiction, resolved.** Spec line: "Rotation, quotas, and the no-recipe-twice rule judge the **main** … the příloha choice itself is not rotation/quota constrained." But today `plannedCategories` counts **all** `recipeIds` of every entry (pinned in 002 step 5), so a composed side's category would consume quota. **Resolution: `plannedCategories` counts only each entry's FIRST recipe — the meal's identity; rotation and `assignedRecipeIds` keep counting all recipeIds.** Justification: diet quotas are about *meals eaten* (the main course defines what the meal "is"); rotation is about *what was cooked*. This **overrides the 002 step-5 pin** — the affected `suggest.test.ts` assertions are updated, not deleted, in step 3, with a comment referencing this decision. Legacy single-recipe entries are unaffected (first = only).
2. **Entry composition invariant: `recipeIds[0]` is the primary (meal identity).** Composed entries are ordered `[main, side, salad?]`; the primary determines quota category, composition controls (swap/salad offered only when `recipeIds[0]` resolves to a `main`), and "removing the main removes the whole entry". Swapping a side replaces it in place; a salad appends; component removal filters. Documented on `MealEntry` in `src/types/index.ts`. An entry whose first recipe is deleted shows the existing "smazaný recept" fallback and offers no composition controls.
3. **"Valid paired side" definition (used by eligibility, auto-compose, and the hint):** a `pairings.sides` id whose recipe (a) exists, (b) still has `componentType: 'side'` (a recipe later re-marked `full` must not be silently auto-attached), and (c) is not blocked for either person. `pairedSides(main, recipes)` = (a)+(b) only, for UI listings; `validPairedSides(main, recipes, settings)` = (a)+(b)+(c), for ranking eligibility and `pickPairedSide`. Salads analogously (`pairedSalads`), minus the blocked filter for listing (blocked salads are flagged, not hidden — manual picks warn, never block). Documented asymmetry: the composed side is NOT filtered by the slot's `suitableFor` (the main is slot-filtered; the side is an accompaniment — consistent with sides being exempt from rotation/quota).
4. **Unpaired-main hint: a new `Warning` kind `{ kind: 'unpairedMain' }`, not a reuse of `unsuitable`.** Flows through the existing `warningsFor` → `czechWarnings` → picker pipeline, Czech text "Recept nemá přiřazené přílohy". Emitted only for `componentType: 'main'` with `validPairedSides(...).length === 0` — the same predicate as the ranking exclusion, so hint and exclusion can never disagree. Sides/salads get **no** new warning kind (spec: freely pickable, no warning). The planned-entry hint on the meal detail page (with edit link) is separate view-model output in `mealDetailLogic` reusing the same predicate.
5. **The picker never composes (user decision 2026-07-26).** The suggestion "Přidat" path composes via `newPlannedEntry(recipeId, recipes, sales, settings, rng, idFn)` (delegating to `composeEntry`); the full picker's `onSelect` places exactly `[recipeId]` via the existing `newManualEntry` — the deliberate bare-main path. Two add paths, one line each; `newManualEntry` stays (not deprecated).
6. **Composition badge is derived, not stored on `Suggestion`.** `suggestionView` derives `compositionBadge: 'hlavní + příloha'` from `recipe.componentType === 'main'` (eligibility guarantees every ranked main will actually be composed).
7. **Switching Typ receptu away from `main` keeps stored pairings, hidden.** Keeping is harmless (pairings are only ever *read* for mains), preserves data when the user toggles back. Likewise, stale pairing ids are *kept* in stored data and merely skipped at use time: `fromRecipe` round-trips the full stored `pairings` arrays, the chip list renders only current pool members, save writes values as-is — pinned by a round-trip test.
8. **`setEntryRecipes(week, day, slot, entryId, recipeIds)` merge semantics:** finds the entry by id in exactly that (week, day, slot); **missing week or missing entry → no-op** (concurrent remote `removeMealEntry`/`clearDaySlot` sticks — no resurrection); replaces that entry's `recipeIds` wholesale (LWW in save-serialization order on the single entry, preserving position, `id`, **and `source`** — per user decision 2026-07-26 a customized auto entry stays `auto` and "Přegenerovat" replaces it; listed on the Phase 8 validation checklist as known behavior); other entries/slots untouched. The UI never issues it with empty `recipeIds` (removing the primary goes through `removeMealEntry`); the op does not special-case `[]`. Conflict matrix pinned in step 4.
9. **`pickPairedSide(main, recipes, sales, settings, rng)` draw rule:** filter to `validPairedSides`; partition into sale-matched (≥1 ingredient matching any sale item via `saleMatch`) and the rest; if the sale group is non-empty draw **uniformly** within it, else uniformly among all valid sides (`Math.floor(rng() * n)` — uniform, *not* harmonic: sides have no ranking); empty valid set → `null`. One `rng` call, made **after** `pickWeighted`'s call in an auto-fill pass — call order pinned by deterministic-sequence tests.
10. **Module layout:** new pure `src/engine/composition.ts` owns `pairedSides` / `pairedSalads` / `validPairedSides` / `pickPairedSide` / `composeEntry` / `isBlockedForAnyone` (the latter *moves* from `suggest.ts`; import direction `suggest → composition → match`, no cycle). Czech component-type labels live in new `src/components/componentTypeLabels.ts`: samostatné jídlo / hlavní jídlo / příloha / salát.
11. **Rollout: benign.** Stored data shape unchanged; a device on the 003 build renders composed entries as joined names and all its ops still merge. No simultaneous-update requirement; noted in README anyway.

## Steps

### Step 1 — Composition engine helpers: `pairedSides`, `validPairedSides`, `pickPairedSide`

**Commit:** `feat: add composition engine helpers for paired sides and salads`

**Tests first:**

- `src/engine/composition.test.ts` (new): `pairedSides(main, recipes)` — resolves `pairings.sides` ids in stored order; skips deleted ids; skips a referent whose `componentType` is no longer `'side'`; empty pairings → `[]`; dedupes duplicated ids (keep first); filters a main listing its own id. `pairedSalads` analogously. `validPairedSides(main, recipes, settings)` — additionally excludes sides blocked for either person; all blocked/deleted → `[]`. `pickPairedSide` — sale-matched group preferred regardless of rng; uniform within group (rng 0 → first, just-under-1 → last, boundary at k/n pinned); no sale matches → uniform over all valid; no valid sides → `null`; exactly one rng call (spy). `isBlockedForAnyone` re-pinned after the move (`suggest.test.ts` untouched and green proves the refactor).

**Files:**

- `src/engine/composition.ts` (new), `src/engine/composition.test.ts` (new), `src/engine/suggest.ts` (delete private `isBlockedForAnyone`, import from `composition`).

**Risks / edge cases:**

- Self-referencing and duplicated pairing ids pinned as above.

### Step 2 — Ranking eligibility + unpaired-main hint

**Commit:** `feat: exclude bare components and unpaired mains from ranked suggestions`

**Tests first:**

- `src/engine/suggest.test.ts` (extend): `side`/`salad` never in `rankSuggestions` output (even with sale matches/never cooked/suitable slot); `main` with ≥1 valid side appears; `main` with zero pairings / only-deleted / only-type-changed / only-blocked pairings excluded (four fixtures); `full` untouched (AC7 guard). `warningsFor`: `{ kind: 'unpairedMain' }` appended **last** (after `unsuitable`) for a main with no valid sides; not emitted for paired main / full / side / salad; sides/salads produce no new warning (explicit kinds assertion).
- `src/features/plan/planLogic.test.ts` (extend): `czechWarnings` renders unpairedMain as "Recept nemá přiřazené přílohy"; `pickerEntries` for a side recipe carries no composition warning and stays selectable (AC5).

**Files:**

- `src/engine/suggest.ts` (eligibility filter via `validPairedSides`; new `Warning` member), `src/features/plan/planLogic.ts` (`czechWarnings` case), both test files.

**Risks / edge cases:**

- `warningsFor` runs for every picker recipe — must tolerate garbage pairing ids without throwing.
- Auto-fill inherits exclusions for free; composed placement comes in step 5 (interim: paired mains land single-recipe — acceptable, no broken state).

### Step 3 — Quota counts the primary recipe; rotation counts all (semantics pin)

**Commit:** `feat: count diet quotas by each entry's primary recipe only`

**Tests first:**

- `src/engine/planModel.test.ts` (extend): new `weekPrimaryRecipeIds(weekPlan)` — first recipeId of every entry, duplicates preserved, empty-`recipeIds` entries skipped defensively; `weekRecipeIds` unchanged (re-pin).
- `src/engine/suggest.test.ts` (update + extend): `plannedCategories` with `[masoMain, sideX]` yields only `maso` (002-era assertion **rewritten** with a comment citing decision 1); `max 2× maso` consumed by two composed maso mains but not their sides; `min 1× vege` NOT satisfied by a planned vege side (spurious-satisfaction guard); two separate single-recipe entries still count both.
- `src/engine/rotation.test.ts` (extend): a side cooked last week inside a composed entry has `weeksSinceCooked = 1`; the main cooked last week with side A is rotation-hidden regardless of prospective side (AC6).

**Files:**

- `src/engine/planModel.ts` (`weekPrimaryRecipeIds`; update `weekRecipeIds`'s doc comment — quota no longer uses it), `src/engine/suggest.ts` (`plannedCategories` iterates first ids; rewrite its doc comment which currently documents per-recipe multiplicity), `src/testing/fixtures.ts` (**extend `weekPlanWith`/`dinnerWeek` to accept `recipeId: string | string[]`** — first composed-entry fixtures appear here and feed steps 5/7/10), tests above.

**Risks / edge cases:**

- Deliberately overrides a 002 pin — note in the commit body. `assignedRecipeIds` stays on all ids (side "assigned" has zero effect since sides never rank — assert once). Land before step 5 so composed placements don't consume quota with side categories mid-pass.

### Step 4 — `setEntryRecipes` op + store action

**Commit:** `feat: add conflict-safe setEntryRecipes plan op`

**Tests first:**

- `src/store/ops.test.ts` (extend): replaces exactly that entry's `recipeIds`, preserving `id`/`source`/position; other entries/slots/days/weeks untouched; idempotent; no-op on missing week / missing entry / after remote `clearDaySlot` (no resurrection); concurrent `setEntryRecipes` on different entries both survive; same entry → later op wins wholesale; re-applied over a remote `addMealEntry` keeps the remote's entry; `applyPlansOp` on legacy-shape remote normalizes first.
- `src/store/data.test.ts` (extend): `setEntryRecipes` action routes to `mutate('plans', ...)`.

**Files:**

- `src/store/ops.ts`, `src/store/data.ts`, both test files.

**Risks / edge cases:**

- Mirror `removeMealEntry`'s missing-week guard (return normalized plans). Op carries full target `recipeIds` fixed at construction time — never compute inside `apply`.

### Step 5 — Auto-fill composes `[main, side]` entries

**Commit:** `feat: auto-compose main with paired side in auto-fill placements`

**Tests first:**

- `src/engine/autoFill.test.ts` (extend): ranked `main` → placement entry `[mainId, sideId]` via `pickPairedSide` (seeded rng pins the side; sale-matched side wins — AC3); `full` still `[fullId]`; rng call order pinned (`pickWeighted` then `pickPairedSide` per composed target; fixed sequence reproduces the pass byte-identically); composed entry participates in the progressive simulation — main's category consumes quota for later targets, side's does not (step 3 semantics end-to-end); the same side may appear in two meals in one pass (sides not no-twice-constrained — pin); `composeEntry` fallback: null side → `[mainId]` alone (tested directly on `composeEntry`).
- Variety regression: two rng sequences → different valid composed fills.
- **`composeEntry` on a `full` recipe makes ZERO rng calls** (spy) — this is what keeps step 10's AC7 byte-identical claim true for all-`full` collections.

**Files:**

- `src/engine/composition.ts` (+`composeEntry(recipe, recipes, sales, settings, rng, idFn)` — gates on `componentType === 'main'` BEFORE touching rng), `src/engine/autoFill.ts` (compose on placement via `composeEntry`), test files.

**Risks / edge cases:**

- The simulated `workingWeek` must append the FULL composed entry (both ids). Do not consult rotation/quota/assigned for the side pick.

### Step 6 — Recipe form: Typ receptu + pairing multi-selects; detail chips

**Commit:** `feat: add typ receptu and pairing selection to recipe form and detail`

**Tests first:**

- `src/features/recipes/recipeFormLogic.test.ts` (extend): `FormValues` gains `componentType` + `pairings`; **`emptyForm` moves from RecipeForm.tsx into recipeFormLogic.ts as an export** (so the `'full'` + empty-pairings default is pinned on production code, not a test-local copy; RecipeForm consumes it); `RecipeDraft` gains both fields and **`validateQuickAdd` explicitly emits `componentType: 'full'` + empty pairings** (compile ripple made explicit); quick-add stays `full` (assert once); `validateFullForm` passes both through (no new validation errors — an unpaired main is valid); `toRecipe` create AND edit write them from the draft (the edit path's `...existing` no longer preserves them — this is the feature); `fromRecipe` round-trips both **including stale pairing ids** (decision 7 pin); `togglePairing(current, id)` helper; `pairingPools(recipes, editedId)` → `{ sides, salads }` filtered by type, Czech-sorted, excluding the edited recipe; empty-pool hint flags ("Zatím žádné přílohy — označ recepty jako příloha" / salát variant); `filterPool(pool, query)` normalized-substring filter.
- `src/components/componentTypeLabels.test.ts` (new): the four Czech labels.
- `pairingChips(recipe, recipes)` in recipeFormLogic (names of existing paired sides/salads, stale skipped) — tested; detail renders "Přílohy: X, Y" / "Saláty: Z" from it, hidden when empty or not a main.

**Files:**

- `src/features/recipes/recipeFormLogic.ts`, `RecipeForm.tsx` (`.select` Typ receptu; conditional pairing chip-list sections only when `main`, values kept in state when hidden; filter input shown when pool > 8), `RecipeDetailPage.tsx` (type chip when not `full`; pairing lines), `src/components/componentTypeLabels.ts` (new), test files.

**Risks / edge cases:**

- Saving with hidden stale ids must not drop them (full arrays in FormValues, round-trip pinned). Persist/sync via existing `upsertRecipe` LWW (AC1). No reusable search component — a plain filter input.

### Step 7 — Meal detail composition view-model

**Commit:** `feat: add composition view-model to meal detail logic`

**Tests first:**

- `src/features/plan/mealDetailLogic.test.ts` (extend):
  - `EntryRow` gains `components: ComponentRow[]` — per recipeId: name (deleted fallback), Czech role label (role of the recipe, not position), removal action: index 0 → `{ kind: 'entry' }` (removeMealEntry — removing the main removes the entry), others → `{ kind: 'component', nextRecipeIds }` (precomputed for setEntryRecipes). Single-recipe entries: one component, removal `{ kind: 'entry' }`.
  - **Component classification rule (pinned — review MAJOR 2):** non-primary components are classified by their RESOLVED recipe's current `componentType`; a component that doesn't resolve (deleted) or resolves to neither `side` nor `salad` (re-typed) is **opaque** — it renders with the deleted/name fallback, gets no role label, and its per-component ✕ is the escape hatch. `swapSide` replaces the first non-primary component classified `side`; if none exists, it replaces the first OPAQUE non-primary component (positional fallback per the `[main, side, salad?]` invariant); if none of those either, it appends. `addSalad` counts only components classified `salad` (an opaque component never suppresses the offer; a second salad is possible only via stale data — accepted). Fixtures: entry with deleted side, entry with re-typed side — both behaviors pinned.
  - `swapSide(entry, recipes)` — only when `recipeIds[0]` is a `main` AND `pairedSides` non-empty: options = pairedSides (blocked ones flagged but selectable), current marked (stale current → none marked), each option carrying `nextRecipeIds` (per the classification rule above; acts as "add side" when nothing replaceable). Two side components → replaces the FIRST (pin).
  - `addSalad(entry, recipes)` — only when primary is main, `pairedSalads` non-empty, and no salad-classified component present; one-tap options with `nextRecipeIds` (appended).
  - `unpairedMainHint(entry, recipes, settings)` — primary is main with zero valid sides; carries edit-link routeHash; text "Recept nemá přiřazené přílohy".
  - `newPlannedEntry(recipeId, recipes, sales, settings, rng, idFn)` — delegates to `composeEntry`: paired main → `[main, side]` manual entry; else single-recipe. Deleted primary → no controls, no hint (pin).

**Files:**

- `src/features/plan/mealDetailLogic.ts` + test.

### Step 8 — Meal detail page UI wiring

**Commit:** `feat: render meal composition controls on meal detail page`

- Thin wiring (logic landed in step 7): component rows with per-component ✕ (index 0 → removeMealEntry; others → setEntryRecipes with precomputed arrays), "Vyměnit přílohu" overlay (reuse RecipePicker overlay/glass pattern), "Přidat salát" one-tap row, unpaired hint with edit link. **Two add paths (decision 5): the suggestion "Přidat" uses `newPlannedEntry` (composes); the picker's `onSelect` keeps `newManualEntry` (bare)** — Math.random/crypto.randomUUID only as injected defaults here. One op per gesture (AC4). Czech copy per spec. The unpairedMain line renders via the existing warning pipeline (⚠ styling accepted — it is informational).

**Files:**

- `src/features/plan/MealDetailPage.tsx`, `MealDetailPage.module.css`.

### Step 9 — Suggestion rows: composition badge

**Commit:** `feat: show composition badge on suggestion rows`

**Tests first:**

- `src/features/plan/planLogic.test.ts`: `SuggestionView.compositionBadge` — `'hlavní + příloha'` for mains, `null` otherwise; sale/fresh texts unchanged on the same fixture.

**Files:**

- `src/features/plan/planLogic.ts`, `MealDetailPage.tsx` (render badge), test.

### Step 10 — Cross-cutting hardening: stale pairings, shopping list, conflict paths

**Commit:** `test: harden composition against stale pairings and concurrent edits`

**Tests first (test-dominant):**

- `src/engine/shoppingList.test.ts`: composed `[main, side]` contributes both recipes' ingredients (AC2); swapping the side (via `applyPlansOp(setEntryRecipes(...))`) swaps contributed ingredients; ItemKey stability untouched.
- Stale-pairing sweep, one fixture (deleted id + type-changed id + valid id) through every consumer: `rankSuggestions`, `pickPairedSide`, `pairingChips`, `pairingPools`/`fromRecipe` round-trip, `mealDetailLogic` swap options — none throw.
- `src/store/ops.test.ts`: AC4 concurrency — A swaps entry 1's side while B adds entry 2 to the same slot / edits another day / clears another slot: both effects survive either order; A swaps while B removes the same entry → removal sticks.
- `src/store/data.test.ts`: `setEntryRecipes` conflict-retry through `saveWithRetry` (existing harness).
- AC7 regression: an all-`full` collection produces identical `rankSuggestions`/`buildAutoFill` results as before the feature.

**Files:**

- Test files; engine/store only where a pinned case fails.

### Step 11 — Finalization: cleanup, docs, full gate

**Commit:** `chore: finalize mix-and-match feature docs and cleanup`

- Full gate + grep sweep (no stray randomness; `newManualEntry` removed if orphaned — check callers first).
- `README.md`: composition summary; benign-rollout note.
- Spec Status → Done (Phase 9).
- Smoke checklist (Phase 8, both phones): mark + pair recipes, chips on detail (AC1); auto-fill places composed entries, never bare sides/unpaired mains, shopping list carries both (AC2); sale-matched side preferred (AC3); swap/add/remove while the other device edits elsewhere (AC4); picker: side freely, PAIRED MAIN LANDS BARE (deliberate), unpaired main with hint (AC5); rotation ignores side changes (AC6); all-`full` household unchanged (AC7); **known behavior to confirm consciously: "Přegenerovat" replaces auto meals even after you customized their composition** (user decision).

## Acceptance criteria → steps map

| AC | Steps |
| --- | --- |
| 1. Form + pairings + chips, persist/sync | 6 |
| 2. No bare side/salad or unpaired main auto-filled; composed entry on shopping list | 2, 5, 10 |
| 3. Side respects blocked, prefers sale, deterministic | 1, 5 |
| 4. Swap/add/remove = one conflict-safe entry update | 4, 7, 8, 10 |
| 5. Sides/salads pickable no warning; unpaired mains with hint | 2, 8 |
| 6. Rotation/quota judge the main | 3 |
| 7. Legacy all-`full` unchanged; no migration | 2, 3, 10 |
| 8. Logic unit-tested; suite/lint/build green | all; gated in 11 |

## Cross-cutting risks

- **Stale pairing ids are the pervasive hazard** — one shared gatekeeper (`pairedSides`/`validPairedSides`); step 10's sweep proves no consumer bypasses it.
- **Overriding a 002 pin** (`plannedCategories` multiplicity) is deliberate and documented; rewritten assertions cite decision 1.
- **Determinism:** two rng consumers interleave in a pass; call order pinned; randomness injected everywhere.
- **RecipePicker pool intentionally unchanged** (all recipes, warn-don't-block).
- **No migration, benign rollout**: ops are never persisted, only resulting JSON — mixed-version devices interoperate.
- **Vitest node env:** overlay/chip interactions land on the Phase 8 manual list.
