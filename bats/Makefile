all:
	bats --show-output-of-passing-tests ./tests/*/

containers:
	bats --show-output-of-passing-tests ./tests/containers/

lint:
	@./scripts/bats-lint.pl $(shell find tests -name '*.bats')
