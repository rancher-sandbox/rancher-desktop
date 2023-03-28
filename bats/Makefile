all:
	bats --show-output-of-passing-tests ./tests/*/

containers:
	bats --show-output-of-passing-tests ./tests/containers/

# https://www.shellcheck.net/wiki/SC1091 -- Not following: xxx was not specified as input (see shellcheck -x)
# https://www.shellcheck.net/wiki/SC2034 -- xxx appears unused. Verify use (or export if used externally)
# https://www.shellcheck.net/wiki/SC2154 -- xxx is referenced but not assigned
# https://www.shellcheck.net/wiki/SC2155 -- Declare and assign separately to avoid masking return values

SC_EXCLUDES ?= SC1091,SC2034,SC2154,SC2155

lint:
	@./scripts/bats-lint.pl $(shell find tests -name '*.bats')
	find tests -name '*.bash' | xargs shellcheck -s bash -e $(SC_EXCLUDES)
	find tests -name '*.bats' | xargs shellcheck -s bash -e $(SC_EXCLUDES)
