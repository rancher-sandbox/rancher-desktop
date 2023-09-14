load '../helpers/load'

local_setup() {
    if is_windows; then
        skip "test not applicable on Windows"
    fi
}

@test 'initial factory reset' {
    factory_reset
}

can_set_vm_to_vz() {
    if ! is_macos; then
        false
    else
        version=$(/usr/bin/sw_vers -productVersion)
        majorMinorVersion="${version%.*}"
        majorVersion="${majorMinorVersion%.*}"
        minorVersion="${majorMinorVersion#*.}"
        if ((majorVersion >= 14)); then
            true
        elif ((majorVersion <= 12)); then
            false
        elif ((minorVersion >= 3)); then
            true
        else
            case "$(uname -m)" in
            x86_64) true ;;
            *) false ;;
            esac
        fi
    fi
}

@test 'mac-specific failure for unacceptable start setting' {
    if ! is_macos; then
        skip 'need a mac for the --experimental.virtual-machine.type setting'
    elif can_set_vm_to_vz; then
        skip 'no error setting experimental.virtualMachine.type to "vz" on this platform'
    fi
    # Don't use launch_the_application so we can check non-dev-mode error messages
    if using_dev_mode; then
        yarn dev --experimental.virtualMachine.type vz --no-modal-dialogs &
    else
        rdctl start --experimental.virtual-machine.type vz --no-modal-dialogs
    fi
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
