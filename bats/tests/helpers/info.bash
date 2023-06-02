# shellcheck disable=SC2059
# https://www.shellcheck.net/wiki/SC2059 -- Don't use variables in the printf format string. Use printf '..%s..' "$foo".
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

predicate() {
    if eval "$1"; then
        echo "true"
    else
        echo "false"
    fi
}

info() { # @test
    if capturing_logs || taking_screenshots; then
        rm -rf "$PATH_BATS_LOGS"
    fi
    (
        local format="# %-25s %s\n"

        printf "$format" "Install location:" "$RD_LOCATION"
        printf "$format" "Resources path:" "$PATH_RESOURCES"
        echo "#"
        printf "$format" "Container engine:" "$RD_CONTAINER_ENGINE"
        printf "$format" "Using image allow list:" "$(predicate using_image_allow_list)"
        if is_macos; then
            printf "$format" "Using VZ emulation:" "$(predicate using_vz_emulation)"
        fi
        if is_windows; then
            printf "$format" "Using Windows executables:" "$(predicate using_windows_exe)"
            printf "$format" "Using networking tunnel:" "$(predicate using_networking_tunnel)"
        fi
        echo "#"
        printf "$format" "Capturing logs:" "$(predicate capturing_logs)"
        printf "$format" "Taking screenshots:" "$(predicate taking_screenshots)"
    ) >&3
}

# Disable global setup/teardown functions because we are not running Rancher Desktop.
setup_file() { true; }
teardown_file() { true; }
