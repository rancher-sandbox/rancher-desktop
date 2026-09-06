#!/usr/bin/env bash

# Collect the evidence that BATS's own capture misses when a job fails.
# capture_logs() runs inside BATS, so it records nothing for a job that fails
# before Run BATS starts, or for the test that hangs until that step times
# out.  The workflow runs this script even when Run BATS failed or never ran.
#
# Ported from rancher-desktop-2's rdd/scripts/collect-bats-logs.sh and the
# non-destructive half of its rdd/scripts/bats-with-timeout.sh.
#
# Usage: collect-logs.sh <output-dir>

# Deliberately no errexit: a diagnostic must never abort part-way and take the
# rest of the evidence with it.
set -o nounset
shopt -s nullglob

output_dir=${1:?usage: collect-logs.sh <output-dir>}
mkdir -p "$output_dir"
bundle="$output_dir/support-bundle.log"

# Convert a Windows path from the environment into the form Git Bash uses.
win32_path() {
    cygpath --unix "$1" 2>/dev/null
}

exe=
case "$(uname -s)" in
Darwin)
    platform=darwin
    app_home="$HOME/Library/Application Support/rancher-desktop"
    log_dir="$HOME/Library/Logs/rancher-desktop"
    resources="/Applications/Rancher Desktop.app/Contents/Resources/resources"
    ;;
Linux)
    platform=linux
    app_home="$HOME/.local/share/rancher-desktop"
    log_dir="$app_home/logs"
    resources="/opt/rancher-desktop/resources/resources"
    ;;
*)
    platform=win32
    exe=.exe
    # Stop Git Bash rewriting rdctl's /v1/... API paths, and the guest path
    # /usr/local/bin/wsl-exec, into Windows paths when it starts a native
    # program.
    export MSYS2_ARG_CONV_EXCL='*'
    app_home="$(win32_path "${LOCALAPPDATA:-}")/rancher-desktop"
    log_dir="$app_home/logs"
    resources="$(win32_path "${PROGRAMFILES:-}")/Rancher Desktop/resources/resources"
    ;;
esac

# The probes run under a timeout when one exists, because the failures that
# this bundle explains are the ones where something hangs.  Homebrew's
# coreutils installed timeout only as gtimeout before 2019.
timeout_cmd=
for candidate in timeout gtimeout; do
    if command -v "$candidate" >/dev/null; then
        timeout_cmd=$candidate
        break
    fi
done

with_timeout() {
    local seconds=$1
    shift
    if [[ -n $timeout_cmd ]]; then
        # --verbose makes timeout print a line when it kills a hung probe.
        # Without that line, the probe's section looks like an empty answer.
        set -- "$timeout_cmd" --kill-after=1 --verbose "$seconds" "$@"
    fi
    "$@" 2>&1
}

