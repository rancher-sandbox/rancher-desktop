set -o errexit -o nounset -o pipefail

absolute_path() {
    (
        cd "$1"
        pwd
    )
}

PATH_BATS_HELPERS=$(absolute_path "$(dirname "${BASH_SOURCE[0]}")")
PATH_BATS_ROOT=$(absolute_path "$PATH_BATS_HELPERS/../..")

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

global_teardown() {
    # On Linux if we don't shutdown Rancher Desktop the bats test doesn't terminate
    run rdctl shutdown
}
teardown_file() {
    global_teardown
}

# Bug workarounds go here. The goal is to make this an empty file
source "$PATH_BATS_HELPERS/workarounds.bash"
