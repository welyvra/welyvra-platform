---
name: review-pr
description: Review a pull request for correctness, tests, scope and security before the founder merges it.
---

# /review-pr <n>

1. `gh pr view <n>` and `gh pr diff <n>`; `gh pr checks <n>`.
2. Confirm it is linked to an issue and stays within its scope.
3. Verify tests actually exercise the acceptance criteria and would fail if broken.
4. Check financial rules (.claude/rules/financial-correctness.md).
5. For risky areas, delegate to the security-reviewer agent; for test gaps, to qa-engineer.
6. Output: verdict (approve / changes needed), findings with file:line, in Spanish for the founder. Do not merge.
