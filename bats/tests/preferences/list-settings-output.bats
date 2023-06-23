load '../helpers/load'

RD_USE_IMAGE_ALLOW_LIST=true

@test 'factory reset' {
    factory_reset
    # bypass the defaults deployment file
    mkdir -p "$(dirname "${PATH_CONFIG_FILE})")"
    touch "$PATH_CONFIG_FILE"
}

@test 'start app' {
    start_container_engine
    wait_for_container_engine
}

@test 'report parameters for json' {
    run rdctl list-settings '--output=json,fish'
    assert_failure
    assert_output --partial 'the json output format takes no sub-formats, got "json,fish"'
}

@test 'report unrecognized output-options' {
    run rdctl list-settings '--output=bickley,ruff'
    assert_failure
    assert_output --partial $'expecting an output format of \'json\' or \'reg\', got "bickley,ruff"'
}

@test 'report unrecognized reg sub-options' {
    run rdctl list-settings '--output=reg,hklm,ruff'
    assert_failure
    assert_output --partial 'expecting a reg output-format parameter, got "ruff" in "reg,hklm,ruff"'
}

@test 'report duplicate reg hives' {
    for x in hklm hkcu; do
        for y in hklm hkcu; do
            option="reg,${x},locked,${y}"
            run rdctl list-settings "--output=${option}"
            assert_failure
            assert_output --partial $"already specified registry hive \"${x}\" in \"${option}\", can't respecify"
        done
    done
}

@test 'report duplicate registry sections' {
    for x in defaults locked; do
        for y in defaults locked; do
            option="reg,${x},hkcu,${y}"
            run rdctl list-settings "--output=${option}"
            assert_failure
            assert_output --partial $"already specified registry section \"${x}\" in \"${option}\", can't respecify"
        done
    done
}

@test 'generates registry output for hklm/defaults' {
    for option in reg reg,hklm reg,hklm,defaults reg,defaults; do
        run rdctl list-settings --output "$option"
        assert_success
        assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
    done
}

@test 'generates registry output for hklm/locked' {
    for option in reg,hklm,locked reg,locked; do
        run rdctl list-settings --output "$option"
        assert_success
        assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\locked\application]'
    done
}

@test 'generates registry output for hkcu/defaults' {
    for option in reg,hkcu,defaults reg,hkcu; do
        run rdctl list-settings --output "$option"
        assert_success
        assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\defaults\application]'
    done
}

@test 'generates registry output for hkcu/locked' {
    run rdctl list-settings --output reg,hkcu,locked
    assert_success
    assert_output --partial '[HKEY_CURRENT_USER\SOFTWARE\Policies\Rancher Desktop\locked\application]'
}

@test 'generates registry output' {
    run rdctl list-settings --output reg
    assert_success
    # Just match a few of the lines near the start and the end of the output.
    # The unit tests do more comprehensive output checking.
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies]'
    assert_output --partial '"pathManagementStrategy"="rcfiles"'
    assert_output --partial '[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Rancher Desktop\defaults\diagnostics]'
    assert_output --partial '"showMuted"=dword:0'
}

@test 'needs a shutdown' {
    rdctl shutdown
}
