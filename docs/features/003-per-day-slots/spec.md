# Feature 003 — Per-Day Slot Planning

## Status

Approved

## Goal

Validation feedback on feature 002: the household eats irregularly day to day, so week-level slot activation is wrong. Every day always shows all four slot rows (snídaně / oběd / večeře / svačiny); unplanned slots simply stay empty; each row has an instant ✕ that clears that day's slot. The week-level "active slots" concept is removed from the model and the UI. (User decisions 2026-07-25.)

## Feature definitions

### Data model

- `WeekPlan` loses `activeSlots`: it becomes `{ days: Record<IsoDay, DayPlan> }`. `MealEntry`/`DayPlan` unchanged.
- `normalizePlans` accepts and **silently strips** `activeSlots` from stored weeks (feature-002 data reads fine; the next save writes the new shape). All other normalization (legacy string-day migration, deterministic legacy ids, week-key validation) is unchanged.

### Plan screen

- The week-level slot chip row is **removed**.
- Day cards always render all four slot lines in `SLOT_ORDER`; an unplanned slot renders "—".
- Each slot line with entries shows an **✕ on the right** that clears that day+slot **instantly, no confirmation** (new op `clearDaySlot(week, day, slot)`; deletion sticks under conflict merge). Cleared meals leave the shopping list and quota counts.
- Tapping a line still opens the meal detail page (unchanged, except no slot-activation logic remains).

### Auto-fill ("Doplnit návrhy")

- Fill targets = the **per-weekday pattern of the nearest earlier stored week**: for each day, the slots that held ≥1 entry on the same weekday of that week. No earlier week → večeře on every day. Only empty targeted slots are filled (unchanged behavior otherwise: weighted random, suitability/blocked/rotation/quota rules, progressive pass, hints for no-candidate slots).
- Manually adding meals to any slot makes it part of next week's pattern automatically.
- "Přegenerovat" (whole week and per-slot) is unchanged: replaces `source: 'auto'` entries anywhere they exist.

### Ops

- Removed: `activateSlot`, `deactivateSlot` (and all seeding logic).
- Added: `clearDaySlot(week, day, slot)` — empties one day+slot's entry list; re-applied on conflict the deletion sticks; concurrent edits to other day/slots survive (per-slot granularity preserved).

### Rollout

Same caveat as 002, milder: update both devices at (or near) the same time. A device still on the 002 version hides slots outside its stored `activeSlots` and its slot-untick deletes entries; the 003 version strips `activeSlots` harmlessly. Data repo git history remains the recovery net.

## Acceptance criteria

1. Every day card shows all four slot rows regardless of stored data; feature-002 data (with `activeSlots`) loads with all meals visible and the field is dropped on next save.
2. ✕ clears exactly that day+slot instantly; the meals disappear from the shopping list and quota counts; deletion survives the conflict-merge path.
3. Auto-fill fills only the per-weekday pattern of the nearest earlier stored week (year-boundary safe); with no history, dinners only; occupied slots never overwritten; hints shown for no-candidate targets.
4. Reroll still replaces only auto entries, wherever they are.
5. Concurrent edits to different day/slot combinations both survive.
6. All logic unit-tested; full suite, lint, build green.

## Out of scope

Everything else from 002 stays as shipped (meal detail page, vhodné pro, cross-slot rules, shopping aggregation, composition-ready fields).

## Libraries / dependencies

None new.

## Open questions

None — all resolved with the user (2026-07-25): all slots always visible; instant ✕ per day-slot; auto-fill targets from last week's weekday pattern; per-weekday inheritance replaces week-level activation.
