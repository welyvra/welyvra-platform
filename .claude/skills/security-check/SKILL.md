---
name: security-check
description: Run a focused security and financial-correctness check on the current branch's changes.
---

# /security-check

1. `git diff main...HEAD --stat` and the full diff.
2. Run the security-reviewer agent on the diff with docs/architecture/threat-model.md.
3. Search the diff for secrets (`key|secret|token|seed|password|PRIVATE`), and for `pull_request_target` or `${{` inside `run:` blocks in workflows.
4. Report findings by severity; list which threat-model rows are affected and whether the threat model needs an update.
