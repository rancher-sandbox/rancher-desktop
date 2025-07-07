.PHONY: all
all:
	./bats-core/bin/bats --show-output-of-passing-tests ./tests/*/

.PHONY: containers
containers:
	./bats-core/bin/bats --show-output-of-passing-tests ./tests/containers/

# https://www.shellcheck.net/wiki/SC1091 -- Not following: xxx was not specified as input (see shellcheck -x)
# https://www.shellcheck.net/wiki/SC2034 -- xxx appears unused. Verify use (or export if used externally)
# https://www.shellcheck.net/wiki/SC2154 -- xxx is referenced but not assigned

SC_EXCLUDES ?= SC1091,SC2034,SC2154

.PHONY: lint
lint:
	find tests -name '*.bash' | xargs ./scripts/bats-lint.pl
	find tests -name '*.bats' | xargs ./scripts/bats-lint.pl
	find tests -name '*.bash' | xargs shellcheck -s bash -e $(SC_EXCLUDES)
	find tests -name '*.bats' | xargs shellcheck -s bash -e $(SC_EXCLUDES)
	find scripts -name '*.sh' | xargs shellcheck -s bash -e $(SC_EXCLUDES)
	find tests -name '*.bash' | xargs shfmt --simplify --diff --indent 4
	find tests -name '*.bats' | xargs shfmt --simplify --diff --indent 4
	find scripts -name '*.sh' | xargs shfmt --simplify --diff --indent 4

DEPS = bin/darwin/jq bin/linux/jq

# Package bats tests with bats itself and dependencies into a single tarball for distribution
bats.tar.gz: $(DEPS)
	git submodule update --init --recursive
	tar cvfz "$@" --exclude-vcs --exclude "*/test/*" --exclude "*/docs/*" -- *

JQ_VERSION ?= 1.7.1
JQ_URL=https://github.com/stedolan/jq/releases/download/jq-$(JQ_VERSION)

bin/darwin/jq:
	mkdir -p bin/darwin
	wget --no-verbose $(JQ_URL)/jq-osx-amd64 -O $@
	chmod +x $@

bin/linux/jq:
	mkdir -p bin/linux
	wget --no-verbose $(JQ_URL)/jq-linux64 -O $@
	chmod +x $@

.PHONY: clean
clean:
	rm -f $(DEPS)
	rm -f bats.tar.gz
