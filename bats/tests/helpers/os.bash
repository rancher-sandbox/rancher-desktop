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
    if [ -z "${1-}" ]; then
        test "$OS" = linux
    else
        test "$OS" = linux -a "$ARCH" = "$1"
    fi
}

is_macos() {
    if [ -z "${1-}" ]; then
        test "$OS" = darwin
    else
        test "$OS" = darwin -a "$ARCH" = "$1"
    fi
}

is_windows() {
    if [ -z "${1-}" ]; then
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
        skip "This test is not applicable on Windows."
    fi
}

skip_on_unix() {
    if is_unix; then
        skip "This test is not applicable on MacOS/Linux."
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
