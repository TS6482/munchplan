# Feature 001 — Core Meal Planner: Implementation Plan

## Overview

Greenfield build of MunchPlan mirroring the Dražgrešle architecture: React 18 + TypeScript (strict) + Vite, Zustand, Vitest (node env), ESLint flat config, CSS Modules + design tokens, custom hash router, GitHub Contents API persistence, GitHub Pages deploy.

Every step follows TDD (red → green → refactor) and ends in exactly one conventional commit. Pure logic lives in `src/engine/` (no React, no fetch, no store imports — plain functions on plain data). Steps 1–2 are scaffolding (tests are sanity-level); steps 3–9 are logic/infrastructure (test-heavy); steps 10–14 are features (tests on extracted `*Logic.ts` view-models + store wiring); step 15 is deploy.

This plan incorporates the Phase 4 adversarial review: operation-based conflict merges (no state unions), substring blocked-ingredient matching, corrected rotation boundary, rotation-before-diet ranking, auth-failure handling with a repo probe before first-run seeding, spec-conformant amount merging, per-week shopping check states, offline snapshot cache, and explicit error/loading UX.

Branch: `feature/001-core-planner` (already carries spec/plan per workflow).

## Data model summary (established in step 3, consumed everywhere)

- `Recipe { id, name, ingredients: {name, amount?, unit?}[], category, effort, source?, notes?, untried: boolean, createdAt, updatedAt }`
- `WeekPlan { days: Record<IsoDay, recipeId | null> }` inside `plans: Record<WeekKey, WeekPlan>`; `WeekKey` = ISO-8601 week string `"2026-W30"`
- `Settings { persons: [{ name, blocked: string[] }, { name, blocked: string[] }], dietRules: { category, min?, max? }[], rotationWeeks: number }`
- `SaleItem { name, note? }`; `pantry: string[]`
- `Extras { weeks: Record<WeekKey, WeekExtras> }`; `WeekExtras { checks: Record<ItemKey, true>, extraItems: { id, name, checked }[], homeOverrides: Record<ItemKey, 'toHome' | 'toBuy'> }` — **check states, manual extras, and "doma máme" overrides are all scoped per plan week** (each week's list starts fresh); `ItemKey` = `normalize(name) + "|" + normalize(unit ?? "")` → stable within a week because keys derive from content (never amount), not position
- Every data file is wrapped `{ schemaVersion: 1, data: ... }`

## Conflict-merge contract (governs steps 8–9; the design's riskiest point)

Merges are **operation-based, never state unions**. Every store mutation is a named operation (`addPantryItem(name)`, `removePantryItem(name)`, `clearSales()`, `upsertSaleItem(name, note)`, `deleteRecipe(id)`, `upsertRecipe(recipe)`, `assignDay(week, day, recipeId|null)`, `setCheck(week, key, bool)`, `addExtraItem(week, item)`, `setHomeOverride(week, key, dir)`, `setBlockedList(personIdx, list)`, `upsertDietRule(category, min, max)`, `setRotationWeeks(n)`, `setPersonName(idx, name)` …). On a write conflict the store refetches remote and **re-applies the local operation on top of remote data** (`merge = apply(op, remoteData)`), then retries once. This makes deletions stick (no union resurrection), lets concurrent edits to disjoint fields of `settings.json` both survive, and reduces true same-field races to a documented last-write-wins.

## Steps

### Step 1 — Project scaffolding

**Commit:** `chore: scaffold vite react-ts project with vitest and eslint`

**Tests first:**

- `src/smoke.test.ts` — imports a constant from `src/appMeta.ts` and asserts it equals `"MunchPlan"`. Written before the config exists; goes green when `npm test` runs (proves the Vitest + TS strict pipeline itself).

**Files:**

- `package.json` (scripts: `dev`, `build: tsc --noEmit && vite build`, `test: vitest run`, `test:watch`, `lint`), `vite.config.ts` (`base: '/munchplan/'` — **matches the actual remote repo name `TS6482/munchplan`, verified 2026-07-19; case-sensitive**; vitest config: `environment: 'node'`, include `src/**/*.test.ts?(x)`), `tsconfig.json` (strict), `eslint.config.js` (typescript-eslint + react-hooks flat config), `index.html`, `src/main.tsx`, `src/App.tsx` (renders "MunchPlan"), `src/appMeta.ts`, `.gitignore`

**Risks / edge cases:**

- Wrong Vite `base` silently breaks Pages later — verify now, re-verify in step 15.
- Vitest `environment: 'node'` means feature tests are logic-extraction style (no `.tsx`/CSS imports in tests) — this constrains how steps 10–14 write tests; plan for it now.
- `tsc --noEmit` in build catches strict errors CI would otherwise miss — keep it from day one.

### Step 2 — Design tokens, app shell, router

**Commit:** `feat: add design tokens, czech app shell, and hash router`

**Tests first:**

- `src/router/router.test.ts` — route table matching: `parseRoute('#/recepty/abc')` → `{ name: 'recipe', id: 'abc' }`; unknown hash → default route; empty hash → home. Red first.

**Files:**

- `src/styles/tokens.css` (4px spacing scale, iOS-style colors/radii, Apple system font stack, light + dark via `prefers-color-scheme`), `src/styles/global.css`
- `src/router/router.ts` (pure hash-parsing + navigate helpers — testable in node), `src/router/useRoute.ts` (hashchange hook), `src/App.tsx` + `src/App.module.css`
- **Tab set (decided): 5 bottom tabs** — Plán / Recepty / Nákup / Zásoby / Nastavení. "Zásoby" is one screen with two segments: Slevy and Spíž. Five tabs fit ~390 px; six don't.
- **Route slugs are ASCII only** (`#/spiz`, `#/plan`, `#/recepty`, `#/nakup`, `#/zasoby`, `#/nastaveni`) — browsers disagree on percent-encoding of non-ASCII in `location.hash`. Czech appears in labels, never in slugs.
- Route views as placeholder stubs so the shell compiles.

**Risks / edge cases:**

- Hash router (not history) — required for GitHub Pages subpath without 404 hacks.
- Keep `parseRoute` pure and separate from the hook so it stays unit-testable in node env.

### Step 3 — Types + ingredient normalization/matching engine

**Commit:** `feat: add domain types and ingredient normalization engine`

**Tests first (red → green):**

- `src/engine/normalize.test.ts`: lowercase (`"Mouka"` → `"mouka"`), trim, **diacritics** (`"Kuřecí "` → `"kureci"`, `"žampióny"` → `"zampiony"`), empty string, combining characters (NFD-form input matches precomposed).
- `src/engine/match.test.ts`:
  - `exactMatch("Sůl", "sul")` true;
  - `saleMatch` substring **both directions** (`"kuřecí"` sale ↔ `"kuřecí stehna"` ingredient, and reversed); no match on unrelated; empty string never matches (guard `""`);
  - `blockedMatch(blockedTerm, ingredientName)` — **one-direction substring**: blocked `"houby"` matches ingredients `"houby"`, `"sušené houby"`, `"houby shiitake"`; ingredient `"houby"` is NOT blocked by term `"sušené houby"`; empty guard.

**Files:**

- `src/types/index.ts` (all domain types incl. `Extras`/`WeekExtras` + `ItemKey` helper), `src/engine/normalize.ts` (`normalizeName`: NFD → strip `\p{M}` → lowercase → trim), `src/engine/match.ts` (`exactMatch`, `saleMatch`, `blockedMatch`, `itemKey(name, unit?)`)

**Risks / edge cases:**

- Diacritics via `String.normalize('NFD')` + `/\p{M}/gu` — covers Czech háčky/čárky; test both precomposed and decomposed inputs.
- Empty-string substring match is `true` in JS — explicitly guard and test in all three matchers.
- `itemKey` is the stable identity contract for steps 7 and 14 — includes unit, **never amount**; get it right once.

### Step 4 — Week identification engine

**Commit:** `feat: add iso week utilities`

**Tests first:**

- `src/engine/week.test.ts`: `weekKeyOf(date)` for known fixtures — mid-year date; **year boundaries** (`2025-12-29` → `"2026-W01"`, `2027-01-01` → `"2026-W53"`); Sunday belongs to the week started the preceding Monday (Monday–Sunday weeks = ISO weeks); `mondayOf(weekKey)` round-trips; `addWeeks("2026-W01", -2)` → `"2025-W51"` (**lookback across year boundary is date-arithmetic, never string decrement**); `currentWeek(now)` / `nextWeek(now)` take an injected `now` for testability; `daysOf(weekKey)` returns 7 ISO dates Mon→Sun. (Fixtures independently verified in Phase 4 review.)

**Files:**

- `src/engine/week.ts`

**Risks / edge cases:**

- ISO week-numbering year ≠ calendar year around New Year (Dec 29–Jan 3) — the fixtures above are the exact traps.
- 53-week years (2026 is one) — `addWeeks` must handle W53.
- Use UTC-noon date math to dodge DST off-by-one-day bugs; test a date inside the CET→CEST transition week.

### Step 5 — Quota evaluation + rotation engine

**Commit:** `feat: add diet quota evaluation and rotation window engine`

**Tests first:**

- `src/engine/quota.test.ts`: given planned recipes' categories + rules — `evaluateQuotas` reports per-rule `{ met, count, min?, max? }`; `wouldExceedMax(category)` true when at max ("max 2× maso", 2 planned); unmet min detected ("min 1× ryba", 0 planned); category with no rule → unconstrained; empty plan; empty rules.
- `src/engine/rotation.test.ts`: `lastCookedWeek(recipeId, plans)` scans all weeks; `weeksSinceCooked(recipeId, plans, targetWeek)` returns `Infinity` when never cooked; `isInRotationWindow(…, rotationWeeks)` — **inclusive window: cooked in weeks `target−1 … target−N` → hidden; cooked exactly N weeks ago → hidden (it IS "in the last N weeks"); cooked N+1 weeks ago → visible (this is AC5's "reappears once the window has passed")**; lookback from W01/W02 into previous year's W51/W52 (uses step 4's `addWeeks`); never cooked → visible; window 0 → nothing hidden; the target week's own current assignment doesn't count against itself.

**Files:**

- `src/engine/quota.ts`, `src/engine/rotation.ts`

**Risks / edge cases:**

- The exactly-N boundary above is the pinned decision — do not re-litigate it in code.
- Rotation must only look at weeks **before** the target week — planning next week shouldn't hide a recipe because it's in next week's draft.

### Step 6 — Suggestion ranking engine

**Commit:** `feat: add suggestion ranking engine`

**Tests first:**

- `src/engine/suggest.test.ts`, composing steps 3–5 (pass pure inputs: recipes, plans, sales, settings, targetWeek):
  - Exclusions: blocked ingredient for either person via **`blockedMatch` (substring — fixture includes compound name "sušené houby" excluded by blocked "houby", AC3)** → absent; inside rotation window → absent (AC5); would break a max quota → absent (AC4); recipe with zero ingredients → absent (spec: unplannable); recipes already in the target week → absent.
  - **Untried recipes with ingredients are INCLUDED** and the suggestion carries an `untried: true` flag for the UI badge "nevyzkoušené" (user decision).
  - Ranking — lexicographic tuple matching spec priority: **`(saleMatchCount desc, weeksSinceCooked desc [never = Infinity], unmetMinBoost desc, normalizedName asc)`** — discount first, rotation freshness second, diet third, deterministic tie-break. Tests pin the full tuple, including a case where rotation freshness beats unmet-min boost.
  - Result includes `matchedSaleIngredients` per suggestion (AC6 "shows which matched").
  - `warningsFor(recipe, …)` helper for the direct-assignment path: returns blocked/max-exceeded/rotation warnings (AC3, AC4) — same logic, reused by UI in step 13.
  - Empty inputs: no recipes → `[]`; no sales/rules → ordered by rotation-freshness + name.

**Files:**

- `src/engine/suggest.ts` (`rankSuggestions`, `warningsFor`)

**Risks / edge cases:**

- Lexicographic tuple, not a weighted sum — deterministic and testable.
- Blocked matching is substring by explicit user decision (allergy safety) — spec updated; tests encode it.

### Step 7 — Shopping-list engine

**Commit:** `feat: add shopping list build and merge engine`

**Tests first:**

- `src/engine/shoppingList.test.ts` — `buildShoppingList(recipes, plan, pantry, sales, weekExtras)`:
  - Merging: 200 g + 300 g mouka → 500 g mouka (AC7); **unit mismatch** (1 ks cibule + 200 g cibule) → two lines, distinct `ItemKey`s; amount-less duplicates ("sůl" twice) → single line, no amount; **amount + amount-less same name → TWO lines per spec ("listed separately otherwise"): `mouka|g` shows "500 g", `mouka|` shows "dle receptu" — collapsing them would show misleading totals and destabilize check keys**.
  - Pantry: exact normalized match → item lands in `homeSection` (not deleted) (AC7); `homeOverrides` move an item the other way in both directions and survive rebuilds (keyed by `ItemKey`).
  - Sales: substring match either direction → `onSale: true` + matched sale name.
  - Identity/persistence: item `key` = `itemKey(name, unit)`; re-running after a plan edit keeps identical keys for unchanged ingredients → check states in `weekExtras.checks` re-attach (AC8); removed recipe → its unique items drop, checks for surviving keys remain; extra items appended with own ids.
  - **Plan day referencing a deleted/unknown recipeId → skipped without crashing** (fixture).
  - Empty states: empty plan → only extras; empty pantry/sales → no sections/marks.

**Files:**

- `src/engine/shoppingList.ts`

**Risks / edge cases:**

- Stable identity is the crux of AC8 — key must NOT include amount but MUST include unit.
- Display name for a merged item: first-seen original spelling (normalized key, pretty label) — test it.
- Orphaned check keys within a week are kept harmlessly; weeks are naturally bounded because extras are per-week (no unbounded growth).

### Step 8 — GitHub Contents API layer

**Commit:** `feat: add github contents api storage layer`

**Tests first (global `fetch` mocked via `vi.stubGlobal`):**

- `src/api/github.test.ts`:
  - `probeRepo(cfg)`: `GET /repos/{owner}/{repo}` — 200 → ok; 404/401/403 → typed `AuthError` (GitHub masks inaccessible private repos as 404 — **a blanket 404 must never be interpreted as "first run"**).
  - `getFile(cfg, path)`: correct URL (`/repos/{owner}/{repo}/contents/{path}`), `Authorization: Bearer <PAT>`, decodes base64 content (**UTF-8-safe** — Czech diacritics through `TextEncoder`/`TextDecoder`, never bare `atob`/`btoa`), returns `{ json, sha }`; 404 → `null` (file not yet created).
  - `putFile(cfg, path, json, sha?)`: PUT with base64 UTF-8 body, sha included when updating / omitted when creating; returns new sha.
  - `saveWithRetry(cfg, path, op, apply)`: happy path one PUT; **409/422 conflict → refetch → `apply(op, remoteData)` → retry PUT once**; second conflict → typed `ConflictError` (surfaced by UI, no silent loss — AC9); 401/403 mid-flight → `AuthError`; network error → typed `NetworkError`.
  - Schema versioning: reader validates `schemaVersion === 1`; unknown higher version → typed error, never a destructive write.

**Files:**

- `src/api/github.ts`

**Risks / edge cases:**

- `btoa`/`atob` corrupt UTF-8 — round-trip test with "kuřecí stehna".
- GitHub returns 409 or 422 on sha mismatch depending on path — treat both as conflict.
- Exactly-one-retry policy mirrors Dražgrešle; more retries hide real problems.
- Fine-grained PATs expire (≤ 1 year) — `AuthError` is a normal lifecycle event, not an edge case; UX handled in step 10.

### Step 9 — Zustand stores: session, data, operation-based merges, offline cache

**Commit:** `feat: add session and data stores with operation-based conflict merge and offline cache`

**Tests first:**

- `src/store/ops.test.ts` (pure `apply(op, data)` per operation — the heart of AC9; **no union merges anywhere**):
  - `removePantryItem` re-applied on remote that meanwhile gained an item → deletion sticks AND the new item survives (no resurrection).
  - `clearSales` re-applied on remote with a concurrently added item → list ends empty (clear wins; it was the later intent) — documented.
  - `deleteRecipe` vs concurrent remote edit of another recipe → both effects survive; `upsertRecipe` same-id concurrent edit → re-applied local wins (documented last-write tradeoff).
  - `assignDay` on remote that changed a different day/week → both survive.
  - `setCheck`/`addExtraItem`/`setHomeOverride` scoped to their week; concurrent ops on different weeks both survive; `setCheck(false)` (uncheck) re-applied → stays unchecked (no re-check from stale remote).
  - `setBlockedList(person0)` vs concurrent `upsertDietRule` → **both survive** (disjoint fields of settings.json — fixes the review's settings-clobber blocker); `setPersonName` covered.
- `src/store/data.test.ts` (with `src/api/github` mocked via `vi.mock`):
  - `loadAll` **first calls `probeRepo`; on `AuthError` it stops (no seeding, no fetches interpreted as first-run) and sets an auth-error state.**
  - Probe ok + all files 404 → true first run: sensible empty states; **pantry seeded with the Czech staples and written via `saveWithRetry`** — test the dual-device race: seed PUT hits 422 → refetch → apply → retry succeeds without duplicate/lost items.
  - Seeding happens only when `pantry.json` is 404, never when it exists but is empty (deliberate clearing respected).
  - Each mutation updates state optimistically and calls `saveWithRetry` for **only its own file** with its op (per-file independence — different files never conflict, AC9 first half).
  - **Successful conflict retry writes the merged result + new sha back into the store** (local state matches persisted state); **final `ConflictError`/`NetworkError` rolls back the optimistic change and sets an error state** for the UI.
  - **Offline cache:** every successful load/save snapshots the file's data to localStorage; when `loadAll` fetches fail with `NetworkError`, the store hydrates from the cached snapshot and sets `offline: true` (user decision — shopping list must be viewable in the supermarket).
- `src/store/session.test.ts`: owner/repo/PAT persisted to localStorage; `isConfigured` flag; unconfigured state fires no fetches.

**Files:**

- `src/store/session.ts`, `src/store/ops.ts` (operation types + `apply`), `src/store/data.ts`, `src/store/seed.ts` (staples list from spec)

**Risks / edge cases:**

- The op-based contract is the design's riskiest point — locked by tests here before any UI depends on it.
- Store keeps per-file `sha` map; all writes route through it.
- localStorage snapshot is a read fallback, not an offline write queue (out of scope; writes while offline fail visibly).

### Step 10 — Settings UI + global status surface

**Commit:** `feat: add settings screens, device config, and global status surface`

**Tests first:**

- `src/features/settings/settingsLogic.test.ts` (extracted pure helpers): PAT/owner/repo form validation (non-empty, repo `owner/name` shape); diet-rule editing invariants (min ≤ max, non-negative, one rule per category); rotation weeks ≥ 0 integer parse; add/remove blocked ingredient normalizes for comparison, preserves display spelling; **person name editing**.
- `src/components/statusLogic.test.ts`: state machine mapping store states → banner/toast content — loading, offline (Czech: "Offline — zobrazuji poslední načtená data"), auth error ("Token vypršel nebo nemá přístup…" → link to settings), conflict/network save failure with rollback notice.
- Integration: store test — saving settings writes `settings.json` via mocked API.

**Files:**

- `src/features/settings/SettingsPage.tsx` + `.module.css`, `settingsLogic.ts`; `src/components/StatusBanner.tsx` + `statusLogic.ts` (global loading/offline/error surface used by all later steps); route wiring in `src/App.tsx`
- First-run gate: when session is unconfigured, all routes render the config form (Czech copy + link to PAT creation docs). `AuthError` routes here too.

**Risks / edge cases:**

- PAT stored in localStorage — UI notes it's device-local; never written to the data repo.
- Unconfigured state must not fire any fetches (guard tested in step 9).

### Step 11 — Recipes feature: CRUD + try-someday inbox

**Commit:** `feat: add recipe crud and vyzkoušet inbox`

**Tests first:**

- `src/features/recipes/recipeForm.test.ts`: form → `Recipe` mapping; validation — name required; full form requires ≥1 ingredient; **minimal inbox form requires only name (+ optional source)** and sets `untried: true` (AC2); ingredient row parsing — **amount accepts Czech decimal comma (`"0,5"` → 0.5)**, numeric-or-empty, unit free text; `canBePlanned(recipe)` = has ≥1 ingredient (enforced in step 13); **source rendered as link only for http/https URLs (scheme sanitized — no `javascript:` hrefs), otherwise plain text**.
- Store integration test: create/edit/delete round-trips through mocked API into `recipes.json` (AC1); promote (`untried → false`) is a plain update.

**Files:**

- `src/features/recipes/RecipeListPage.tsx`, `RecipeDetailPage.tsx`, `RecipeForm.tsx`, `InboxPage.tsx` (inbox tab within the list screen), `QuickAddForm.tsx`, `recipeForm.ts`, co-located `.module.css`; routes.

**Risks / edge cases:**

- Quick-add must be genuinely ~15 s: one screen, two fields, one tap (AC2) — a separate minimal form, not the full form with hidden fields.
- Deleting a recipe referenced by a past plan: keep the plan's recipeId; render "smazaný recept" fallback — never cascade-delete plan history (engine already skips unknown ids, step 7).
- Float display for summed comma-decimals (0,1 + 0,2) — format via a rounding helper, tested.
- Category list extensible: stored as string, known six offered as chips.

### Step 12 — Zásoby screen: sale list + pantry

**Commit:** `feat: add zasoby screen with sale list and pantry segments`

**Tests first:**

- `src/features/zasoby/salesLogic.test.ts`: add item (name + optional note); **duplicate (normalized) name → merged, keeping the newer note** (decided); remove one; `clearAll` ("nový týden") empties the list.
- `src/features/zasoby/pantryLogic.test.ts`: add normalizes-for-dedupe, keeps display spelling; remove; view-model sort Czech-locale alphabetical via `localeCompare('cs')`.

**Files:**

- `src/features/zasoby/ZasobyPage.tsx` (segmented: Slevy / Spíž), `SalesSegment.tsx`, `PantrySegment.tsx`, `salesLogic.ts`, `pantryLogic.ts`, `.module.css`; route `#/zasoby`.

**Risks / edge cases:**

- "Nový týden" is destructive — confirm dialog.
- Empty states with Czech copy ("Zatím žádné slevy…").

### Step 13 — Weekly plan + suggestions panel

**Commit:** `feat: add weekly plan screen with ranked suggestions`

**Tests first:**

- `src/features/plan/planLogic.test.ts` (view-model over engine): current/next week toggle labels from `week.ts` (injected `now`); day rows Mon–Sun with recipe names; assigning calls store with `(weekKey, day, recipeId)`; **blocking `canBePlanned === false` recipes** with Czech message; direct-assignment picker surfaces `warningsFor` output (blocked / max exceeded / rotation) but allows the pick (AC3, AC4); suggestions panel is `rankSuggestions` output verbatim — test the wiring inputs (target week = the week being viewed), matched-sale-ingredients rendering data (AC6), **"nevyzkoušené" badge from the `untried` flag**; clearing a day.
- Integration: store test — day assignment persists to `plans.json` (mocked API) and quota/suggestion recompute reflects the new plan (AC4 second-maso scenario end-to-end at logic level).

**Files:**

- `src/features/plan/PlanPage.tsx`, `SuggestionsPanel.tsx`, `RecipePicker.tsx`, `planLogic.ts`, `.module.css`; home route → PlanPage.

**Risks / edge cases:**

- Empty states: no recipes → suggestions panel links to recipe creation; empty week renders 7 empty slots.
- Suggestions recompute against the plan **including in-progress picks this session** (max-quota exclusion updates live).
- Week navigation limited to current + next per spec.

### Step 14 — Shopping list feature

**Commit:** `feat: add shopping list with per-week checks, extras, and doma máme section`

**Tests first:**

- `src/features/shopping/shoppingLogic.test.ts`: view-model = `buildShoppingList` output grouped into buy / "doma máme" (collapsed) / sale flags, **for the selected plan week's `WeekExtras`**; toggle check → `setCheck(week, itemKey, bool)` (store test, mocked API, AC8); add/remove/check manual extras; move item between "doma máme" and main list via persisted `homeOverrides` (survive rebuilds via itemKey); **plan edit → rebuild keeps checks of unchanged items** (integration: assign extra recipe, rebuild, prior checks intact — AC8); reload simulation: fresh store hydrate from `extras.json` restores the week's checks; **switching to a different week shows that week's own (fresh) check state — nothing leaks across weeks**.

**Files:**

- `src/features/shopping/ShoppingPage.tsx`, `shoppingLogic.ts`, `.module.css`; route `#/nakup`.

**Risks / edge cases:**

- Checks persist in `extras.json` (shared) — both partners see check-offs live; note in validation report.
- Old weeks' extras stay in the file harmlessly (small); no pruning built (simplicity first).

### Step 15 — CI + GitHub Pages deploy + smoke checklist

**Commit:** `chore: add ci and github pages deploy workflows`

**Tests first:**

- No new unit tests; the gate is: full Vitest suite + lint + `npm run build` green locally **and in CI** (AC10) before the workflows land.

**Files:**

- `.github/workflows/ci.yml` — **on `pull_request`**: `npm ci` → lint → test → build (keeps `main` always green per CLAUDE.md; a PR can't merge red).
- `.github/workflows/deploy.yml` — on push to `main` (+ manual dispatch): `npm ci` → lint → test → build → upload `dist/` → official `actions/deploy-pages` chain with Pages permissions.
- `README.md` — usage: creating the private data repo; generating a **fine-grained PAT** (Contents read/write on the data repo only); **PATs expire — renewal walkthrough**; per-device setup; **note that all sites on `username.github.io` share one origin, so the PAT in localStorage is readable by any other app hosted there — keep the PAT fine-grained to the data repo only**; **one-time manual step: repo Settings → Pages → Source: "GitHub Actions"**; `base` in `vite.config.ts` must match the repo name exactly.

**Smoke checklist (manual, both phones — feeds Phase 8 validation report):**

1. Open Pages URL; assets load (base path correct); light/dark both render.
2. Configure owner/repo/PAT on device A; pantry seeds with staples. Configure device B the same evening — no seed-race error.
3. Create a full recipe on A → reload on B → visible (AC1).
4. Quick-add inbox recipe on B (~15 s), complete + promote later (AC2).
5. Block "houby" for person A → recipe with "sušené houby" excluded from suggestions + manual-pick warning (AC3).
6. Set "max 2× maso" + "min 1× ryba" → plan two maso → verify exclusion/warning/boost (AC4).
7. Verify rotation hide (cooked ≤2 weeks ago) and reappear (3 weeks ago) using past-week plan entries (AC5).
8. Add "kuřecí" to sales → verify ranking + matched-ingredient display + "nevyzkoušené" badge on an untried suggestion (AC6).
9. Build week plan → shopping list: merged amounts, separate "dle receptu" line for amount-less duplicates, "doma máme", sale marks (AC7).
10. Check items + add extra → reload + edit plan → states intact; switch week → fresh checks (AC8).
11. Concurrent edits: A edits recipes while B edits pantry (both succeed); A and B edit the same file near-simultaneously → conflict path merges without loss; A deletes a pantry item while B adds one → deletion sticks (AC9).
12. Airplane mode → reopen app → cached data + offline banner; shopping list readable.
13. Enter a wrong/expired PAT → clear Czech error routing to settings, no fake "empty app".

## Acceptance criteria → steps map

| AC | Steps |
| --- | --- |
| 1. Recipe CRUD persists cross-device | 8, 9, 11 (smoke: 15) |
| 2. ~15 s inbox add + promote | 11 |
| 3. Blocked ingredient exclusion (substring) + warning | 3, 6, 13 |
| 4. Max-quota exclusion/warning; min boost | 5, 6, 13 |
| 5. Rotation hide/reappear (N hidden, N+1 visible) | 4, 5, 6, 13 |
| 6. Sale-match ranking + matched shown | 3, 6, 13 |
| 7. Merged list, "doma máme", sale marks | 3, 7, 14 |
| 8. Checks/extras survive reload + plan edits (per week) | 7, 9, 14 |
| 9. Concurrent writes; op-based merge, no silent loss | 8, 9 (smoke: 15) |
| 10. Logic unit-tested; build + suite green | every step; gated in 15 (CI) |

## Cross-cutting risks

- **Vitest node environment** (Dražgrešle parity): UI steps keep components thin and push behavior into `*Logic.ts` view-model modules — enforced from step 2. Residual untested surface (first-run gate rendering, tab nav, collapse/expand wiring) is listed under "Needs user validation" in Phase 8. If a genuinely DOM-dependent bug class appears, revisit with a scoped jsdom project (plan deviation → update this doc).
- **Operation-based merge contract** (steps 8–9) is the riskiest design point — specified once in this document's contract section, locked by `ops.test.ts` before any UI depends on it. No union merges anywhere.
- **Stable `ItemKey`** (steps 3, 7, 14) is a shared contract; changing it later invalidates stored checks — locked by tests in step 3. Check scoping is per `WeekKey` (spec decision).
- **Auth lifecycle**: PAT expiry is a when-not-if event — `probeRepo` gate + `AuthError` UX (steps 8–10) prevent the "empty app / false first-run" failure mode.
