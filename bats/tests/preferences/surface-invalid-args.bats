load '../helpers/load'

local_setup() {
    skip_on_windows
}

@test 'initial factory reset' {
    factory_reset
}

@test 'mac-specific failure for unacceptable start setting' {
    if ! is_macos; then
        skip 'need a mac for the --virtual-machine.type setting'
    elif supports_vz_emulation; then
        skip 'no error setting virtualMachine.type to "vz" on this platform'
    fi
    RD_NO_MODAL_DIALOGS=1 launch_the_application --virtual-machine.type vz
    try --max 36 --delay 5 assert_file_contains \
        "$PATH_LOGS/background.log" \
        'Setting virtualMachine.type to "vz" on Intel requires macOS 13.0 (Ventura) or later.'
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
