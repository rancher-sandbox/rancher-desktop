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

# os.bash and utils.bash must be loaded before defaults.bash
source "$PATH_BATS_HELPERS/defaults.bash"

# defaults.bash must be loaded before paths.bash
source "$PATH_BATS_HELPERS/paths.bash"

# paths.bash must be loaded before vm.bash
source "$PATH_BATS_HELPERS/vm.bash"

# vm.bash must be loaded before kubernetes.bash and commands.bash
source "$PATH_BATS_HELPERS/kubernetes.bash"
source "$PATH_BATS_HELPERS/commands.bash"

# Use Linux utilities (like jq) on WSL
export PATH="$PATH_BATS_ROOT/bin/${OS/windows/linux}:$PATH"

# On Linux if we don't shutdown Rancher Desktop the bats test doesn't terminate
teardown_file() {
    run rdctl shutdown
}

# Bug workarounds go here. The goal is to make this an empty file
source "$PATH_BATS_HELPERS/workarounds.bash"
