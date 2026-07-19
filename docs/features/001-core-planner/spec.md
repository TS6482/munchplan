# Feature 001 — Core Meal Planner

## Status

Approved

## Goal

MunchPlan is a phone-first web app (Czech UI) for a two-person Czech household that makes Sunday meal planning fast instead of frustrating. The couple picks the week's dinners together from their own recipe collection, guided by app suggestions that respect per-person dislikes/allergies, diet-style rules, effort/time tags, rotation, and a manually maintained "currently on sale" ingredient list. The app aggregates ingredients from the chosen meals, subtracts what the pantry already holds, and produces a shopping list with sale items marked.

Architecture mirrors Dražgrešle: React + TypeScript + Vite, deployed to GitHub Pages, data stored as JSON files in a shared private GitHub data repo via the Contents API with per-device personal access tokens — so both phones see the same recipes, plan, pantry, and lists.

Automated discount fetching from kupi.cz / rohlik.cz is **not** part of this feature; a later feature (002) may automate filling the sale list, but the app never depends on scraping to work.

## Feature definitions

### Recipes

- CRUD for recipes. Fields:
  - **Name** (required)
  - **Ingredients** (required): list of `{ name, amount?, unit? }` — amount/unit optional (e.g. "sůl" without amount)
  - **Category tag** (one of, extensible): `maso`, `ryba`, `vege`, `těstoviny`, `polévka`, `jiné`
  - **Effort tag**: `rychlé` (weeknight-friendly) / `normální` / `náročné`
  - **Source** (optional): free text or URL (e.g. Instagram link)
  - **Notes / steps** (optional free text)
- **"Vyzkoušet" (try-someday) inbox:** a recipe can be flagged as untried. Untried recipes live in a separate inbox view, can be quickly added via a minimal form (name + source is enough; ingredients can be filled in later), and are promoted to the main collection once tried. A recipe (tried or untried) **must have at least one ingredient before it can be assigned to a weekly plan** — this keeps the shopping list always complete.

### Preferences and restrictions (settings)

- Two persons, each with a **blocked-ingredients list** (dislikes/allergies). Recipes containing a blocked ingredient are excluded from suggestions but remain manually selectable (shown with a warning).
- **Diet-style rules:** weekly quotas over category tags, e.g. "max 2× maso", "min 1× ryba". Rules are user-editable (tag + min/max per week). Suggestions steer toward fulfilling unmet quotas and warn when a pick would exceed a max.
- **Rotation window:** "don't suggest a meal cooked in the last N weeks" (default 2, configurable). Based on past weekly plans.

### Sale list ("Aktuální slevy")

- A simple editable list of ingredient names currently on sale, entered manually each week (optionally with a note, e.g. shop or price).
- Items can be cleared individually or all at once ("nový týden").

### Weekly plan

- Planning is per calendar week (Monday–Sunday), one **dinner** slot per day; days may stay empty.
- The app shows the current and next week; planning typically targets next week.
- **Suggestions panel:** ranked list of recipes to consider, ordered by:
  1. discount coverage — how many of the recipe's ingredients match the sale list,
  2. rotation — recipes not cooked within the rotation window rank higher; recipes inside the window are hidden from suggestions,
  3. diet rules — recipes helping unmet `min` quotas get boosted; recipes that would break a `max` quota are excluded from suggestions,
  4. blocked ingredients — excluded from suggestions.
- Untried ("vyzkoušet") recipes that have ingredients **are included** in suggestions, visibly marked "nevyzkoušené".
- Any recipe can also be assigned to a day directly from the collection (search/browse), bypassing suggestions — warnings shown where relevant.

### Shopping list

- Generated from the selected week's plan: all ingredients across chosen recipes, **merged by normalized name** (amounts summed when units match; listed separately otherwise).
- Items whose name matches a **pantry** entry are moved to a collapsed "doma máme" section (not deleted — they can be moved back if the pantry is wrong).
- Items matching the **sale list** are visually marked.
- Items are checkable while shopping; manual extra items can be added (things outside the plan — drogerie, snídaně…).
- Check states and extras are **scoped to the plan week** — each week's shopping list starts fresh; within a week they persist, and the recipe-derived part regenerates when the plan changes without losing check states of unchanged items.

### Pantry ("Spíž")

- A list of ingredient names the household has at home. No quantities — an item is either present or not.
- First run seeds the pantry with a default list of standard Czech-household staples (sůl, pepř, cukr, hladká mouka, polohrubá mouka, rýže, těstoviny, brambory, cibule, česnek, slunečnicový olej, olivový olej, máslo, vejce, mléko, ocet, hořčice, kečup, sójová omáčka, sladká paprika, kmín, majoránka, bobkový list, vegeta). Fully editable afterwards.