# Copy the application logs.  On Unix the lima logs are symlinks into the VM
# directory; cp copies what they point to, and a dangling one fails quietly.
if [[ -d $log_dir ]]; then
    mkdir -p "$output_dir/logs"
    cp -L "$log_dir"/*.log "$output_dir/logs/" 2>/dev/null
fi

# Copy the logs of every lima instance still on disk.  BATS copies them too,
# except for a test that hangs until the Run BATS step times out.
for vm_dir in "$app_home"/lima/*/; do
    vm_name=$(basename "$vm_dir")
    [[ $vm_name == _config ]] && continue
    mkdir -p "$output_dir/lima-$vm_name"
    cp "$vm_dir"/*.log "$output_dir/lima-$vm_name/" 2>/dev/null
done

# Evidence of memory pressure or an external kill.  macOS jetsam and the Linux
# OOM killer both use SIGKILL, which does not leave a crash log, so without
# this a process that vanished for want of memory looks like one that hung.
dump_memory_pressure() {
    if [[ $platform == win32 ]]; then
        echo "=== Memory: not collected on Windows ==="
        return
    fi

    echo "=== Memory stats ==="
    case "$platform" in
    darwin)
        vm_stat 2>&1
        # spell-checker:disable-next-line
        sysctl vm.swapusage 2>&1
        ;;
    linux)
        free -h 2>&1
        ;;
    esac

    echo
    echo "=== Top processes by memory ==="
    case "$platform" in
    darwin)
        top -l 1 -n 20 -o mem -stats pid,command,mem,state 2>&1 | tail -25
        ;;
    linux)
        ps -eo pid,pgid,pmem,rss,comm --sort=-rss 2>&1 | head -21
        ;;
    esac

    echo
    echo "=== Memory pressure / OOM events ==="
    case "$platform" in
    darwin)
        # The window matches the job's timeout-minutes in bats.yaml, so it
        # reaches the start of a Run BATS step that hung until its timeout.
        # Keep every line, because housekeeping messages match too and a tail
        # would drop an early kill.
        local predicate
        # spell-checker:disable-next-line
        predicate='(sender == "kernel") AND ((eventMessage CONTAINS[c] "jetsam") OR (eventMessage CONTAINS[c] "memorystatus") OR (eventMessage CONTAINS[c] "low swap") OR (eventMessage CONTAINS[c] "lowmem"))'
        log show --style compact --last 150m --predicate "$predicate" 2>&1
        ;;
    linux)
        # dmesg needs root where kernel.dmesg_restrict is set.  Its stderr
        # reaches the bundle, so a failure cannot pass for "no OOM kills".
        sudo --non-interactive dmesg | grep -iE 'OOM|killed process|out of memory' | tail -50
        ;;
    esac
}

dump_sockets() {
    if command -v ss >/dev/null; then
        echo "=== Open sockets (ss) ==="
        # ss names other users' processes only as root.
        with_timeout 30 sudo --non-interactive ss --all --tcp --udp --processes --numeric
    elif command -v lsof >/dev/null; then
        echo "=== Open sockets (lsof) ==="
        # lsof lists other users' sockets only as root.
        with_timeout 30 sudo --non-interactive lsof -i -P -n
    else
        echo "=== Open sockets: skipped because neither ss nor lsof is installed ==="
    fi
}

# Run these probes without a status check first.  In the hangs that this
# bundle is for, the server is alive but one request path is stuck.  A status
# check on that path would time out and skip the probes that still answer.
dump_api_state() {
    local rdctl="$resources/$platform/bin/rdctl$exe"
    if [[ ! -x $rdctl ]]; then
        echo "=== rdctl: skipped because $rdctl is missing ==="
        return
    fi

    echo "=== rdctl api /v1/backend_state ==="
    with_timeout 10 "$rdctl" api /v1/backend_state

    echo
    echo "=== rdctl list-settings ==="
    with_timeout 10 "$rdctl" list-settings

    echo
    echo "=== rdctl api /v1/diagnostic_checks ==="
    with_timeout 15 "$rdctl" api /v1/diagnostic_checks
}

dump_lima_guest() {
    local limactl="$resources/$platform/lima/bin/limactl"
    if [[ ! -x $limactl ]]; then
        echo "=== Guest: skipped because $limactl is missing ==="
        return
    fi
    # limactl talks to the VM directly, so it still answers after the Rancher
    # Desktop process itself is gone.
    local -x LIMA_HOME="$app_home/lima"

    echo "=== Guest: rc-status ==="
    with_timeout 20 "$limactl" shell 0 sudo rc-status --all

    echo
    echo "=== Guest: ps ==="
    with_timeout 20 "$limactl" shell 0 ps -ef

    echo
    echo "=== Guest: dmesg ==="
    with_timeout 20 "$limactl" shell 0 sudo dmesg | tail -100
}

dump_wsl_guest() {
    if ! command -v wsl.exe >/dev/null; then
        echo "=== Guest: skipped because wsl.exe is missing ==="
        return
    fi
    # Without WSL_UTF8, wsl.exe writes UTF-16LE.
    local -x WSL_UTF8=1

    echo "=== wsl --list --verbose ==="
    with_timeout 20 wsl.exe --list --verbose

    echo
    echo "=== wsl --list --running ==="
    local running
    running=$(with_timeout 20 wsl.exe --list --running --quiet | tr -d '\r')
    echo "$running"

    echo
    # Running a command in a stopped distro boots it, so the guest sections
    # would describe a fresh boot.
    if ! grep --quiet --line-regexp rancher-desktop <<<"$running"; then
        echo "=== Guest: skipped because wsl --list --running did not list rancher-desktop ==="
        return
    fi

    echo "=== Guest: rc-status ==="
    # OpenRC runs in the PID and mount namespaces that network-setup creates,
    # so rc-status runs through wsl-exec, which enters them.  ps stays outside,
    # where it sees every process.
    with_timeout 20 wsl.exe --distribution rancher-desktop --exec /usr/local/bin/wsl-exec rc-status --all

    echo
    echo "=== Guest: ps ==="
    with_timeout 20 wsl.exe --distribution rancher-desktop -- ps -ef
}

{
    echo "=== Support bundle at $(date -u +%FT%TZ) ==="
    echo "uname: $(uname -a)"
    echo

    echo "=== ps ==="
    ps aux 2>&1
    echo

    dump_memory_pressure
    echo

    # The socket tools print numeric addresses and never wait on a name
    # lookup, so they run even when no timeout command exists.
    dump_sockets
    echo

    if [[ -z $timeout_cmd ]]; then
        echo "=== No timeout command found; skipping the probes that can hang ==="
    else
        dump_api_state
        echo

        if [[ $platform == win32 ]]; then
            dump_wsl_guest
        else
            dump_lima_guest
        fi
    fi
    echo

    echo "=== End of support bundle ==="
} >>"$bundle" 2>&1

echo "Collected logs and a support bundle in $output_dir"
