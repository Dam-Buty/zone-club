#!/bin/bash
# =============================================================================
# Post-Commit Skillcraft Hook
# =============================================================================
# Claude Code PostToolUse hook: detects git commits and triggers skill
# capitalization. Outputs structured context so Claude proposes updates
# to skills, MEMORY.md, and the patterns library.
#
# Respects Anthropic guidelines:
# - Hook only SUGGESTS updates, Claude + user decide what to write
# - No external network calls, no data exfiltration
# - Infinite-loop guard: skips commits tagged [skillcraft]
# - Transparent: all output is visible to the user
# =============================================================================

set -euo pipefail

# Read tool input from stdin (JSON piped by Claude Code)
INPUT=$(cat)

# Extract command that was executed
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only trigger on successful git commit commands
if ! echo "$COMMAND" | grep -qE '^git commit'; then
  exit 0
fi

# Check exit code — only proceed if commit succeeded
EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_response.exit_code // .tool_response.exitCode // "1"' 2>/dev/null)
if [[ "$EXIT_CODE" != "0" ]]; then
  exit 0
fi

# Get commit details
COMMIT_HASH=$(git log -1 --pretty=format:"%h" 2>/dev/null || echo "unknown")
COMMIT_MSG=$(git log -1 --pretty=format:"%s" 2>/dev/null || echo "unknown")
COMMIT_BODY=$(git log -1 --pretty=format:"%b" 2>/dev/null || echo "")
FILES_CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | head -30)
STATS=$(git diff-tree --no-commit-id --stat -r HEAD 2>/dev/null | tail -1)

# Infinite-loop guard: skip if commit is a skillcraft update itself
if echo "$COMMIT_MSG" | grep -qiE '\[skillcraft\]|skillcraft:|skill capitalization'; then
  exit 0
fi

# Count source files changed (not docs/skills/config)
SRC_FILES=$(echo "$FILES_CHANGED" | grep -cE '^src/' 2>/dev/null || echo "0")
SKILL_FILES=$(echo "$FILES_CHANGED" | grep -cE '\.claude/skills/' 2>/dev/null || echo "0")

# Only trigger capitalization if source files were changed (meaningful work)
if [[ "$SRC_FILES" -eq 0 ]] && [[ "$SKILL_FILES" -eq 0 ]]; then
  exit 0
fi

# Output structured context for Claude
cat <<SKILLCRAFT_EOF
{
  "additionalContext": "POST-COMMIT SKILLCRAFT: Commit ${COMMIT_HASH} completed successfully.\n\nCommit: ${COMMIT_HASH} — ${COMMIT_MSG}\nFiles changed: ${STATS}\nSource files: ${SRC_FILES} | Skill files: ${SKILL_FILES}\n\nChanged files:\n${FILES_CHANGED}\n\nPlease run a quick skill capitalization pass:\n1. Review the changes in commit ${COMMIT_HASH}\n2. If NEW patterns or techniques were used, add them to .claude/skills/webgpu-skillcraft/references/ORG_PATTERNS_LIBRARY.md\n3. If CRITICAL lessons were learned (would affect every future session), update MEMORY.md\n4. If an existing pattern was refined or superseded, update/remove the old entry\n5. Keep updates concise — only add genuinely reusable knowledge\n6. If nothing new was learned (routine changes), just say 'No new patterns to capitalize' and move on\n\nIMPORTANT: Do NOT commit skill updates automatically. Propose changes and let the user decide."
}
SKILLCRAFT_EOF
