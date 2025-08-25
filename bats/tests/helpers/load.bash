set -o errexit -o nounset -o pipefail

# Make sure run() will execute all functions with errexit enabled
export BATS_RUN_ERREXIT=1

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
    local fd=2
    # fd 3 might not be open if we're not fully under bats yet; detect that.
    [[ -e /dev/fd/3 ]] && fd=3
    echo "   $1" >&$fd

    # Print (ugly) stack trace if we are outside any @test function
    if [ -z "${BATS_SUITE_TEST_NUMBER:-}" ]; then
        echo >&$fd
        local frame=0
        while caller $frame >&$fd; do
            ((frame++))
        done
    fi
    exit 1
}

source "$PATH_BATS_ROOT/bats-support/load.bash"
source "$PATH_BATS_ROOT/bats-assert/load.bash"
source "$PATH_BATS_ROOT/bats-file/load.bash"

source "$PATH_BATS_HELPERS/os.bash"
source "$PATH_BATS_HELPERS/utils.bash"
source "$PATH_BATS_HELPERS/snapshots.bash"

# kubernetes.bash has no load-time dependencies
source "$PATH_BATS_HELPERS/kubernetes.bash"

# defaults.bash uses is_windows() from os.bash and
# validate_enum() and is_true() from utils.bash.
# get_k3s_versions from kubernetes.bash.
source "$PATH_BATS_HELPERS/defaults.bash"

# images.bash uses using_ghcr_images() from defaults.bash
source "$PATH_BATS_HELPERS/images.bash"

# paths.bash uses RD_LOCATION from defaults.bash
source "$PATH_BATS_HELPERS/paths.bash"

# commands.bash uses is_containerd() from defaults.bash,
# is_windows() etc from os.bash,
# and PATH_* variables from paths.bash
source "$PATH_BATS_HELPERS/commands.bash"

# profile.bash uses is_xxx() from os.bash
source "$PATH_BATS_HELPERS/profile.bash"

# vm.bash uses various PATH_* variables from paths.bash,
# rdctl from commands.bash, and jq_output from utils.bash
source "$PATH_BATS_HELPERS/vm.bash"

# Add BATS helper executables to $PATH.  On Windows, we use the Linux version
# from WSL.
export PATH="$PATH_BATS_ROOT/bin/${OS/windows/linux}:$PATH"

# If called from foo() this function will call local_foo() if it exist.
call_local_function() {
    local func
    func="local_$(calling_function)"
    if [ "$(type -t "$func")" = "function" ]; then
        "$func"
    fi
}

setup_file() {
    # We require bash 4; bash 3.2 (as shipped by macOS) seems to have
    # compatibility issues.
    if semver_gt 4.0.0 "$(semver "$BASH_VERSION")"; then
        fail "Bash 4.0.0 is required; you have $BASH_VERSION"
    fi
    # We currently use a submodule that provides BATS 1.10; we do not test
    # against any other copy of BATS (and therefore only support the version in
    # that submodule).
    bats_require_minimum_version 1.10.0
    # Ideally this should be printed only when using the tap formatter,
    # but I don't see a way to check for this.
    echo "# ===== $RD_TEST_FILENAME =====" >&3

    # local_setup_file may override RD_USE_RAMDISK
    call_local_function

    setup_ramdisk
}

teardown_file() {
    capture_logs

    local shutdown=false
    if is_linux || is_windows; then
        # On Linux & Windows if we don't shutdown Rancher Desktop bats tests don't terminate.
        shutdown=true
    elif using_dev_mode; then
        # In dev mode, we also need to shut down.
        shutdown=true
    elif using_ramdisk; then
        # When using a ramdisk, we need to shut down to clean up.
        shutdown=true
    fi
    if is_true $shutdown; then
        rdctl shutdown || :
    fi

    teardown_ramdisk

    call_local_function
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
    if [ -z "$BATS_TEST_SKIPPED" ] && [ -z "$BATS_TEST_COMPLETED" ]; then
        capture_logs
        take_screenshot
    fi

    call_local_function
}
