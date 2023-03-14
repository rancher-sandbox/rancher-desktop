helpers="$(dirname "${BASH_SOURCE[0]}")"
topdir="$helpers/../.."

set -o errexit -o nounset -o pipefail

source "$topdir/bats-support/load.bash"
source "$topdir/bats-assert/load.bash"
source "$topdir/bats-file/load.bash"

# "defaults.bash" *must* be sourced before the rest of the files
source "$helpers/defaults.bash"
source "$helpers/utils.bash"
source "$helpers/os.bash"
source "$helpers/paths.bash"

# "vm.bash" must be loaded first to define `using_containerd` etc
source "$helpers/vm.bash"
source "$helpers/kubernetes.bash"
source "$helpers/commands.bash"
