# https://www.shellcheck.net/wiki/SC2120 -- disabled due to complaining about not referencing arguments that are optional on functions is_platformName
# shellcheck disable=SC2120
UNAME=$(uname)
ARCH=$(uname -m)

case $UNAME in
Darwin)
    # OS matches the directory name of the PATH_RESOURCES directory,
    # so uses "darwin" and not "macos".
    OS=darwin
    ;;
Linux)
    if [[ $(uname -a) =~ microsoft ]]; then
        OS=windows
    else
        OS=linux
    fi
    ;;
*)
    echo "Unexpected uname: $UNAME" >&2
    exit 1
    ;;
esac

is_linux() {
    if [ -z "${1:-}" ]; then
        test "$OS" = linux
    else
        test "$OS" = linux -a "$ARCH" = "$1"
    fi
}

is_macos() {
    if [ -z "${1:-}" ]; then
        test "$OS" = darwin
    else
        test "$OS" = darwin -a "$ARCH" = "$1"
    fi
}

is_windows() {
    if [ -z "${1:-}" ]; then
        test "$OS" = windows
    else
        test "$OS" = windows -a "$ARCH" = "$1"
    fi
}

is_unix() {
    ! is_windows "$@"
}

skip_on_windows() {
    if is_windows; then
        skip "${1:-This test is not applicable on Windows.}"
    fi
}

skip_on_unix() {
    if is_unix; then
        skip "${1:-This test is not applicable on macOS/Linux.}"
    fi
}

needs_port() {
    local port=$1
    if is_linux; then
        if [ "$(sysctl -n net.ipv4.ip_unprivileged_port_start)" -gt "$port" ]; then
            # Run sudo non-interactive, so don't prompt for password
            run sudo -n sysctl -w "net.ipv4.ip_unprivileged_port_start=$port"
            if ((status > 0)); then
                skip "net.ipv4.ip_unprivileged_port_start must be $port or less"
            fi
        fi
    fi
}

sudo_needs_password() {
    # Check if we can run /usr/bin/true (or /bin/true) without requiring a password
    run sudo --non-interactive --reset-timestamp true
    ((status != 0))
}

supports_vz_emulation() {
    if is_macos; then
        version=$(/usr/bin/sw_vers -productVersion)
        # Make sure the version has at least 2 dots because
        # sometimes the reported version is just e.g. 12.7 or 14.0.
        until [[ $version =~ \..+\. ]]; do
            version="${version}.0"
        done
        major_minor_version=${version%.*}
        major_version=${major_minor_version%.*}
        minor_version=${major_minor_version#*.}
        if ((major_version >= 14)); then
            return 0
        elif ((major_version == 13)); then
            # Versions 13.0.x .. 13.2.x work only on x86_64, not aarch64
            if ((minor_version >= 3)) || [[ $(uname -m) == x86_64 ]]; then
                return 0
            fi
        fi
    fi
    return 1
}
