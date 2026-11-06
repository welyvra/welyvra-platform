# Contributing

Thanks for your interest. Welyvra is early; the most useful contributions right now are feedback on the architecture and real-world reconciliation problems you have seen on Stellar.

## Ground rules

- Discuss in an issue before large changes.
- One issue per PR. Fill in the PR template, including how you tested.
- Financial code must follow the invariants in [docs/architecture/data-model.md](docs/architecture/data-model.md): integer amounts, idempotent writes, append-only ledger.
- Tests must fail when the invariant they protect is broken.
- Do not add dependencies without explaining why in the PR.
- Never include secrets, private keys or real customer data, even in tests. Use testnet and fake data.

## Development

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

## Branches and commits

- Branches: `feat/<issue>-slug`, `fix/<issue>-slug`, `docs/<issue>-slug`.
- PRs are squash-merged into `main` by a maintainer after CI passes and review.

By contributing you agree that your contributions are licensed under Apache-2.0 and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
