load '../helpers/load'

local_setup() {
    skip_on_windows
}

@test 'initial factory reset' {
    factory_reset
}

supports_vz_emulation() {
    if is_macos; then
        version=$(/usr/bin/sw_vers -productVersion)
        major_minor_version="${version%.*}"
        major_version="${major_minor_version%.*}"
        minor_version="${major_minor_version#*.}"
        if ((major_version >= 14)); then
            return 0
        elif ((major_version <= 12)); then
            return 1
        elif ((minor_version >= 3)); then
            return 0
        elif [[ "$(uname -m)" == x86_64 ]]; then
            # Versions 12.0.x .. 12.2.x work only on x86, not m1
            return 0
        fi
    fi
    return 1
}

@test 'mac-specific failure for unacceptable start setting' {
    if ! is_macos; then
        skip 'need a mac for the --experimental.virtual-machine.type setting'
    elif supports_vz_emulation; then
        skip 'no error setting experimental.virtualMachine.type to "vz" on this platform'
    fi
    RD_NO_MODAL_DIALOGS=1 launch_the_application --experimental.virtual-machine.type vz
    try --max 36 --delay 5 assert_file_contains \
        "$PATH_LOGS/background.log" \
        'Setting experimental.virtualMachine.type to "vz" on Intel requires macOS 13.0 (Ventura) or later.'
    rdctl shutdown
}

@test 'report unrecognized options in the log file' {
    if ! using_dev_mode; then
        skip 'hard to get unrecognized options past rdctl-start; run this test in dev-mode'
    fi
    yarn dev --his-face-rings-a-bell --no-modal-dialogs &
    try --max 36 --delay 5 assert_file_contains "$PATH_LOGS/settings.log" "Unrecognized command-line argument --his-face-rings-a-bell"
    rdctl shutdown
}
