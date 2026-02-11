# Commit / Feature Capitalization Process

6-step process to extract reusable knowledge from a commit, PR, or feature.

---

## Step 1: Identify the Problem Solved

- What was broken or missing?
- What triggered this work? (user complaint, performance issue, visual bug)
- What was the acceptance criteria?

## Step 2: Document the Approach

- What technique was used?
- Why this approach over alternatives?
- What trade-offs were made?
- What was the confidence level before starting?

## Step 3: Extract Reusable Patterns

For each generalizable technique, create a named pattern:

```markdown
### Pattern: [Name]

**Problem**: [1-2 sentences]
**Solution**: [1-2 sentences + code snippet if relevant]
**When to use**: [conditions]
**When NOT to use**: [conditions]
**Confidence**: [high/medium/low]
```

Examples of good pattern names:
- "Shared Cache Image Preloading"
- "DataArrayTexture GPU Upload Batching"
- "Zustand Imperative Subscription"
- "Module-Level Material Deduplication"

## Step 4: Record Anti-Patterns

For each approach that failed or caused issues:

```markdown
### Anti-Pattern: [Name]

**What was done**: [description]
**Why it's wrong**: [explanation]
**What to do instead**: [correct approach]
**Time wasted**: [estimate]
```

## Step 5: Update Metrics

Record before/after measurements:

| Metric | Before | After | Technique |
|--------|--------|-------|-----------|
| Draw calls | 520 | 1 | InstancedMesh |
| Load time | 940ms | 142ms | Shared image cache |
| GPU uploads | 520/load | ~20/load | Dirty flag batching |

## Step 6: Update Knowledge Base

- Add new patterns to `references/ORG_PATTERNS_LIBRARY.md`
- If pattern is critical (affects every session), add to `MEMORY.md`
- If pattern supersedes an existing one, update or remove the old entry
- Cross-reference related patterns
