#!/usr/bin/env bash

# This script is expected to run as root and install Rancher Desktop from the
# repository obs://isv:Rancher:dev
# Expected environment variables:
#   RD_VERSION
#      Rancher Desktop version; either major.minor (`1.20`) or the tag (`v1.20.0`).

set -o errexit -o nounset

# shellcheck disable=2329 # The function is invoked dynamically
install_linux_debian() {
    local keyLocation=/usr/share version

    if [[ -d /etc/apt/keyrings ]]; then
        keyLocation=/etc/apt
    fi

    apt-get update
    apt-get install -y gnupg
    curl -s https://download.opensuse.org/repositories/isv:/Rancher:/dev/deb/Release.key \
        | gpg --dearmor \
        > "${keyLocation}/keyrings/isv-rancher-dev-archive-keyring.gpg"
    echo "deb [signed-by=${keyLocation}/keyrings/isv-rancher-dev-archive-keyring.gpg] https://download.opensuse.org/repositories/isv:/Rancher:/dev/deb/ ./"\
        > /etc/apt/sources.list.d/isv-rancher-dev.list
    apt-get update
    version=$(apt-cache show --quiet rancher-desktop \
        | awk -F': ' "/^Version: 0\.release${RD_VERSION//./\\.}\./ { print \$2 }")
    if [[ -z "${version}" ]]; then
        echo "Could not find any versions of rancher-desktop" >&2
        exit 1
    fi
    apt-get install -y "rancher-desktop=${version}"
}

# shellcheck disable=2329 # The function is invoked dynamically
install_linux_opensuse() {
    zypper --non-interactive addrepo https://download.opensuse.org/repositories/isv:/Rancher:/dev/rpm/isv:Rancher:dev.repo
    zypper --non-interactive --gpg-auto-import-keys install libxml2-tools
    local version
    version=$(zypper --xmlout --non-interactive search --details --match-exact rancher-desktop \
        | xmllint --xpath "string(//solvable[@kind='package']/@edition[contains(., '0.release${RD_VERSION}.')])" -)
    zypper --non-interactive install "rancher-desktop=${version}"
}

# shellcheck disable=2329 # The function is invoked dynamically
install_linux_fedora() {
    dnf config-manager addrepo --from-repofile=https://download.opensuse.org/repositories/isv:/Rancher:/dev/fedora/isv:Rancher:dev.repo
    local version
    version=$(dnf --quiet info --showduplicates rancher-desktop.x86_64 \
        | awk -F: "\$1 ~ /Version/ && \$2 ~ /0\.release${RD_VERSION//./\\.}/ { print \$2 }" \
        | tr -d '[:space:]')
    dnf --assumeyes install "rancher-desktop-${version}"
}

main() {
    RD_VERSION=$(grep --only-matching '\([0-9]\+\.[0-9]\+\)' <<< "$RD_VERSION")
    source /etc/os-release
    for id in ${ID:-} ${ID_LIKE:-}; do
        if [[ "$(type -t "install_linux_$id")" == function ]]; then
            eval "install_linux_$id"
            exit 0
        fi
    done
    printf "Could not find supported distribution in %s\n" "${ID:-} ${ID_LIKE:-}" >&2
    exit 1
}

main
