#!/usr/bin/env bash

# Run BATS against a list of k3s versions.
#
# It will factory reset, so the current VM and settings will be lost.
# Snapshots however should be preserved.

set -o errexit -o nounset -o pipefail

# VERSIONS is the list of versions to test, e.g. "1.28.6 1.29.1".
# Special value "all" will be replaced with all available tags from GitHub.
# Special value "latest" will be replaced with versions from the release channel.
#
# Downloading the airgap tarballs for all k3s releases take almost 50GB, so
# make sure you have good bandwidth and enough storage. Maybe save the cache
# for re-use before running BATS tests that will clear the cache.
: "${VERSIONS:=}"

# TEST can specify a filename with additional test commands. It will be sourced
# after kubelet is responsive.
: "${TEST:=}"

# The VERSIONS list can be filtered by MIN and MAX versions. The MIN and MAX
# versions themselves will not be filtered out.
: "${MIN_VERSION:=1.0.0}"
: "${MAX_VERSION:=1.999.0}"

# When SKIP_RUN is non-empty then the tests will not be executed, but the script
# filename will be written to stdout. Otherwise the script will be deleted.
: "${SKIP_RUN:=}"

# By default the BATS kubelet timeout is 10 minutes. If the test is expected to
# fail starting up k3s a lot, then reducing the timeout it highly recommended
# (there are almost 200 k3s versions).
: "${RD_KUBELET_TIMEOUT:=2}"
export RD_KUBELET_TIMEOUT

if [[ $VERSIONS == "all" ]]; then
    # filter out duplicates; RD only supports the latest of +k3s1, +k3s2, etc.
    VERSIONS=$(
        gh api /repos/k3s-io/k3s/releases --paginate --jq '.[].tag_name' |
            grep -E '^v1\.[0-9]+\.[0-9]+\+k3s[0-9]+$' |
            sed -E 's/v([^+]+)\+.*/\1/' |
            sort --unique --version-sort
    )
fi

if [[ $VERSIONS == "latest" ]]; then
    VERSIONS=$(
        curl --silent https://update.k3s.io/v1-release/channels |
            jq --raw-output '.data[] | select(.name | test("^v[0-9]+\\.[0-9]+$")).latest' |
            sed -E 's/v([^+]+)\+.*/\1/'
    )
fi

# PATH_BATS is the location of the bats/ directory in the rancher-desktop repo.
# This script is in the bats/scripts/ subdirectory.
PATH_BATS=$(
    cd "$(dirname "${BASH_SOURCE[0]}")/.."
    pwd
)

SCRIPT=$(mktemp)

cat >"$SCRIPT" <<EOF
load '${PATH_BATS}/tests/helpers/load'

check() {
    RD_KUBERNETES_PREV_VERSION=\$BATS_TEST_DESCRIPTION
    factory_reset
    start_kubernetes
    wait_for_kubelet
EOF

# Source $TEST as part of the test for each k3s version
if [[ -f $TEST ]]; then
    TEST=$(
        cd "$(dirname "$TEST")"
        pwd
    )/$(basename "$TEST")
    echo "    source \"${TEST}\"" >>"$SCRIPT"
fi

cat >>"$SCRIPT" <<'EOF'
}

EOF

# Execute check() for each k3s version within the (inclusive) MIN/MAX range
for VERSION in $VERSIONS; do
    if printf "%s\n" "$MIN_VERSION" "$VERSION" "$MAX_VERSION" | sort --check=silent --version-sort; then
        echo "@test '$VERSION' { check; }" >>"$SCRIPT"
    fi
done

if [[ -z $SKIP_RUN ]]; then
    time "${PATH_BATS}/bats-core/bin/bats" \
        "${PATH_BATS}/tests/helpers/info.bash" \
        "$SCRIPT"
    rm "$SCRIPT"
else
    echo "$SCRIPT"
fi