### Ingredient name matching

Used for shopping-list merging, pantry subtraction, and sale-list matching:

- Normalization: lowercase, trimmed, diacritics-insensitive.
- Shopping-list merging and pantry subtraction: **exact match** on normalized names.
- Sale-list matching: **substring match** in either direction on normalized names ("kuřecí" on sale matches ingredient "kuřecí stehna").
- Blocked-ingredient matching: **substring match** — a blocked term excludes any ingredient whose normalized name contains it ("houby" also blocks "sušené houby"). Safer for allergies; occasional over-blocking is visible and acceptable.

### Storage and sharing

- Data lives as JSON files in a **separate private GitHub repo**, read/written through the GitHub Contents API, following the Dražgrešle pattern: per-file SHA compare-and-swap, conflict refetch-and-merge, schema versioning.
- Each device configures owner/repo + its own personal access token in settings; both partners point at the same data repo.
- **Offline fallback:** the app caches the last-loaded data snapshot in localStorage; when fetches fail (no signal in the supermarket), it shows the cached data with an offline banner so the shopping list is always viewable.
- Files (top-level of data repo): `recipes.json`, `plans.json` (single file — decades of weekly plans stay small), `pantry.json`, `sales.json`, `settings.json`, `extras.json` (shopping-list extras + check states).

### UI

- **Czech UI**, phone-first (~390 px), stretches on desktop; light + dark via `prefers-color-scheme`; design-token CSS following the Dražgrešle tokens approach.
- App name displayed: **MunchPlan**.

## Acceptance criteria

1. A recipe with name, ingredients, category, and effort tag can be created, edited, and deleted; changes persist to the data repo and appear on a second device after reload.
2. A minimal try-someday recipe (name + source only) can be added in under ~15 seconds of interaction and later completed and promoted to the collection.
3. With "houby" blocked for person A, no suggestion contains houby; a recipe with houby can still be manually planned and shows a warning.
4. With rule "max 2× maso" and two maso dinners already planned, no further maso recipe is suggested and manually adding one shows a warning; with "min 1× ryba" unmet, ryba recipes rank above equally-scored others.
5. A recipe cooked within the rotation window does not appear in suggestions; it reappears once the window has passed.
6. With "kuřecí" on the sale list, recipes containing any "kuřecí…" ingredient rank above recipes with no sale matches, and the suggestion shows which ingredients matched.
7. Selecting recipes for a week produces a shopping list where duplicate ingredients are merged (200 g + 300 g mouka → 500 g mouka), pantry items sit in a collapsed "doma máme" section, and sale items are marked.
8. Checking off items and adding extra items survives app reload and plan edits that don't touch those items.
9. Two devices editing different files concurrently both succeed; editing the same file concurrently resolves via the conflict-merge path without silent data loss.
10. All app logic (suggestion ranking, merging, matching, quota evaluation) is covered by unit tests; `npm run build` (tsc + vite) and the full Vitest suite pass.

## Out of scope

- Automated scraping/fetching of discounts from kupi.cz or rohlik.cz (possible Feature 002).
- Automated Instagram import (manual entry instead).
- Native mobile app; AI-generated recipe ideas; ordering/cart integration with rohlik.cz; nutrition tracking.
- Meals other than dinner (design must not preclude adding lunch/breakfast slots later).
- Quantities in the pantry; expiry tracking.
- Multi-household support, accounts, or any backend beyond the GitHub data repo.

## Libraries / dependencies

| Dependency | Why |
| --- | --- |
| React 18 + TypeScript + Vite | Same stack as Dražgrešle; proven for GitHub Pages SPA |
| Zustand | Lightweight state store, same as Dražgrešle |
| Vitest | Unit tests, same as Dražgrešle |
| ESLint (typescript-eslint, react-hooks) | Lint parity with Dražgrešle |
| CSS Modules + design tokens | No CSS framework; phone-first tokens file |
| GitHub Contents API (no SDK, plain fetch) | Data persistence, following the existing pattern |

No component library, no chart library, no backend, no AI dependencies.

## Open questions

None — all resolved with the user (2026-07-19):

- Plan history: single `plans.json`; revisit only if it ever grows problematic.
- Sale-list substring over-matching accepted; matched ingredients are shown, no exact-match toggle.
- Recipes without ingredients cannot be planned.
- Rotation window default: 2 weeks.
- Czech-staples seed list approved as specified.

Resolved during plan review (2026-07-19):

- Blocked-ingredient matching is substring, not exact (allergy safety).
- Shopping-list check states are per plan week, not global.
- Offline cached-snapshot fallback is in scope.
- Untried recipes with ingredients are included in suggestions, marked "nevyzkoušené".
