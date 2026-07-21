# Feature 002 — Four Meal Slots per Day with Meal Detail Page

## Status

Approved

## Goal

Replace the one-dinner-per-day planner with four fixed meal slots per day (snídaně, oběd, večeře, svačiny) chosen per week, auto-filled by weighted-random suggestion draw, and edited through a dedicated meal detail page that supports multiple meals per slot. The plan data model becomes composition-ready (a meal entry can hold multiple recipes) so the future mix-and-match feature needs no second migration. Diet rules and rotation judge all planned meals; the shopping list aggregates across all slots.

## Feature definitions

### Data model

- `MealSlotKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'` (ASCII keys; Czech UI labels snídaně / oběd / večeře / svačiny).
- `MealEntry { id: string, recipeIds: string[], source: 'auto' | 'manual' }` — **this feature's UI always creates entries with exactly one recipeId**; the array exists so mix-and-match (idea #2) can compose multiple recipes into one meal later without another migration. `source` records whether auto-fill or the user placed the entry.
- `DayPlan = Record<MealSlotKey, MealEntry[]>` — a slot holds a list of entries (multiple meals per slot, e.g. visitors).
- `WeekPlan { activeSlots: MealSlotKey[], days: Record<IsoDay, DayPlan> }`.
- `Recipe` gains `suitableFor: MealSlotKey[]` — which slots the recipe fits.
- **Composition-ready recipe fields (reserved in 002, no UI until feature 003):**
  - `componentType: 'full' | 'main' | 'side' | 'salad'` — whether the recipe is a complete meal (samostatné jídlo), a main needing accompaniment (hlavní — e.g. marinované kuře), a side (příloha — brambory, hranolky…), or a salad (salát).
  - `pairings: { sides: string[], salads: string[] }` — for mains: recipeIds of the **specific** přílohy and saláty it matches, entered manually; future suggestions use these links to offer complete combinations whose ingredients feed the shopping list.
  - Feature 002 normalizes legacy recipes to `componentType: 'full'`, empty pairings, and persists the fields — the recipe form UI for them arrives in feature 003.

### Migration (no data loss)

- Old shape `WeekPlan { days: Record<IsoDay, recipeId | null> }`: each non-null day becomes one `dinner` entry `{ recipeIds: [recipeId], source: 'manual' }`; `activeSlots: ['dinner']`. Detected and normalized on load (same approach as the pantry migration); written back in the new shape on next save.
- Recipes without `suitableFor` are normalized on load to `['lunch', 'dinner']`; recipes without `componentType`/`pairings` are normalized to `'full'` / empty lists.

### Weekly slot selection

- The plan screen has a **per-week slot toggle** (4 chips). A new week defaults to the previous week's selection (first ever week: večeře only). All four chips may be unticked (a "we're away" week: nothing planned, shopping list holds only extras).
- Day cards show only the week's active slots. Filling an inactive slot means ticking it first (it becomes active for that week; empty active slots are harmless and render as "—").
- **Unticking a slot that already has entries warns and then deletes that slot's entries for the whole week** ("Slot obsahuje jídla — odebrat je?") — the meals leave the plan, the shopping list, and quota counting; there is no hidden-but-counting state. Re-ticking shows the slot empty.
- Skipping a single day's meal (e.g. no oběd on Wednesday only) is done on the **meal detail page** by removing that day's entry — the week chip is for dropping a slot for the whole week.

### Auto-fill ("Doplnit návrhy")

- One action fills **every empty active slot** of the shown week; slots that already have entries are never overwritten.
- Pick logic per slot: **weighted random draw from the existing suggestion ranking** — candidates are ranked exactly as today (sale matches, rotation freshness, unmet-min boost, name) additionally filtered by `suitableFor`; higher-ranked recipes get proportionally higher draw probability. Blocked ingredients, rotation window, and max quotas remain hard exclusions; quota counts update progressively as slots are filled during one auto-fill pass (a "max 2× maso" rule cannot be violated by one pass).
- **Přegenerovat** replaces only entries with `source: 'auto'` (whole week, or single slot from the meal detail page); manual entries are never touched.
- A slot with no eligible recipe stays empty with a hint ("Žádný vhodný recept").

### Meal detail page

