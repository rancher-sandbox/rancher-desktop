set -o errexit -o nounset -o pipefail

# RD_HELPERS_LOADED is set when bats/helpers/load.bash has been loaded
RD_HELPERS_LOADED=1

absolute_path() {
    (
        cd "$1"
        pwd
    )
}

PATH_BATS_HELPERS=$(absolute_path "$(dirname "${BASH_SOURCE[0]}")")
PATH_BATS_ROOT=$(absolute_path "$PATH_BATS_HELPERS/../..")
PATH_BATS_LOGS=$PATH_BATS_ROOT/logs

# RD_TEST_FILENAME is relative to tests/ and strips the .bats extension,
# e.g. "registry/creds" for ".../bats/tests/registry/creds.bats"
RD_TEST_FILENAME=${BATS_TEST_FILENAME#"$PATH_BATS_ROOT/tests/"}
RD_TEST_FILENAME=${RD_TEST_FILENAME%.bats}

# Use fatal() to abort loading helpers; don't run any tests
fatal() {
    echo "   $1" >&3
    exit 1
}

source "$PATH_BATS_ROOT/bats-support/load.bash"
source "$PATH_BATS_ROOT/bats-assert/load.bash"
source "$PATH_BATS_ROOT/bats-file/load.bash"

source "$PATH_BATS_HELPERS/os.bash"
source "$PATH_BATS_HELPERS/utils.bash"

# defaults.bash uses is_windows() from os.bash and
# validate_enum() and is_true() from utils.bash.
source "$PATH_BATS_HELPERS/defaults.bash"

# images.bash uses using_ghcr_images() from defaults.bash
source "$PATH_BATS_HELPERS/images.bash"

# paths.bash uses RD_LOCATION from defaults.bash
source "$PATH_BATS_HELPERS/paths.bash"

# commands.bash uses is_containerd() from defaults.bash,
# is_windows() etc from os.bash,
# and PATH_* variables from paths.bash
source "$PATH_BATS_HELPERS/commands.bash"

# vm.bash uses various PATH_* variables from paths.bash,
# rdctl from commands.bash, and jq_output from utils.bash
source "$PATH_BATS_HELPERS/vm.bash"

# kubernetes.bash has no load-time dependencies
source "$PATH_BATS_HELPERS/kubernetes.bash"

# Use Linux utilities (like jq) on WSL
export PATH="$PATH_BATS_ROOT/bin/${OS/windows/linux}:$PATH"

# If called from foo() this function will call local_foo() if it exist.
call_local_function() {
    local func="local_$(calling_function)"
    if [ "$(type -t "$func")" = "function" ]; then
        eval "$func"
    fi
}

setup_file() {
    # Ideally this should be printed only when using the tap formatter,
    # but I don't see a way to check for this.
    echo "# ===== $RD_TEST_FILENAME =====" >&3

    call_local_function
}

teardown_file() {
    call_local_function

    capture_logs

    # On Linux & Windows if we don't shutdown Rancher Desktop bats test don't terminate
    if is_linux || is_windows; then
        run rdctl shutdown
    fi
}

setup() {
    if [ "${BATS_SUITE_TEST_NUMBER}" -eq 1 ] && [ "$RD_TEST_FILENAME" != "helpers/info.bash" ]; then
        source "$PATH_BATS_HELPERS/info.bash"
        show_info
        echo "#"
    fi

    call_local_function
}

teardown() {
    call_local_function

    if [ -z "$BATS_TEST_SKIPPED" ] && [ -z "$BATS_TEST_COMPLETED" ]; then
        take_screenshot
    fi
}
