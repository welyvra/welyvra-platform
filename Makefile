# Run the same checks as pull-request CI before you push. Details: scripts/check.sh.

.PHONY: check fix help

help:
	@echo "make check   run the CI checks (TypeScript and contracts); E2E=1 adds Playwright"
	@echo "make fix     apply automatic fixes (prettier, eslint --fix)"

check:
	@bash scripts/check.sh

fix:
	@bash scripts/check.sh --fix
