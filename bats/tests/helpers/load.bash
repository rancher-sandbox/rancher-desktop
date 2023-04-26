set -o errexit -o nounset -o pipefail

# Get absolute path names for current and top directories
PATH_BATS_HELPERS=$(
    cd "$(dirname "${BASH_SOURCE[0]}")"
    pwd
)
PATH_BATS_ROOT=$(
    cd "$PATH_BATS_HELPERS/../.."
    pwd
)

source "$PATH_BATS_ROOT/bats-support/load.bash"
source "$PATH_BATS_ROOT/bats-assert/load.bash"
source "$PATH_BATS_ROOT/bats-file/load.bash"

# "defaults.bash" *must* be sourced before the rest of the files
source "$PATH_BATS_HELPERS/defaults.bash"
source "$PATH_BATS_HELPERS/utils.bash"
source "$PATH_BATS_HELPERS/os.bash"
source "$PATH_BATS_HELPERS/paths.bash"

# "vm.bash" must be loaded first to define `using_containerd` etc
source "$PATH_BATS_HELPERS/vm.bash"
source "$PATH_BATS_HELPERS/kubernetes.bash"
source "$PATH_BATS_HELPERS/commands.bash"

# Use Linux utilities (like jq) on WSL
export PATH="$PATH_BATS_ROOT/bin/${OS/windows/linux}:$PATH"
