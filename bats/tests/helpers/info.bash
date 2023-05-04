load load.bash

# This file exists to print information about the configuration just once, e.g.
#
#   bats test/helpers/info.bash tests/*
#
# This can't be done during normal `load` operation because then it would be
# printed for every single test run.

# The info output is wrapped in a dummy test because bats doesn't execute files
# that don't contain at least a single test case.
#
# Also use bash-compatible @test syntax so shellcheck doesn't complain. The file
# uses a `.bash` extension so it is not matched by `tests/*` when running all
# tests; you'll want to run it before all the other tests.

info() { # @test
    echo "Using '$RD_LOCATION' install; resources '$PATH_RESOURCES'" >&3
}
