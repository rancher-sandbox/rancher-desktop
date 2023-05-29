set -o errexit -o nounset -o pipefail

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

# paths.bash uses RD_LOCATION from defaults.bash
source "$PATH_BATS_HELPERS/paths.bash"

# commands.bash uses is_containerd() from defaults.bash,
# is_windows() etc from os.bash,
# and PATH_* variables from paths.bash
source "$PATH_BATS_HELPERS/commands.bash"

# vm.bash uses various PATH_* variables from paths.bash
source "$PATH_BATS_HELPERS/vm.bash"

# kubernetes.bash has no load-time dependencies
source "$PATH_BATS_HELPERS/kubernetes.bash"

# Use Linux utilities (like jq) on WSL
export PATH="$PATH_BATS_ROOT/bin/${OS/windows/linux}:$PATH"

global_setup() {
    # Ideally this should be printed only when using the tap formatter,
    # but I don't see a way to check for this.
    echo "# ===== $RD_TEST_FILENAME =====" >&3
}
setup_file() {
    global_setup
}
global_teardown() {
    capture_logs
    # On Linux if we don't shutdown Rancher Desktop the bats test doesn't terminate
    run rdctl shutdown
}
teardown_file() {
    global_teardown
}

# Bug workarounds go here. The goal is to make this an empty file
source "$PATH_BATS_HELPERS/workarounds.bash"
