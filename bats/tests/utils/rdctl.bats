load '../helpers/load'

# Verify various operations of `rdctl`

@test 'factory reset' {
    factory_reset
}

@test 'start Rancher Desktop' {
    start_container_engine
    wait_for_container_engine
}

@test 'rdctl info' {
    run --separate-stderr rdctl info
    assert_success
    assert_output --partial 'Version:'
}

@test 'rdctl info --output=json' {
    run --separate-stderr rdctl info --output=json
    assert_success
    json=$output
    run jq_output .version
    assert_success
    assert_output --regexp '^v1\.'
    output=$json
    run jq_output '.["ip-address"]'
    assert_success
    assert_output --regexp '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
}

@test 'rdctl info --field version' {
    run rdctl info --field version
    assert_success
    assert_output --regexp '^v1\.'
}

@test 'rdctl info --field ip-address' {
    run rdctl info --field ip-address
    assert_success
    if is_windows; then
        # On Windows, the IP address should be constant.
        assert_output 192.168.127.2
    elif is_linux; then
        assert_output 192.168.5.15 # qemu SLIRP
    elif is_macos; then
        address=$output
        if is_true "$(get_setting '.application.adminAccess')"; then
            # This is provided by the user's DHCP server
            output=$address assert_output --regexp '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
        elif [[ $RD_MOUNT_TYPE == virtiofs ]]; then
            # macOS Virtualization.Framework NAT; not sure why this isn't used
            # when using VZ + reverse-sshfs.  See
            # https://github.com/rancher-sandbox/rancher-desktop/issues/9478
            output=$address assert_output --regexp '^192\.168\.205\.'
        else
            output=$address assert_output 192.168.5.15 # qemu SLIRP
        fi
    else
        fail 'Unknown OS'
    fi
}
