---
name: implement-issue
description: Implement a GitHub issue end to end on a branch and open a PR. Use when asked to work on issue #n.
disable-model-invocation: true
---

# /implement-issue <n>

1. `gh issue view <n>`; stop if acceptance criteria or tests are missing and propose them instead.
2. Check dependencies listed in the issue are closed.
3. `git switch -c feat/<n>-<slug>` from an up-to-date `main`.
4. Write failing tests for the acceptance criteria and invariants; then implement.
5. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; fix until green. Do not skip or weaken tests.
6. Update docs if behavior changed.
7. If the change touches money, auth, ingestion, webhooks, CI or dependencies, run `/security-check`.
8. Commit, push the branch, `gh pr create` using the template (Closes #n, real test output, risks).
9. Report the PR URL. Never merge.
