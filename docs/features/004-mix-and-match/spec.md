# Feature 004 — Mix-and-Match Meal Components

## Status

Done

## Goal

Give the reserved composition model (feature 002: `componentType`, `pairings`) its UI and behavior: recipes can be marked as samostatné jídlo / hlavní / příloha / salát; mains manually declare which specific přílohy and saláty they match; suggestions and auto-fill place **complete meals** (main + paired příloha as one entry); the meal detail page composes and adjusts combinations. Multiplies meal variety without writing a full recipe per combination.

## Feature definitions

### Recipe form ("Typ receptu" + pairings)

- New field on the full recipe form: **Typ receptu** — select with Czech labels: samostatné jídlo (`full`, default), hlavní jídlo (`main`), příloha (`side`), salát (`salad`).
- When `main` is selected, two pairing sections appear:
  - **Přílohy** — multi-select from recipes with `componentType: 'side'` (checkbox/chip list, Czech-sorted, searchable if long).
  - **Saláty** — multi-select from recipes with `componentType: 'salad'`.
- Pairing lists store recipeIds (`pairings.sides` / `pairings.salads`); shown as chips on the recipe detail page. Deleted/missing referenced recipes are skipped everywhere at use time (never crash, never resurrect).
- Quick-add is untouched (inbox recipes default to `full`).

### Suggestions and auto-fill (composition rules — user decisions 2026-07-26)

- **Eligibility for ranked suggestions and auto-fill:**
  - `full` recipes — as today.
  - `main` recipes — eligible **only when they have ≥1 valid paired příloha**; unpaired mains are excluded from ranking/auto-fill (still freely plannable via the picker, with a hint).
  - `side` / `salad` recipes — **never ranked/auto-filled standalone**; freely plannable via the picker anytime (no warning).
- **Auto-compose applies to ranked placements only** (auto-fill and the detail page's suggestion "Přidat"): placing a ranked `main` creates ONE entry `recipeIds: [main, příloha]`. **The full picker ("Vybrat ze všech receptů") always places exactly the tapped recipe alone** — the deliberate path for planning a bare main (e.g. rice already at home); a příloha can be attached afterwards on the detail page. (Resolved 2026-07-26.) The příloha is drawn from the main's paired sides, filtered to exclude blocked-ingredient sides and deleted ids, **preferring sides with sale-matched ingredients** (sale-matching group first, uniform random within group; injectable RNG).
  - A main whose paired sides ALL fail the filters is treated as unpaired (excluded from ranking).
- **Salát is never auto-included** — the meal detail page offers the main's paired saláty as a one-tap add.
- Rotation, quotas, and the no-recipe-twice rule judge the **main** (and any composed components count as cooked for rotation once planned, as today via entry recipeIds); the příloha choice itself is not rotation/quota constrained.

### Meal detail page (composition UI)

- Entry rows for multi-recipe entries list each component with its role and a per-component **✕** (removing the main removes the whole entry; removing a component keeps the rest).
- Entries whose first recipe is a `main` offer:
  - **Vyměnit přílohu** — pick from the main's paired sides (current one marked).
  - **Přidat salát** — one-tap list of the main's paired saláty (hidden when none or one already present).
- A planned unpaired main shows the hint "Recept nemá přiřazené přílohy" with a link to edit the recipe.
- New conflict-safe op `setEntryRecipes(week, day, slot, entryId, recipeIds)` — replaces one entry's composition (idempotent by entry id; last-write-wins on that single entry; other entries/slots unaffected). **Composition edits do not change the entry's `source`** — a customized auto-filled meal is still replaced by "Přegenerovat" (resolved 2026-07-26; surfaced in the validation checklist so it's a known behavior, not a surprise).

### Suggestion display

- Suggestion rows for mains show a composition badge (e.g. "hlavní + příloha") so it's clear a complete meal will be placed; sale/freshness texts unchanged (computed from the main).

## Acceptance criteria

1. A recipe can be marked hlavní/příloha/salát on the form; mains can select specific přílohy and saláty from correctly filtered lists; chips show on the detail page; edits persist and sync.
2. Auto-fill never places a bare příloha/salát and never places an unpaired main; a paired main lands as one entry main + příloha with both recipes' ingredients on the shopping list.
3. The composed příloha respects blocked ingredients and prefers sale-matched sides (deterministic under injected RNG).
4. On the meal detail page: swap příloha, add/remove salát, remove a component — each syncs as one entry update and survives the conflict-merge path (concurrent edits to other entries/slots unaffected).
5. Sides/salads are freely plannable via the picker with no warning; unpaired mains are plannable via the picker with a hint.
6. Rotation/quota count the main (and planned components once placed); the same main with a different příloha is still "the same meal" for rotation.
7. Legacy recipes (all `full`) behave exactly as today; no data migration is needed (fields already exist).
8. All logic unit-tested; full suite, lint, build green.

## Out of scope

- Auto-including saláty; pre-built compatibility databases; pairing suggestions ("this side would fit"); reverse pairing entry on side/salad forms; nutrition balancing.
- Any change to slots, shopping aggregation mechanics, sales, or pantry.

## Libraries / dependencies

None new.

## Open questions

None — resolved with the user (2026-07-26): auto-compose main + příloha; salát manual one-tap; unpaired mains excluded from auto-fill; sides/salads freely plannable manually while auto-fill always pairs.