- Route per (week, day, slot), e.g. `#/plan/2026-W30/wed/dinner`. Opened by tapping a slot line on the plan screen.
- Shows the slot's meal entries (recipe name, portions, untried badge; link to the recipe detail), each removable.
- **Přidat jídlo**: slot-aware suggestions (same ranking, filtered by `suitableFor`) plus the full searchable picker. Picking a recipe unsuitable for the slot is allowed with a warning ("Recept není označen jako vhodný pro snídani"). Existing blocked/quota/rotation warnings apply as today.
- **Přegenerovat** for this slot only (replaces its auto entries).

### Recipes — "Vhodné pro"

- Recipe form gains a multi-select chip row (4 slots, at least one required; new-recipe default: oběd + večeře). Shown on the recipe detail as chips.

### Rules and derived features across all slots

- **Diet quotas** count categories of every planned meal entry in the week (all slots).
- **Rotation** considers a recipe "cooked" if it appears in any slot of a past week; suggestions hide it within the window regardless of slot.
- **Shopping list** aggregates ingredients from every entry of every slot of the selected week; the same recipe appearing twice contributes twice. Check-state identity (ItemKey) is unchanged.
- Quota summary line and suggestion behavior elsewhere follow automatically from these definitions.

### Concurrency

- Plan operations stay operation-based with **per (week, day, slot, entry) granularity**: adding/removing entries in different slots or days concurrently on two devices must both survive; the sale/pantry/settings semantics are untouched.

## Acceptance criteria

1. Loading a data repo with old-format plans shows them as večeře entries with `activeSlots: ['dinner']`; nothing is lost; the next save persists the new shape; reloading on the second device works.
2. The slot toggle changes which slots day cards show; a new week inherits the previous week's selection; unticking a slot with entries warns and, on confirmation, deletes that slot's entries for the week — they disappear from the shopping list and quota counts. An all-slots-unticked week is valid.
3. Auto-fill fills exactly the empty active slots, never overwrites existing entries, and respects `suitableFor`, blocked ingredients, rotation, and max quotas — including progressively within one pass. Two consecutive rerolls can produce different (valid) fills.
4. Přegenerovat replaces auto-placed entries only; manual entries survive rerolls.
5. The meal detail page lists, adds, and removes entries; a slot can hold two meals; adding an unsuitable or blocked recipe warns but is possible.
6. A recipe marked only snídaně never appears in večeře suggestions or auto-fill; existing recipes behave as oběd + večeře after migration.
7. With "max 2× maso" and maso planned at oběd and večeře on Monday, no further maso is suggested or auto-filled anywhere that week; a recipe cooked in any slot last week is hidden by rotation this week.
8. The shopping list includes ingredients from all slots and multiple entries per slot; check states keep working.
9. Concurrent edits to different day/slot combinations on two devices both survive via the conflict-merge path.
10. All logic is unit-tested (migration, slot filtering, weighted draw, progressive quotas, ops merges); full suite, lint, and build green.

## Out of scope

- Mix-and-match UI (feature 003): the recipe-form fields for component type and pairing selection, pairing-aware suggestions, and composing main + příloha + salát on the meal detail page. Feature 002 only reserves and persists the model fields above.
- Snack rotation for the shopping list; pantry-driven plan weighting; portion scaling; the preference survey.
- Per-day slot activation (slots activate per week, not per day).
- Any changes to sales, pantry, settings, or storage architecture.

## Libraries / dependencies

None new. Weighted random uses `Math.random()` in app code (injectable RNG for tests, same pattern as the injectable `idFn`/`now`).

## Open questions

None — the weighting curve (how steeply rank translates to draw probability) is an implementation detail settled in the plan with tests; all user-facing decisions were resolved in Phase 1 (2026-07-21): per-week toggle, weighted-random auto-fill, model-only composition readiness, `suitableFor` multi-select with oběd+večeře legacy default, rules across all slots.

Resolved during spec review (2026-07-21): mix-and-match pairing is **manual, per recipe, linking specific recipes** — a main (e.g. marinované kuře) lists the concrete přílohy and saláty it matches, in two separate lists. Feature 002 reserves `componentType` + `pairings` in the model; feature 003 builds the UI and pairing-aware suggestions.

Resolved during plan review (2026-07-21):

- Auto-fill never places the same recipe twice in one week; leftovers (same meal in two slots) are added manually on the meal detail page.
- Unticking a slot deletes its entries for the week (no hidden-but-counting meals); all four chips may be unticked.
