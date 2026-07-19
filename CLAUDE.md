# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Git Conventions

- **Never commit directly to `main`.** All work happens on branches; `main` only changes via pull request.
- Branch naming: `feature/<short-name>` for features, `fix/<short-name>` for bug fixes, `chore/<short-name>` for maintenance.
- Create the branch **at the start** of the workflow (before writing planning docs), so planning documents are committed on the feature branch and reviewed as part of its PR.
- Commit messages follow Conventional Commits: `feat: ...`, `fix: ...`, `test: ...`, `docs: ...`, `refactor: ...`, `chore: ...`.
- Commit incrementally at each phase boundary and at logical checkpoints during implementation — not one giant commit at the end.
- Keep `main` always green: every merge must have all tests passing.

## Feature Development Workflow

The full workflow below applies to **new features**. For small bug fixes, typos, or trivial chores, use a lightweight path instead: `fix/` branch → test reproducing the bug (if applicable) → fix → code review → PR. Never skip tests or the PR itself.

### Phase 1 — Goal definition (brainstorming)

- Never start a feature from assumptions. Use brainstorming skills and ask the user structured questions to define the goal together.
- Explore: the problem being solved, who it's for, what success looks like, what is explicitly **out of scope**.
- Output: an agreed goal statement, confirmed by the user.

### Phase 2 — Feature specification (planning document)

- Planning documents live in **`docs/features/`**, one folder per feature: `docs/features/NNN-<feature-name>/` (NNN = zero-padded sequence number, e.g. `001-recipe-import`).
- Create `docs/features/NNN-<feature-name>/spec.md` containing:
  - **Status** — Draft → Approved → In Progress → Done (keep updated)
  - **Goal** — the agreed goal statement from Phase 1
  - **Feature definitions** — what the feature does, user-facing behavior
  - **Acceptance criteria** — concrete, testable conditions for "done"
  - **Out of scope** — what this feature deliberately does not do
  - **Libraries / dependencies** — what's needed and why each was chosen
  - **Open questions** — unresolved items to settle before implementation
- Review the spec with the user and iterate until they approve it. Mark Status: Approved.

### Phase 3 — Implementation plan

- Write `docs/features/NNN-<feature-name>/plan.md` using planning skills (plan mode / Plan agent).
- The plan must:
  - Break work into small, ordered, verifiable steps
  - Follow **test-driven development**: for each step, define the tests first (red → green → refactor). Unit tests are required for everything; add integration tests where components interact.
  - List files to create/modify per step
  - Identify risks and edge cases per step

### Phase 4 — Deep plan review

- Perform a deep, adversarial review of the plan using **Opus on High reasoning effort** (or Fable). This phase matters most — planning bugs are the most expensive ones.
- The review hunts for: design flaws, missing edge cases, wrong library choices, untestable steps, hidden dependencies, conflicts with existing code.
- Fix all findings in the plan, then have the user sign off on the final plan.

### Phase 5 — Commit planning

- Commit `spec.md` and `plan.md` to the feature branch and push to GitHub (`docs: add spec and plan for <feature>`).

### Phase 6 — Implementation

- **Before writing code, suggest the model setup to the user** (which model to run, inline vs. subagents) and let them confirm.
- If using subagents: **Fable (or Opus) is orchestrator and reviewer; subagents are Sonnet on Max effort.**
- Follow the plan step by step with TDD: write the failing test, make it pass, refactor.
- Update Status in spec.md to In Progress.
- **Batch review during development:** after each completed plan step (or small batch of related steps), review that step's diff before committing — correctness, test quality, adherence to the plan. Catching issues here is cheaper than in Phase 7.
- Commit after each completed plan step with a conventional commit message.
- If implementation reveals the plan is wrong, stop, update plan.md, and note the deviation — don't silently diverge.

### Phase 7 — Feature-level code review

- Review of the **whole feature diff** (branch vs. `main`) by **Fable or Opus** — not the entire codebase.
- Step-level issues were already caught by the batch reviews in Phase 6, so this pass focuses on what per-step reviews can't see: architectural consistency across steps, duplication, API coherence, integration seams, error handling, security, and test coverage gaps at the feature level.
- Fix findings, commit fixes.

### Phase 8 — Testing and user validation

- Run the complete test suite; all tests must pass.
- Present the user a validation report with two explicit lists:
  - **Verified by Claude** — what automated tests and checks cover
  - **Needs user validation** — manual functionality checks only the user can perform (UX, real-world data, visual behavior)
- Wait for the user's approval. If issues are found, fix them (with tests) and re-validate.

### Phase 9 — Finalization

- After user approval: final code review pass, refactoring, and cleanup (dead code, TODOs, debug output, naming).
- Ensure docs are current: update README if user-facing behavior changed, set spec.md Status: Done.
- Run the full test suite one last time.

### Phase 10 — Pull request

- Push the branch and open a PR from the feature branch to `main` using `gh`.
- PR description: summary of the feature, link to `docs/features/NNN-<feature-name>/`, test summary, and anything the reviewer should focus on.
- Do not merge without the user's go-ahead. After merge, delete the feature branch.

## Definition of Done (checklist)

- [ ] Spec approved by user, Status: Done
- [ ] All plan steps implemented via TDD
- [ ] All tests pass; new code has unit tests
- [ ] Code review findings resolved
- [ ] User manually validated the flagged areas
- [ ] Refactor/cleanup pass completed
- [ ] Docs updated (spec, README)
- [ ] PR opened against `main`
