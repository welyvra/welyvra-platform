---
name: release-check
description: Verify the repository is ready to tag a release: CI green, changelog, docs match capabilities, no secrets, dependencies reviewed.
disable-model-invocation: true
---

# /release-check <version>

1. `gh run list --branch main --limit 5`: latest CI must be green.
2. List merged PRs since the last tag; draft release notes.
3. Check README and docs claim only what tests prove.
4. Check dependencies (`pnpm audit --prod`) and open Dependabot alerts.
5. Confirm no mainnet configuration or real keys are present.
6. Show the founder the notes and ask for approval before `gh release create`.
