# Project Success Log Template

Use this template after completing a feature, debugging session, or optimization pass.

Save completed logs in `docs/logs/LOG-YYYY-MM-DD-<slug>.md`.

---

```markdown
# Project Log: [Feature/Task Name]

## Date: YYYY-MM-DD

## Context

- **Task**: What was the task?
- **Expected outcome**: What should it look like / do when done?
- **Trigger**: What prompted this work? (bug report, feature request, perf issue)
- **Time spent**: Approximate duration

## What Worked

- [ ] Approach 1: description + why it worked
- [ ] Approach 2: description + why it worked
- Key decisions that paid off:
  - Decision 1 → result
  - Decision 2 → result

## What Failed / Struggled With

- [ ] Failed approach 1: what was tried, why it didn't work, time wasted
- [ ] Failed approach 2: what was tried, why it didn't work, time wasted
- Root causes of failures:
  - Cause 1 → lesson
  - Cause 2 → lesson

## Patterns Discovered

### New Patterns
| Pattern Name | Problem | Solution | Confidence |
|-------------|---------|----------|------------|
| | | | |

### Existing Patterns That Proved Useful
- Pattern: [name] — used for [purpose]

## Performance Impact

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| FPS | | | |
| Draw calls | | | |
| Memory (MB) | | | |
| Load time (ms) | | | |
| GPU frame (ms) | | | |

## Anti-Patterns Identified

| Anti-Pattern | Why It's Bad | What To Do Instead |
|-------------|-------------|-------------------|
| | | |

## TODO / Follow-up

- [ ] Item 1: description
- [ ] Item 2: description

## Technical Debt Introduced

- [ ] Debt 1: description + mitigation plan
```
