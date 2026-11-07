#!/usr/bin/env bash
# Run locally the same checks the CI workflows (.github/workflows/) run.
#
#   make check          lint, typecheck, test, build (TypeScript and Rust contracts)
#   E2E=1 make check    also the reproducible demo and Playwright end-to-end tests
#   make fix            apply automatic fixes (formatting, autofixable lint rules)
#
# Database tests need PostgreSQL: docker compose -f infra/docker/compose.yml up -d
# When the CI workflow changes, update this script in the same pull request.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; RESET=""
fi

if [ "${1:-}" = "--fix" ]; then
  pnpm exec prettier --write . && pnpm exec eslint --fix .
  exit $?
elif [ -n "${1:-}" ]; then
  echo "usage: scripts/check.sh [--fix]" >&2
  exit 2
fi

# Same throwaway database as CI and infra/docker/compose.yml (local only, not a secret).
export DATABASE_URL="${DATABASE_URL:-postgres://welyvra:welyvra@localhost:54329/welyvra}"

PASSED=()
FAILED=()
run() {
  local label="$1"
  shift
  printf '\n%s==> %s%s\n' "$BOLD" "$label" "$RESET"
  if "$@"; then PASSED+=("$label"); else FAILED+=("$label"); fi
}

run "Lint (prettier + eslint)" pnpm lint
run "Typecheck" pnpm typecheck
run "Unit and database tests" pnpm test
run "Build" pnpm build
# Homebrew's rustup does not put cargo on PATH; ask rustup where it is.
if ! command -v cargo >/dev/null 2>&1 && command -v rustup >/dev/null 2>&1; then
  PATH="$(dirname "$(rustup which cargo 2>/dev/null)"):$PATH"
fi
if command -v cargo >/dev/null 2>&1; then
  run "Contracts: format" bash -c 'cd apps/contracts && cargo fmt --all -- --check'
  run "Contracts: lint" bash -c 'cd apps/contracts && cargo clippy --locked --all-targets -- -D warnings'
  run "Contracts: test" bash -c 'cd apps/contracts && cargo test --locked'
  if command -v stellar >/dev/null 2>&1; then
    run "Contracts: build (WASM)" bash -c 'cd apps/contracts && stellar contract build --locked'
  else
    FAILED+=("Contracts: build (stellar CLI not found: brew install stellar-cli)")
  fi
else
  FAILED+=("Contracts (cargo not found: install Rust with rustup, see apps/contracts/README.md)")
fi
if [ "${E2E:-}" = "1" ]; then
  run "Demo on recorded testnet events" node scripts/demo/demo.ts
  run "End-to-end (Playwright)" pnpm e2e
fi

printf '\n%sSummary%s\n' "$BOLD" "$RESET"
for s in "${PASSED[@]}"; do printf '  %spass%s  %s\n' "$GREEN" "$RESET" "$s"; done
for s in "${FAILED[@]+"${FAILED[@]}"}"; do printf '  %sFAIL%s  %s\n' "$RED" "$RESET" "$s"; done
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n%s%d check(s) failed.%s\n' "$RED" "${#FAILED[@]}" "$RESET"
  exit 1
fi
printf '\n%sAll checks passed.%s\n' "$GREEN" "$RESET"
