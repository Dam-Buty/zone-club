---
name: webgpu-skillcraft
description: "Meta-skill for capitalizing on WebGPU/Three.js project learnings. Use to create postmortem logs, extract reusable patterns from commits/features, and maintain an organized pattern library. Manual invocation only via /webgpu-skillcraft."
disable-model-invocation: true
---

# WebGPU Skillcraft

Capitalize learnings from WebGPU/Three.js projects into reusable, organized patterns. This skill turns debugging sessions, feature implementations, and performance wins into a searchable knowledge base.

## When to invoke

- After completing a feature or significant refactor
- After a debugging session (especially one that took longer than expected)
- After a performance optimization pass with before/after metrics
- Periodic knowledge review (weekly or per-milestone)

## Actions

### 1. Create a success/failure log

Document what happened during a feature or debugging session using the structured template.

- Open `references/PROJECT_SUCCESS_LOG_TEMPLATE.md`
- Fill in each section honestly (failures are the most valuable part)
- Save the completed log in `docs/logs/` with format `LOG-YYYY-MM-DD-<slug>.md`

### 2. Capitalize a commit or feature

Extract reusable knowledge from a specific commit, PR, or feature branch.

- Follow the 6-step process in `references/COMMIT_FEATURE_CAPITALIZATION.md`
- For each pattern discovered, add it to the pattern library
- For each anti-pattern, document it with a clear "never do this" warning
- Update `MEMORY.md` if the pattern is critical enough for every-session recall

### 3. Browse and update the pattern library

Maintain the organized index of all discovered patterns.

- Open `references/ORG_PATTERNS_LIBRARY.md`
- Patterns are grouped by category: Rendering, Assets, Instancing, React/R3F, Debugging
- Each pattern has: name, problem, solution, when to use / when NOT to use
- Remove patterns that have been superseded or proven wrong
- Add cross-references between related patterns

## References

- [Project Success Log Template](references/PROJECT_SUCCESS_LOG_TEMPLATE.md)
- [Commit/Feature Capitalization Process](references/COMMIT_FEATURE_CAPITALIZATION.md)
- [Organized Patterns Library](references/ORG_PATTERNS_LIBRARY.md)

## Output

After running any action, produce a short summary of:
- How many new patterns were added or updated
- Which files were modified (MEMORY.md, ORG_PATTERNS_LIBRARY.md, log files)
- Any follow-up items or technical debt flagged
